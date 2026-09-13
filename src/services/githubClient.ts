import { Octokit } from "@octokit/rest";
import { RateLimitGuard } from "./rateLimitGuard.js";

export interface PullRequestRef {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface PullFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface PullRequestMeta {
  title: string;
  body: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  baseRef: string;
  headRef: string;
  draft: boolean;
  mergeable: boolean | null;
}

/**
 * Thin wrapper around Octokit that centralizes auth, pagination, and
 * rate-limit protection. Tool implementations should never touch Octokit
 * directly so every GitHub call is guaranteed to go through the guard.
 */
export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly guard: RateLimitGuard;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
    this.guard = new RateLimitGuard(this.octokit);
  }

  async getPullRequest(ref: PullRequestRef): Promise<PullRequestMeta> {
    const { data } = await this.guard.run((octokit) =>
      octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.pullNumber,
      }),
    );

    return {
      title: data.title,
      body: data.body,
      additions: data.additions,
      deletions: data.deletions,
      changedFiles: data.changed_files,
      baseRef: data.base.ref,
      headRef: data.head.ref,
      draft: data.draft ?? false,
      mergeable: data.mergeable,
    };
  }

  /** Fetches every changed file for a PR, following pagination to completion. */
  async listPullFiles(ref: PullRequestRef): Promise<PullFile[]> {
    const files: PullFile[] = [];
    let page = 1;
    const perPage = 100;

    for (;;) {
      const { data } = await this.guard.run((octokit) =>
        octokit.rest.pulls.listFiles({
          owner: ref.owner,
          repo: ref.repo,
          pull_number: ref.pullNumber,
          per_page: perPage,
          page,
        }),
      );

      for (const file of data) {
        files.push({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
        });
      }

      if (data.length < perPage) break;
      page += 1;
    }

    return files;
  }

  /** Fetches every commit on a PR, following pagination to completion. */
  async listPullCommitMessages(ref: PullRequestRef): Promise<string[]> {
    const messages: string[] = [];
    let page = 1;
    const perPage = 100;

    for (;;) {
      const { data } = await this.guard.run((octokit) =>
        octokit.rest.pulls.listCommits({
          owner: ref.owner,
          repo: ref.repo,
          pull_number: ref.pullNumber,
          per_page: perPage,
          page,
        }),
      );

      for (const commit of data) {
        messages.push(commit.commit.message);
      }

      if (data.length < perPage) break;
      page += 1;
    }

    return messages;
  }

  /** Returns the unified diff for the PR, or null if the repo/file content is unavailable. */
  async getPullDiff(ref: PullRequestRef): Promise<string> {
    const response = await this.guard.run((octokit) =>
      octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.pullNumber,
        mediaType: { format: "diff" },
      }),
    );

    // With mediaType format "diff", Octokit types the response as the parsed
    // PR object but the runtime payload is actually the raw diff string.
    return response.data as unknown as string;
  }

  /**
   * Attempts to fetch a file's raw text content from the PR's head branch.
   * Returns null if the file does not exist (e.g. no .reviewlens.json in repo).
   */
  async getFileContentFromRef(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    try {
      const { data } = await this.guard.run((octokit) =>
        octokit.rest.repos.getContent({ owner, repo, path, ref }),
      );

      if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
        return null;
      }

      return Buffer.from(data.content, "base64").toString("utf-8");
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && err.status === 404;
}
