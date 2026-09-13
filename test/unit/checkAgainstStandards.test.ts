import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mswServer } from "../mswServer.js";
import { defaultGithubHandlers, testRepoRef } from "../githubHandlers.js";
import { GitHubClient } from "../../src/services/githubClient.js";
import { checkAgainstStandards } from "../../src/tools/checkAgainstStandards.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRulesetPath = join(__dirname, "..", "..", "src", "config", "defaultRuleset.json");

describe("checkAgainstStandards", () => {
  it("flags missing tests, TODO markers, and empty catch blocks using the default ruleset", async () => {
    mswServer.use(...defaultGithubHandlers());
    const github = new GitHubClient("fake-token");

    const result = await checkAgainstStandards(
      github,
      { owner: testRepoRef.owner, repo: testRepoRef.repo, pr_number: testRepoRef.prNumber },
      defaultRulesetPath,
    );

    expect(result.rulesetSource).toBe("default");

    const messages = result.findings.map((f) => f.message);
    expect(result.findings.some((f) => f.file === "src/auth/passwordReset.ts" && /no corresponding test/i.test(f.message))).toBe(true);
    expect(result.findings.some((f) => /TODO/.test(f.message) && f.file === "src/auth/passwordReset.ts")).toBe(true);
    expect(
      result.findings.some(
        (f) => f.file === "src/auth/passwordReset.ts" && /catch block appears empty/i.test(f.message),
      ),
    ).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });

  it("loads a ruleset from an explicit rulesetPath when provided", async () => {
    mswServer.use(...defaultGithubHandlers());
    const github = new GitHubClient("fake-token");
    const customRulesetPath = join(__dirname, "..", "fixtures", "customRuleset.json");

    const result = await checkAgainstStandards(
      github,
      {
        owner: testRepoRef.owner,
        repo: testRepoRef.repo,
        pr_number: testRepoRef.prNumber,
        rulesetPath: customRulesetPath,
      },
      defaultRulesetPath,
    );

    expect(result.rulesetSource).toBe(customRulesetPath);
    // Custom ruleset disables the todo check entirely.
    expect(result.findings.some((f) => /TODO/.test(f.message))).toBe(false);
  });
});
