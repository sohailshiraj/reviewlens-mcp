import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "../mswServer.js";
import { defaultGithubHandlers, pullRequestFixture, testRepoRef } from "../githubHandlers.js";
import { GitHubClient } from "../../src/services/githubClient.js";
import { summarizePr } from "../../src/tools/summarizePr.js";

describe("summarizePr", () => {
  it("returns structured facts derived from the PR, including size and risk flags", async () => {
    mswServer.use(...defaultGithubHandlers());
    const github = new GitHubClient("fake-token");

    const result = await summarizePr(github, {
      owner: testRepoRef.owner,
      repo: testRepoRef.repo,
      pr_number: testRepoRef.prNumber,
    });

    expect(result.filesChanged).toBe(4);
    expect(result.linesAdded).toBe(120);
    expect(result.linesRemoved).toBe(15);
    expect(result.filePaths).toContain("src/auth/passwordReset.ts");
    expect(result.commitMessages).toContain("add reset token migration");
    expect(result.diff).toContain("passwordReset.ts");
    expect(result.diffTruncated).toBe(false);
    expect(result.sizeCategory).toBe("M");
    expect(result.riskFlags).toEqual(
      expect.arrayContaining(["touches auth", "touches migration", "touches public API route"]),
    );
  });

  it("truncates a diff larger than the size cap and flags diffTruncated", async () => {
    mswServer.use(
      http.get(
        `https://api.github.com/repos/${testRepoRef.owner}/${testRepoRef.repo}/pulls/${testRepoRef.prNumber}`,
        ({ request }) => {
          const accept = request.headers.get("accept") ?? "";
          if (accept.includes("diff")) {
            return HttpResponse.text("+".repeat(250_000));
          }
          return HttpResponse.json(pullRequestFixture);
        },
      ),
      ...defaultGithubHandlers(),
    );
    const github = new GitHubClient("fake-token");

    const result = await summarizePr(github, {
      owner: testRepoRef.owner,
      repo: testRepoRef.repo,
      pr_number: testRepoRef.prNumber,
    });

    expect(result.diffTruncated).toBe(true);
    expect(result.diff.length).toBeLessThan(250_000);
    expect(result.diff).toContain("diff truncated");
  });

  it("surfaces a clean RateLimitError message instead of a raw 403 when GitHub is exhausted", async () => {
    mswServer.use(
      http.get("https://api.github.com/rate_limit", () =>
        HttpResponse.json({
          resources: {
            core: { limit: 5000, remaining: 0, reset: Math.floor(Date.now() / 1000) + 120 },
          },
        }),
      ),
    );
    const github = new GitHubClient("fake-token");

    await expect(
      summarizePr(github, { owner: testRepoRef.owner, repo: testRepoRef.repo, pr_number: testRepoRef.prNumber }),
    ).rejects.toThrow(/rate limit reached/i);
  });
});
