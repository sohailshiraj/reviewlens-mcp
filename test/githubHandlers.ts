import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { http, HttpResponse } from "msw";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf-8")) as T;
}

export const pullRequestFixture = loadFixture<Record<string, unknown>>("pullRequest.json");
export const pullFilesFixture = loadFixture<Record<string, unknown>[]>("pullFiles.json");
export const pullCommitsFixture = loadFixture<Record<string, unknown>[]>("pullCommits.json");

const OWNER = "octo-org";
const REPO = "octo-repo";
const PR_NUMBER = 42;

/**
 * Default happy-path handlers for a full PR fetch cycle (meta, files, commits,
 * diff, rate limit, and a 404 for .reviewlens.json so the default ruleset is
 * used). Individual tests can override specific handlers via mswServer.use(...).
 */
export function defaultGithubHandlers() {
  return [
    http.get("https://api.github.com/rate_limit", () =>
      HttpResponse.json({
        resources: {
          core: {
            limit: 5000,
            remaining: 4999,
            reset: Math.floor(Date.now() / 1000) + 3600,
          },
        },
      }),
    ),

    http.get(`https://api.github.com/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}`, ({ request }) => {
      const accept = request.headers.get("accept") ?? "";
      if (accept.includes("diff")) {
        return HttpResponse.text("diff --git a/src/auth/passwordReset.ts b/src/auth/passwordReset.ts\n+export {};\n");
      }
      return HttpResponse.json(pullRequestFixture);
    }),

    http.get(`https://api.github.com/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/files`, ({ request }) => {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get("page") ?? "1");
      return HttpResponse.json(page === 1 ? pullFilesFixture : []);
    }),

    http.get(`https://api.github.com/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/commits`, ({ request }) => {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get("page") ?? "1");
      return HttpResponse.json(page === 1 ? pullCommitsFixture : []);
    }),

    http.get(`https://api.github.com/repos/${OWNER}/${REPO}/contents/.reviewlens.json`, () =>
      HttpResponse.json({ message: "Not Found" }, { status: 404 }),
    ),
  ];
}

export const testRepoRef = { owner: OWNER, repo: REPO, prNumber: PR_NUMBER };
