import type { Octokit } from "@octokit/rest";

/**
 * Thrown instead of letting a raw GitHub 403/429 rate-limit error propagate.
 * Carries a human-readable retry hint so tool handlers can surface it directly
 * to the calling LLM without needing to parse GitHub's response shape.
 */
export class RateLimitError extends Error {
  readonly retryAfterMinutes: number;
  readonly resetAt: Date;

  constructor(retryAfterMinutes: number, resetAt: Date) {
    super(
      `GitHub API rate limit reached. Retry after ${retryAfterMinutes} minute${
        retryAfterMinutes === 1 ? "" : "s"
      } (resets at ${resetAt.toISOString()}).`,
    );
    this.name = "RateLimitError";
    this.retryAfterMinutes = retryAfterMinutes;
    this.resetAt = resetAt;
  }
}

interface RateLimitStatus {
  remaining: number;
  limit: number;
  resetAt: Date;
}

/**
 * Checks the GitHub rate limit before allowing a call through, and translates
 * any rate-limit error surfaced by the call itself into a clean RateLimitError.
 *
 * GitHub's core REST rate limit is a shared bucket, so a single low-cost
 * `rateLimit.get()` check up front is enough to guard every wrapped call
 * without adding a extra request per-call once we already know we're safe.
 */
export class RateLimitGuard {
  private readonly octokit: Octokit;
  /** Minimum remaining calls we insist on before letting a new call through. */
  private readonly minRemaining: number;

  constructor(octokit: Octokit, minRemaining = 1) {
    this.octokit = octokit;
    this.minRemaining = minRemaining;
  }

  async getStatus(): Promise<RateLimitStatus> {
    const { data } = await this.octokit.rest.rateLimit.get();
    const core = data.resources.core;
    return {
      remaining: core.remaining,
      limit: core.limit,
      resetAt: new Date(core.reset * 1000),
    };
  }

  private minutesUntil(resetAt: Date): number {
    const ms = resetAt.getTime() - Date.now();
    return Math.max(1, Math.ceil(ms / 60_000));
  }

  /**
   * Runs `fn` guarded by a pre-flight rate-limit check. If GitHub is already
   * exhausted, fails fast with RateLimitError instead of spending the call.
   * If the call itself comes back as a rate-limit response (e.g. a race with
   * another process, or secondary rate limits), it's translated the same way.
   */
  async run<T>(fn: (octokit: Octokit) => Promise<T>): Promise<T> {
    const status = await this.getStatus();
    if (status.remaining < this.minRemaining) {
      throw new RateLimitError(this.minutesUntil(status.resetAt), status.resetAt);
    }

    try {
      return await fn(this.octokit);
    } catch (err) {
      throw this.translateIfRateLimit(err);
    }
  }

  private translateIfRateLimit(err: unknown): unknown {
    if (!isOctokitHttpError(err)) return err;

    const isRateLimited =
      err.status === 403 || err.status === 429
        ? isRateLimitMessage(err.message) || hasZeroRemainingHeader(err)
        : false;

    if (!isRateLimited) return err;

    const resetHeader = err.response?.headers?.["x-ratelimit-reset"];
    const resetAt = resetHeader
      ? new Date(Number(resetHeader) * 1000)
      : new Date(Date.now() + 60_000);

    return new RateLimitError(this.minutesUntil(resetAt), resetAt);
  }
}

interface OctokitHttpError extends Error {
  status?: number;
  response?: {
    headers?: Record<string, string>;
  };
}

function isOctokitHttpError(err: unknown): err is OctokitHttpError {
  return err instanceof Error && "status" in err;
}

function isRateLimitMessage(message: string): boolean {
  return /rate limit/i.test(message);
}

function hasZeroRemainingHeader(err: OctokitHttpError): boolean {
  return err.response?.headers?.["x-ratelimit-remaining"] === "0";
}
