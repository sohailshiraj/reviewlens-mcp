import { describe, expect, it } from "vitest";
import { mswServer } from "../mswServer.js";
import { defaultGithubHandlers, testRepoRef } from "../githubHandlers.js";
import { GitHubClient } from "../../src/services/githubClient.js";
import { generateReviewChecklist } from "../../src/tools/generateChecklist.js";

describe("generateReviewChecklist", () => {
  it("includes auth, migration, and API route checklist items for a PR touching those areas", async () => {
    mswServer.use(...defaultGithubHandlers());
    const github = new GitHubClient("fake-token");

    const result = await generateReviewChecklist(github, {
      owner: testRepoRef.owner,
      repo: testRepoRef.repo,
      pr_number: testRepoRef.prNumber,
    });

    expect(result.checklist).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/token expiry/i),
        expect.stringMatching(/backwards-incompatible schema/i),
        expect.stringMatching(/OpenAPI\/API docs/i),
      ]),
    );
    // Baseline items always present regardless of risk flags.
    expect(result.checklist).toEqual(
      expect.arrayContaining([expect.stringMatching(/CI is passing/i)]),
    );
  });
});
