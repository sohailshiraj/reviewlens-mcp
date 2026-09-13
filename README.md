# reviewlens-mcp

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that helps a
reviewer or PR author know whether a GitHub pull request is safe to merge — **before**
reading the diff line by line.

reviewlens-mcp does **not** call any AI/LLM API itself. It exposes structured facts and
deterministic, rule-based checks about a pull request to whatever AI client you're already
using (Claude Desktop, Claude Code, Cursor, etc). The host AI does the reasoning; this
server just supplies clean data.

## Tools

### `summarize_pr(owner, repo, pr_number)`
Fetches PR metadata and diff via the GitHub API and returns structured facts — **not** a
written summary. The host LLM writes the summary from this data.

```jsonc
{
  "filesChanged": 4,
  "linesAdded": 120,
  "linesRemoved": 15,
  "filePaths": ["src/auth/passwordReset.ts", "..."],
  "commitMessages": ["add reset token migration", "..."],
  "diff": "diff --git a/src/auth/passwordReset.ts ...",
  "sizeCategory": "M",
  "riskFlags": ["touches auth", "touches migration"]
}
```

### `check_against_standards(owner, repo, pr_number, rulesetPath?)`
Runs deterministic checks against the PR's changed files:

- Logic files changed with no corresponding test file changes
- `TODO` / `FIXME` (configurable) markers left in the diff
- Filename convention drift (configurable regex per file type)
- Likely-unhandled error paths (`try` blocks with an empty or log-only `catch`)

Ruleset resolution order: `rulesetPath` argument → the target repo's own
`.reviewlens.json` (read from the PR's head branch) → the packaged default ruleset.

```jsonc
{
  "findings": [
    { "file": "src/auth/passwordReset.ts", "line": null, "severity": "warning",
      "message": "Logic file changed with no corresponding test file changes in this PR." },
    { "file": "src/auth/passwordReset.ts", "line": 8, "severity": "info",
      "message": "Marker left in diff: // TODO: send confirmation email" }
  ],
  "rulesetSource": "default"
}
```

### `generate_review_checklist(owner, repo, pr_number)`
Generates a tailored checklist based on which risk categories the changed files touch
(auth, migrations, public API routes, CI/CD config, dependencies, infrastructure), plus a
small baseline checklist that always applies.

```jsonc
{
  "checklist": [
    "Confirm the PR description explains the why, not just the what.",
    "Check that CI is passing before merge.",
    "Verify token expiry / session invalidation is still handled correctly.",
    "Check for backwards-incompatible schema changes (e.g. dropped/renamed columns)."
  ]
}
```

## Requirements

- Node.js 20+
- A GitHub [personal access token](https://github.com/settings/tokens) with read access
  to the repos you want to inspect (`repo` scope, or fine-grained `Pull requests: Read` +
  `Contents: Read`)

## Setup

```bash
git clone https://github.com/<you>/reviewlens-mcp.git
cd reviewlens-mcp
npm install
cp .env.example .env   # then fill in GITHUB_TOKEN
npm run build
```

## Running locally (stdio)

The default transport is stdio, for use with Claude Desktop, Claude Code, Cursor, or any
other local MCP client.

```bash
GITHUB_TOKEN=ghp_xxx npm start
```

### Claude Desktop / Cursor config

Add to your MCP client's config (e.g. `claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "reviewlens": {
      "command": "node",
      "args": ["/absolute/path/to/reviewlens-mcp/dist/server.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxx"
      }
    }
  }
}
```

Restart your client, then try asking it something like:

> Use reviewlens to summarize PR #123 in octocat/Hello-World and tell me if it's safe to merge.

## Running as a hosted demo (Streamable HTTP)

Set the transport to HTTP via env var or CLI flag — same codebase, no separate build:

```bash
REVIEWLENS_TRANSPORT=http GITHUB_TOKEN=ghp_xxx PORT=3000 npm start
# or
GITHUB_TOKEN=ghp_xxx npm start -- --http
```

The server listens on `http://localhost:3000/mcp` (Streamable HTTP) and
`http://localhost:3000/health` (basic health check).

> **Security note on hosted mode:** `GITHUB_TOKEN` is currently a single, server-wide
> credential shared by every client session that connects over HTTP — there is no
> per-user token exchange yet (see [ROADMAP.md](ROADMAP.md)). Every request against a
> publicly hosted instance is made as *that one token's* identity, and all sessions share
> its rate limit. Do **not** point a public hosted instance at a token with access to
> private repos you don't want visitors to be able to read. For your own private repos,
> run reviewlens-mcp locally (stdio mode) with your own token instead.

## Development

```bash
npm run dev        # tsx watch mode, stdio transport
npm test           # vitest, all GitHub calls mocked via msw — no live API calls
npm run lint
npm run typecheck
npm run build
```

## Configuring your own ruleset

Drop a `.reviewlens.json` in the root of the repo you're reviewing (see
[`examples/.reviewlens.json`](examples/.reviewlens.json) for the schema), or pass an
explicit `rulesetPath` to `check_against_standards`. If neither is present, the packaged
default ruleset ([`src/config/defaultRuleset.json`](src/config/defaultRuleset.json)) is
used.

## Security

- `GITHUB_TOKEN` is read from the environment only — never hardcoded, never logged.
- No repo/owner is ever hardcoded; all three tools work against any repo you're
  authorized to read.
- Every GitHub API call is routed through a rate-limit guard that checks remaining quota
  up front and fails fast with a clear "retry after N minutes" error instead of letting a
  raw 403 propagate.
- **Known limitation:** in HTTP mode, all sessions currently share the one server-side
  `GITHUB_TOKEN` — see the warning above and [ROADMAP.md](ROADMAP.md) for the planned
  per-session token model.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
