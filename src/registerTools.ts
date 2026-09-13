import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GitHubClient } from "./services/githubClient.js";
import { RateLimitError } from "./services/rateLimitGuard.js";
import { summarizePr, summarizePrInputSchema } from "./tools/summarizePr.js";
import {
  checkAgainstStandards,
  checkAgainstStandardsInputSchema,
} from "./tools/checkAgainstStandards.js";
import {
  generateReviewChecklist,
  generateChecklistInputSchema,
} from "./tools/generateChecklist.js";

interface ToolContext {
  github: GitHubClient;
  defaultRulesetPath: string;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Runs a tool body and converts any thrown error (notably RateLimitError) into a clean MCP error result. */
async function runTool(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const result = await fn();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const message = err instanceof RateLimitError ? err.message : toErrorMessage(err);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "summarize_pr",
    {
      title: "Summarize Pull Request",
      description:
        "Fetches structured, factual data about a GitHub pull request: files changed, line counts, file paths, commit messages, raw diff, a size category (XS-XL), and inferred risk flags (e.g. touches auth, touches migration). Returns raw facts only, not a written summary — reason about merge-readiness yourself from this data. For very large PRs the diff field is truncated to stay within tool-result size limits; check diffTruncated and fall back to filePaths/sizeCategory/riskFlags for full-PR signal when it's true.",
      inputSchema: summarizePrInputSchema.shape,
    },
    async (args) => runTool(() => summarizePr(ctx.github, args)),
  );

  server.registerTool(
    "check_against_standards",
    {
      title: "Check PR Against Standards",
      description:
        "Runs deterministic, rule-based checks against a pull request's changed files: missing test coverage for logic changes, leftover TODO/FIXME markers, filename convention drift, and likely-swallowed errors (empty or log-only catch blocks). Loads rules from rulesetPath if given, else the repo's own .reviewlens.json, else a built-in default ruleset.",
      inputSchema: checkAgainstStandardsInputSchema.shape,
    },
    async (args) => runTool(() => checkAgainstStandards(ctx.github, args, ctx.defaultRulesetPath)),
  );

  server.registerTool(
    "generate_review_checklist",
    {
      title: "Generate Review Checklist",
      description:
        "Generates a tailored review checklist for a pull request based on which risk categories its changed files touch (auth, migrations, public API routes, CI/CD config, dependencies, infrastructure). Always includes a small baseline checklist as well.",
      inputSchema: generateChecklistInputSchema.shape,
    },
    async (args) => runTool(() => generateReviewChecklist(ctx.github, args)),
  );
}
