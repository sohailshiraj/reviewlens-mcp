import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Octokit } from "@octokit/rest";
import { mswServer } from "../mswServer.js";
import { RateLimitError, RateLimitGuard } from "../../src/services/rateLimitGuard.js";

function makeOctokit() {
  return new Octokit({ auth: "fake-token" });
}

describe("RateLimitGuard", () => {
  it("allows the call through when quota remains", async () => {
    mswServer.use(
      http.get("https://api.github.com/rate_limit", () =>
        HttpResponse.json({
          resources: { core: { limit: 5000, remaining: 100, reset: Math.floor(Date.now() / 1000) + 60 } },
        }),
      ),
    );

    const guard = new RateLimitGuard(makeOctokit());
    const result = await guard.run(async () => "ok");
    expect(result).toBe("ok");
  });

  it("fails fast with a RateLimitError when quota is exhausted, without making the call", async () => {
    mswServer.use(
      http.get("https://api.github.com/rate_limit", () =>
        HttpResponse.json({
          resources: { core: { limit: 5000, remaining: 0, reset: Math.floor(Date.now() / 1000) + 300 } },
        }),
      ),
    );

    const guard = new RateLimitGuard(makeOctokit());
    let called = false;

    await expect(
      guard.run(async () => {
        called = true;
        return "should not happen";
      }),
    ).rejects.toBeInstanceOf(RateLimitError);

    expect(called).toBe(false);
  });

  it("includes a human-readable retry-after estimate in the error message", async () => {
    mswServer.use(
      http.get("https://api.github.com/rate_limit", () =>
        HttpResponse.json({
          resources: { core: { limit: 5000, remaining: 0, reset: Math.floor(Date.now() / 1000) + 300 } },
        }),
      ),
    );

    const guard = new RateLimitGuard(makeOctokit());
    await expect(guard.run(async () => "x")).rejects.toThrow(/retry after \d+ minutes?/i);
  });
});
