import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { GitHubClient, PullRequestRef } from "./githubClient.js";

const namingRuleSchema = z.object({
  filePattern: z.string(),
  description: z.string(),
  namePattern: z.string(),
});

const rulesetSchema = z.object({
  version: z.number().default(1),
  checks: z.object({
    requireTestsForLogicChanges: z
      .object({
        enabled: z.boolean().default(true),
        severity: z.enum(["info", "warning", "error"]).default("warning"),
        logicFilePatterns: z.array(z.string()).default([]),
        testFilePatterns: z.array(z.string()).default([]),
        excludePatterns: z.array(z.string()).default([]),
      })
      .default({
        enabled: true,
        severity: "warning",
        logicFilePatterns: [],
        testFilePatterns: [],
        excludePatterns: [],
      }),
    flagTodoFixme: z
      .object({
        enabled: z.boolean().default(true),
        severity: z.enum(["info", "warning", "error"]).default("info"),
        markers: z.array(z.string()).default(["TODO", "FIXME"]),
      })
      .default({ enabled: true, severity: "info", markers: ["TODO", "FIXME"] }),
    namingConventions: z
      .object({
        enabled: z.boolean().default(true),
        severity: z.enum(["info", "warning", "error"]).default("info"),
        rules: z.array(namingRuleSchema).default([]),
      })
      .default({ enabled: true, severity: "info", rules: [] }),
    unhandledErrorPaths: z
      .object({
        enabled: z.boolean().default(true),
        severity: z.enum(["info", "warning", "error"]).default("warning"),
        filePatterns: z.array(z.string()).default([]),
      })
      .default({ enabled: true, severity: "warning", filePatterns: [] }),
  }),
});

export type Ruleset = z.infer<typeof rulesetSchema>;

export type Severity = "info" | "warning" | "error";

export interface Finding {
  file: string;
  line: number | null;
  severity: Severity;
  message: string;
}

export interface DiffFile {
  filename: string;
  patch?: string;
}

const REVIEWLENS_CONFIG_PATH = ".reviewlens.json";

/**
 * Resolves and loads a ruleset with the precedence: explicit rulesetPath >
 * repo's own .reviewlens.json (on the PR head ref) > packaged default.
 */
export async function loadRuleset(options: {
  rulesetPath?: string;
  github: GitHubClient;
  ref: PullRequestRef;
  headRef: string;
  defaultRulesetPath: string;
}): Promise<{ ruleset: Ruleset; source: string }> {
  if (options.rulesetPath) {
    const raw = await readFile(options.rulesetPath, "utf-8");
    return { ruleset: rulesetSchema.parse(JSON.parse(raw)), source: options.rulesetPath };
  }

  const repoConfig = await options.github.getFileContentFromRef(
    options.ref.owner,
    options.ref.repo,
    REVIEWLENS_CONFIG_PATH,
    options.headRef,
  );

  if (repoConfig) {
    return {
      ruleset: rulesetSchema.parse(JSON.parse(repoConfig)),
      source: `${options.ref.owner}/${options.ref.repo}@${REVIEWLENS_CONFIG_PATH}`,
    };
  }

  const raw = await readFile(options.defaultRulesetPath, "utf-8");
  return { ruleset: rulesetSchema.parse(JSON.parse(raw)), source: "default" };
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p).test(value));
}

/** Flags changed "logic" files that have no corresponding test file touched in the same PR. */
function checkRequireTestsForLogicChanges(files: DiffFile[], ruleset: Ruleset): Finding[] {
  const cfg = ruleset.checks.requireTestsForLogicChanges;
  if (!cfg.enabled) return [];

  const findings: Finding[] = [];
  const touchedPaths = files.map((f) => f.filename);
  const anyTestTouched = touchedPaths.some((p) => matchesAny(p, cfg.testFilePatterns));

  for (const file of files) {
    const isLogic = matchesAny(file.filename, cfg.logicFilePatterns);
    const isExcluded = matchesAny(file.filename, cfg.excludePatterns);
    const isTestFile = matchesAny(file.filename, cfg.testFilePatterns);

    if (isLogic && !isExcluded && !isTestFile && !anyTestTouched) {
      findings.push({
        file: file.filename,
        line: null,
        severity: cfg.severity,
        message: "Logic file changed with no corresponding test file changes in this PR.",
      });
    }
  }

  return findings;
}

interface DiffLine {
  lineNumber: number;
  content: string;
}

/** Parses a unified diff patch into added lines with their resulting file line numbers. */
function parseAddedLines(patch: string): DiffLine[] {
  const lines = patch.split("\n");
  const added: DiffLine[] = [];
  let currentLine = 0;

  for (const line of lines) {
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      currentLine = Number(hunkMatch[1]);
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      added.push({ lineNumber: currentLine, content: line.slice(1) });
      currentLine += 1;
    } else if (!line.startsWith("-") && !line.startsWith("\\")) {
      currentLine += 1;
    }
  }

  return added;
}

/** Flags TODO/FIXME-style markers left in newly added lines of the diff. */
function checkTodoFixme(files: DiffFile[], ruleset: Ruleset): Finding[] {
  const cfg = ruleset.checks.flagTodoFixme;
  if (!cfg.enabled || cfg.markers.length === 0) return [];

  const markerPattern = new RegExp(`\\b(${cfg.markers.map(escapeRegex).join("|")})\\b`);
  const findings: Finding[] = [];

  for (const file of files) {
    if (!file.patch) continue;
    for (const { lineNumber, content } of parseAddedLines(file.patch)) {
      if (markerPattern.test(content)) {
        findings.push({
          file: file.filename,
          line: lineNumber,
          severity: cfg.severity,
          message: `Marker left in diff: ${content.trim().slice(0, 120)}`,
        });
      }
    }
  }

  return findings;
}

/** Flags added filenames that don't match the configured naming convention for their type. */
function checkNamingConventions(files: DiffFile[], ruleset: Ruleset): Finding[] {
  const cfg = ruleset.checks.namingConventions;
  if (!cfg.enabled || cfg.rules.length === 0) return [];

  const findings: Finding[] = [];

  for (const file of files) {
    const basename = file.filename.split("/").pop() ?? file.filename;
    for (const rule of cfg.rules) {
      if (!new RegExp(rule.filePattern).test(file.filename)) continue;
      if (!new RegExp(rule.namePattern).test(basename)) {
        findings.push({
          file: file.filename,
          line: null,
          severity: cfg.severity,
          message: `Naming convention drift: ${rule.description}`,
        });
      }
    }
  }

  return findings;
}

// Matches `catch` blocks whose body is empty, whitespace-only, or contains
// only comments and/or a single console.log/print-style statement — i.e.
// the error is swallowed rather than handled.
const EMPTY_OR_LOG_ONLY_BODY = /^(\s*|\s*\/\/.*|\s*console\.(log|warn|error|debug)\([^)]*\);?\s*)$/;

/** Flags try/catch blocks whose catch body is empty or only logs, i.e. errors are swallowed. */
function checkUnhandledErrorPaths(files: DiffFile[], ruleset: Ruleset): Finding[] {
  const cfg = ruleset.checks.unhandledErrorPaths;
  if (!cfg.enabled) return [];

  const findings: Finding[] = [];

  for (const file of files) {
    if (!file.patch) continue;
    if (cfg.filePatterns.length > 0 && !matchesAny(file.filename, cfg.filePatterns)) continue;

    const addedLines = parseAddedLines(file.patch);
    for (let i = 0; i < addedLines.length; i++) {
      const line = addedLines[i];
      if (!line || !/catch\s*\([^)]*\)\s*{/.test(line.content)) continue;

      // Look at what follows the catch on the same "logical" region: either
      // an inline empty `catch (e) {}` or a body confined to the next line
      // before a closing brace. This is a heuristic over diff hunks, not a
      // parser, so it only catches the common single-line/two-line patterns.
      const sameLineBody = /catch\s*\([^)]*\)\s*{([^}]*)}/.exec(line.content);
      if (sameLineBody) {
        const body = sameLineBody[1] ?? "";
        if (EMPTY_OR_LOG_ONLY_BODY.test(body)) {
          findings.push(makeUnhandledFinding(file.filename, line.lineNumber, cfg.severity));
        }
        continue;
      }

      const next = addedLines[i + 1];
      if (next && /^\s*}/.test(next.content) === false && EMPTY_OR_LOG_ONLY_BODY.test(next.content)) {
        const afterNext = addedLines[i + 2];
        if (!afterNext || /^\s*}/.test(afterNext.content)) {
          findings.push(makeUnhandledFinding(file.filename, line.lineNumber, cfg.severity));
        }
      } else if (next && /^\s*}\s*$/.test(next.content)) {
        findings.push(makeUnhandledFinding(file.filename, line.lineNumber, cfg.severity));
      }
    }
  }

  return findings;
}

function makeUnhandledFinding(file: string, line: number, severity: Severity): Finding {
  return {
    file,
    line,
    severity,
    message: "catch block appears empty or log-only; error may be silently swallowed.",
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyRuleset(files: DiffFile[], ruleset: Ruleset): Finding[] {
  return [
    ...checkRequireTestsForLogicChanges(files, ruleset),
    ...checkTodoFixme(files, ruleset),
    ...checkNamingConventions(files, ruleset),
    ...checkUnhandledErrorPaths(files, ruleset),
  ];
}
