# Roadmap

This is a living document, not a commitment. Priorities shift based on real usage.

## Now (v0.x)

- [x] Core tools: `summarize_pr`, `check_against_standards`, `generate_review_checklist`
- [x] Stdio + Streamable HTTP transport, configurable via env var / CLI flag
- [x] User-supplied ruleset via `.reviewlens.json` or explicit path
- [x] Rate-limit guard around all GitHub calls
- [ ] Publish to npm as `reviewlens-mcp`
- [ ] Hosted demo instance (Streamable HTTP) with a low-privilege read-only demo token
      — **known limitation until the item below ships:** the hosted instance currently
      uses one server-side `GITHUB_TOKEN` shared by every connected session (no per-user
      auth yet). Fine for a demo scoped to public repos; not safe for private-repo use.

## Next

- [ ] **Per-session GitHub credentials for hosted mode.** Replace the single server-wide
      `GITHUB_TOKEN` in `--http` mode with a per-session token, so a publicly hosted
      instance can be used safely against private repos and isn't rate-limited as one
      shared identity. Candidate approaches, roughly in order of effort:
      1. Accept a token via a per-request header (e.g. `X-GitHub-Token`) and build a
         `GitHubClient` per session instead of once at startup — smallest change,
         requires clients to bring their own PAT.
      2. Full OAuth (GitHub App): register a GitHub App, add an OAuth callback route,
         exchange the code for a token per user, store/refresh it, and authenticate MCP
         requests via the SDK's `AuthInfo` support on the HTTP transport. Correct
         long-term answer but a meaningfully larger feature (app registration, token
         storage/encryption, refresh logic, session-to-token mapping).
      stdio mode is unaffected either way — it already uses a token scoped to whoever
      runs the process locally.
- [ ] GitLab support (behind the same tool interface, new `services/gitlabClient.ts`)
- [ ] Per-language "logic file" / "test file" pattern presets (so `.reviewlens.json`
      doesn't need to hand-write regex for common stacks)
- [ ] Diff-aware naming convention check (currently filename-only)
- [ ] Caching layer for repeated calls against the same PR within a session
- [ ] Optional: surface CODEOWNERS-based "who should review this" as structured data

## Later / exploratory

- [ ] Support checking a PR against a security-focused ruleset preset (secrets in diff,
      dependency CVEs via GitHub's dependency graph API)
- [ ] Webhook mode: proactively run checks when a PR is opened/updated, expose results as
      an MCP resource rather than requiring a tool call
- [ ] Multi-PR / stacked-PR awareness (e.g. flag when a PR depends on an unmerged base)

## Explicitly out of scope

- This server will not call any LLM/AI API itself. All reasoning and prose generation is
  left to the host AI client. Contributions that add an LLM call inside a tool will be
  declined.
- This server will not auto-merge, auto-approve, or take any write action against a PR.
  It is read-only by design.
