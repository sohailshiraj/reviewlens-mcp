import { z } from "zod";
import type { GitHubClient } from "../services/githubClient.js";
import { categorizeSize, detectRiskFlags, type SizeCategory, type RiskFlag } from "../services/riskAnalysis.js";

export const summarizePrInputSchema = z.object({
  owner: z.string().min(1).describe("GitHub repository owner (user or org)"),
  repo: z.string().min(1).describe("GitHub repository name"),
  pr_number: z.number().int().positive().describe("Pull request number"),
});

export type SummarizePrInput = z.infer<typeof summarizePrInputSchema>;

export interface SummarizePrResult {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  filePaths: string[];
  commitMessages: string[];
  diff: string;
  diffTruncated: boolean;
  sizeCategory: SizeCategory;
  riskFlags: RiskFlag[];
}

// Keeps the whole tool result comfortably under MCP host clients' response
// size caps (e.g. Claude Desktop rejects any single tool result over 1MB).
// This bounds just the diff string, leaving headroom for the rest of the
// payload (file paths, commit messages, JSON structure overhead).
const MAX_DIFF_CHARS = 200_000;

function truncateDiff(diff: string): { diff: string; diffTruncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) {
    return { diff, diffTruncated: false };
  }

  const omittedChars = diff.length - MAX_DIFF_CHARS;
  const truncated =
    diff.slice(0, MAX_DIFF_CHARS) +
    `\n\n... [diff truncated: ${omittedChars.toLocaleString()} more characters omitted. ` +
    `Use filePaths, sizeCategory, and riskFlags for full-PR signal.]`;

  return { diff: truncated, diffTruncated: true };
}

/**
 * Gathers structured, factual data about a PR. Deliberately returns no prose
 * summary — the host LLM is expected to reason over these facts itself.
 */
export async function summarizePr(
  github: GitHubClient,
  input: SummarizePrInput,
): Promise<SummarizePrResult> {
  const ref = { owner: input.owner, repo: input.repo, pullNumber: input.pr_number };

  const [meta, files, commitMessages, diff] = await Promise.all([
    github.getPullRequest(ref),
    github.listPullFiles(ref),
    github.listPullCommitMessages(ref),
    github.getPullDiff(ref),
  ]);

  const filePaths = files.map((f) => f.filename);
  const { diff: boundedDiff, diffTruncated } = truncateDiff(diff);

  return {
    filesChanged: meta.changedFiles,
    linesAdded: meta.additions,
    linesRemoved: meta.deletions,
    filePaths,
    commitMessages,
    diff: boundedDiff,
    diffTruncated,
    sizeCategory: categorizeSize(meta.changedFiles, meta.additions, meta.deletions),
    riskFlags: detectRiskFlags(filePaths),
  };
}
