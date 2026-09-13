export type SizeCategory = "XS" | "S" | "M" | "L" | "XL";

export type RiskFlag =
  | "touches auth"
  | "touches migration"
  | "touches public API route"
  | "touches CI/CD config"
  | "touches dependencies"
  | "touches infrastructure";

interface RiskPattern {
  flag: RiskFlag;
  pattern: RegExp;
}

// Ordered list of path heuristics. Intentionally simple/regex-based rather
// than AST-based: this needs to run on file paths alone, cheaply, across any
// language or repo layout, and false positives are cheap for the host LLM to
// dismiss whereas false negatives silently hide risk.
const RISK_PATTERNS: RiskPattern[] = [
  { flag: "touches auth", pattern: /(^|\/)(auth|authn|authz|oauth|session|login|jwt)([./_-]|\/|$)/i },
  { flag: "touches migration", pattern: /(^|\/)(migrations?|db\/migrate)(\/|$)|\.(sql)$/i },
  {
    flag: "touches public API route",
    pattern: /(^|\/)(routes?|controllers?|api|endpoints?)(\/|$)/i,
  },
  { flag: "touches CI/CD config", pattern: /(^|\/)\.github\/workflows\/|(^|\/)\.circleci\/|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)Jenkinsfile$/i },
  {
    flag: "touches dependencies",
    pattern: /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile(\.lock)?|requirements\.txt|go\.(mod|sum)|Cargo\.(toml|lock)|pom\.xml|build\.gradle)$/i,
  },
  {
    flag: "touches infrastructure",
    pattern: /(^|\/)(terraform|infra|k8s|kubernetes|helm|docker-compose\.ya?ml|Dockerfile)(\/|$)/i,
  },
];

export function detectRiskFlags(filePaths: string[]): RiskFlag[] {
  const found = new Set<RiskFlag>();

  for (const path of filePaths) {
    for (const { flag, pattern } of RISK_PATTERNS) {
      if (pattern.test(path)) found.add(flag);
    }
  }

  return Array.from(found);
}

/**
 * Buckets PR size using both file count and line count, taking whichever
 * signal implies the larger category. A one-line change across 40 files is
 * not "XS", and a 2000-line single-file change is not "XS" either.
 */
export function categorizeSize(filesChanged: number, linesAdded: number, linesRemoved: number): SizeCategory {
  const totalLines = linesAdded + linesRemoved;

  const byLines = ((): SizeCategory => {
    if (totalLines <= 10) return "XS";
    if (totalLines <= 50) return "S";
    if (totalLines <= 250) return "M";
    if (totalLines <= 1000) return "L";
    return "XL";
  })();

  const byFiles = ((): SizeCategory => {
    if (filesChanged <= 2) return "XS";
    if (filesChanged <= 5) return "S";
    if (filesChanged <= 15) return "M";
    if (filesChanged <= 40) return "L";
    return "XL";
  })();

  const order: SizeCategory[] = ["XS", "S", "M", "L", "XL"];
  const rank = Math.max(order.indexOf(byLines), order.indexOf(byFiles));
  return order[rank] as SizeCategory;
}
