# Contributing to reviewlens-mcp

Thanks for considering a contribution.

## Getting started

```bash
npm install
cp .env.example .env   # fill in a GITHUB_TOKEN for manual testing
npm run build
npm test
```

## Development workflow

1. Fork and branch from `main`.
2. Make your change. Keep it focused — one logical change per PR.
3. Add or update tests. All GitHub API interaction must be mocked (via `msw`) in tests —
   no live network calls. See `test/githubHandlers.ts` for the shared mock setup.
4. Run the full check suite before opening a PR:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

5. Open a pull request describing the change and why it's needed.

## Adding a new check to the ruleset engine

Checks live in `src/services/rulesetEngine.ts`. Each check:

- Reads its own config block from the parsed `Ruleset` (add a new key under `checks` in
  the zod schema, with sensible defaults).
- Takes the list of changed `DiffFile`s and returns `Finding[]`.
- Is added to the `applyRuleset` aggregator.

Update `src/config/defaultRuleset.json` and `examples/.reviewlens.json` to document the
new config shape, and add a test fixture exercising it in
`test/unit/checkAgainstStandards.test.ts`.

## Adding a new risk flag / checklist item

Risk detection (used by both `summarize_pr` and `generate_review_checklist`) lives in
`src/services/riskAnalysis.ts`. Add a new pattern to `RISK_PATTERNS`, then add the
corresponding checklist entries to `CHECKLIST_BY_FLAG` in
`src/tools/generateChecklist.ts`.

## Code style

- TypeScript strict mode is on — don't relax it.
- No comments explaining *what* code does; only *why*, when it's non-obvious.
- Don't add dependencies without discussing first (open an issue or ask in your PR
  description).

## Reporting bugs / requesting features

Open a GitHub issue. Include the tool called, the input, and the actual vs. expected
output. If it's a rule false-positive/negative, include the relevant diff snippet.
