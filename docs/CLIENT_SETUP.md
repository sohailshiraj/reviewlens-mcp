# Connecting reviewlens-mcp to Claude Desktop / Cursor

This covers wiring the built server (`dist/server.js`, stdio transport) into the two most
common local MCP clients. See the main [README](../README.md) for building the project
and generating a `GITHUB_TOKEN` first.

Both clients spawn `dist/server.js` as a subprocess directly — they do **not** read your
`.env` file, so the token has to be set explicitly in the client's own config.

## Claude Desktop

**1. Open the config file:**

```bash
open ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

If it doesn't exist yet, create it — or use Claude Desktop → Settings → Developer →
"Edit Config", which creates it for you.

**2. Add a `reviewlens` entry** under `mcpServers` (merge into any existing entries rather
than replacing the file):

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

**3. Fully quit and reopen Claude Desktop** (Cmd+Q, not just closing the window) — it only
spawns the MCP subprocess on startup.

**4. Verify the connection.** Look for a small tools/plug icon near the chat input, or
check Settings → Developer — "reviewlens" should show as connected with 3 tools listed.

**5. Try it:**

> Summarize PR #1 in octocat/Hello-World and tell me if it's safe to merge.

## Cursor

**1. Open Cursor's MCP config** — either the global file (`~/.cursor/mcp.json`) or a
project-local one (`.cursor/mcp.json` in the repo you're working in). Cursor's
Settings → MCP panel can open/edit this for you directly.

**2. Same config shape:**

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

**3. Reload Cursor**, or toggle the server off/on in Settings → MCP (each configured
server shows a status dot there).

**4. Try the same kind of prompt** in a Cursor chat and confirm it calls a reviewlens
tool rather than answering from memory.

## Rebuilding after a code change

Both clients run the compiled `dist/server.js`, not your `src/*.ts` files directly. If you
edit anything under `src/`, run `npm run build` again and then fully restart the client
(quit and reopen Claude Desktop; reload/toggle the server in Cursor) — otherwise it keeps
running the old subprocess against the previous build.

## Troubleshooting

- **Server shows 0 tools or an error status** — check the client's own MCP logs for the
  server's stderr output:
  - Claude Desktop: `~/Library/Logs/Claude/mcp*.log`
  - Cursor: its MCP output panel in Settings → MCP
- **"Tool result is too large" (Claude Desktop's ~1MB cap)** — `summarize_pr` caps its
  `diff` field at 200,000 characters and sets `diffTruncated: true` when a PR's diff
  exceeds that, specifically to avoid this. If you still hit the limit, the PR likely has
  an unusually large number of changed files — the `filePaths`, `sizeCategory`, and
  `riskFlags` fields still carry full-PR signal even when the diff itself is truncated.
- **A tool call returns a rate-limit message instead of data** — that's the rate-limit
  guard working as intended, not a bug; wait for the reset time it reports, or use a
  token with a fresh quota.
- **`GITHUB_TOKEN` errors on startup** — the token must be set in the client config's
  `env` block (see above), not just in your shell or `.env` file, since the client spawns
  the process independently of your terminal session.
