import { z } from "zod";
import type { GitHubClient } from "../services/githubClient.js";
import { detectRiskFlags, type RiskFlag } from "../services/riskAnalysis.js";

export const generateChecklistInputSchema = z.object({
  owner: z.string().min(1).describe("GitHub repository owner (user or org)"),
  repo: z.string().min(1).describe("GitHub repository name"),
  pr_number: z.number().int().positive().describe("Pull request number"),
});

export type GenerateChecklistInput = z.infer<typeof generateChecklistInputSchema>;

export interface GenerateChecklistResult {
  checklist: string[];
}

const CHECKLIST_BY_FLAG: Record<RiskFlag, string[]> = {
  "touches auth": [
    "Verify token expiry / session invalidation is still handled correctly.",
    "Confirm authorization checks (not just authentication) are enforced on all affected paths.",
    "Check that credentials or secrets are not logged or exposed in error messages.",
  ],
  "touches migration": [
    "Check for backwards-incompatible schema changes (e.g. dropped/renamed columns).",
    "Confirm the migration is reversible or a rollback plan exists.",
    "Verify the migration is safe to run against production data volume (locking, downtime).",
  ],
  "touches public API route": [
    "Confirm OpenAPI/API docs are updated to match the change.",
    "Check for breaking changes to request/response shape for existing consumers.",
    "Verify input validation and error responses are consistent with existing endpoints.",
  ],
  "touches CI/CD config": [
    "Confirm the pipeline still runs required checks (tests, lint, security scans) before merge/deploy.",
    "Check that secrets/credentials used in the pipeline are not exposed in logs or artifacts.",
  ],
  "touches dependencies": [
    "Check the dependency change for known vulnerabilities or license issues.",
    "Confirm the lockfile is committed and matches the manifest change.",
  ],
  "touches infrastructure": [
    "Review the change for unintended access/permission changes (security groups, IAM, etc).",
    "Confirm the change has been planned/dry-run before applying to production infrastructure.",
  ],
};

const BASELINE_CHECKLIST = [
  "Confirm the PR description explains the why, not just the what.",
  "Check that CI is passing before merge.",
];

export async function generateReviewChecklist(
  github: GitHubClient,
  input: GenerateChecklistInput,
): Promise<GenerateChecklistResult> {
  const ref = { owner: input.owner, repo: input.repo, pullNumber: input.pr_number };
  const files = await github.listPullFiles(ref);
  const filePaths = files.map((f) => f.filename);
  const riskFlags = detectRiskFlags(filePaths);

  const checklist = [...BASELINE_CHECKLIST];
  for (const flag of riskFlags) {
    checklist.push(...CHECKLIST_BY_FLAG[flag]);
  }

  return { checklist };
}
