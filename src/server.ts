#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { GitHubClient } from "./services/githubClient.js";
import { registerTools } from "./registerTools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULESET_PATH = join(__dirname, "config", "defaultRuleset.json");

type TransportMode = "stdio" | "http";

function resolveTransportMode(): TransportMode {
  const flag = process.argv.includes("--http");
  const envMode = process.env.REVIEWLENS_TRANSPORT?.toLowerCase();

  if (flag || envMode === "http") return "http";
  return "stdio";
}

function resolvePort(): number {
  const raw = process.env.PORT ?? process.env.REVIEWLENS_PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

function requireGithubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(
      "Missing GITHUB_TOKEN environment variable. Create a GitHub personal access token and set GITHUB_TOKEN before starting reviewlens-mcp.",
    );
    process.exit(1);
  }
  return token;
}

function createServer(github: GitHubClient): McpServer {
  const server = new McpServer({
    name: "reviewlens-mcp",
    version: "0.1.0",
  });

  registerTools(server, { github, defaultRulesetPath: DEFAULT_RULESET_PATH });
  return server;
}

async function runStdio(github: GitHubClient): Promise<void> {
  const server = createServer(github);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("reviewlens-mcp running on stdio");
}

/**
 * Runs the Streamable HTTP transport, one MCP server + transport pair per
 * session, keyed by the session ID that the transport assigns on initialize.
 * This lets a single hosted process serve multiple concurrent clients.
 */
async function runHttp(github: GitHubClient): Promise<void> {
  const port = resolvePort();
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer((req, res) => {
    void handleRequest(req, res);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.url !== "/mcp") {
      res.writeHead(404).end("Not found");
      return;
    }

    const sessionId = req.headers["mcp-session-id"];
    const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

    if (existing) {
      await existing.handleRequest(req, res);
      return;
    }

    const body = await readJsonBody(req);

    if (req.method === "POST" && isInitializeRequest(body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      const server = createServer(github);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "No valid session ID provided" },
        id: null,
      }),
    );
  }

  httpServer.listen(port, () => {
    console.error(`reviewlens-mcp running on Streamable HTTP at http://localhost:${port}/mcp`);
  });
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function main(): Promise<void> {
  const token = requireGithubToken();
  const github = new GitHubClient(token);
  const mode = resolveTransportMode();

  if (mode === "http") {
    await runHttp(github);
  } else {
    await runStdio(github);
  }
}

main().catch((err) => {
  console.error("Fatal error starting reviewlens-mcp:", err instanceof Error ? err.message : err);
  process.exit(1);
});
