import { z } from "zod";
import type { GitHubClient } from "../services/githubClient.js";
import { applyRuleset, loadRuleset, type Finding } from "../services/rulesetEngine.js";

export const checkAgainstStandardsInputSchema = z.object({
  owner: z.string().min(1).describe("GitHub repository owner (user or org)"),
  repo: z.string().min(1).describe("GitHub repository name"),
  pr_number: z.number().int().positive().describe("Pull request number"),
  rulesetPath: z
    .string()
    .optional()
    .describe(
      "Optional local filesystem path to a ruleset JSON file. If omitted, falls back to the repo's own .reviewlens.json (read from the PR head branch), then the packaged default ruleset.",
    ),
});

export type CheckAgainstStandardsInput = z.infer<typeof checkAgainstStandardsInputSchema>;

export interface CheckAgainstStandardsResult {
  findings: Finding[];
  rulesetSource: string;
}

export async function checkAgainstStandards(
  github: GitHubClient,
  input: CheckAgainstStandardsInput,
  defaultRulesetPath: string,
): Promise<CheckAgainstStandardsResult> {
  const ref = { owner: input.owner, repo: input.repo, pullNumber: input.pr_number };

  const [meta, files] = await Promise.all([github.getPullRequest(ref), github.listPullFiles(ref)]);

  const { ruleset, source } = await loadRuleset({
    rulesetPath: input.rulesetPath,
    github,
    ref,
    headRef: meta.headRef,
    defaultRulesetPath,
  });

  const findings = applyRuleset(files, ruleset);

  return { findings, rulesetSource: source };
}
