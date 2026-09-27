import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveDashboardPage, serveRunsJson } from "./dashboard-routes.ts";

/**
 * Standalone dashboard server: `node src/dashboard-server.ts --state <dir>`.
 *
 * Serves only `GET /` and `GET /api/runs` against a given `.state` directory — no Linear or
 * Jira credentials required, so `scripts/seed-demo-state.ts`'s fixtures can be previewed without
 * ever touching the real webhook server in `index.ts`.
 */
export function createDashboardServer(stateDir: string) {
  return createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      await serveDashboardPage(res);
      return;
    }
    if (req.method === "GET" && req.url === "/api/runs") {
      await serveRunsJson(res, stateDir);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
}

function parseArgs(argv: string[]): { state: string; port: number } {
  const stateIdx = argv.indexOf("--state");
  const state = stateIdx !== -1 && argv[stateIdx + 1] ? argv[stateIdx + 1] : ".state";
  const portIdx = argv.indexOf("--port");
  const port = portIdx !== -1 && argv[portIdx + 1] ? Number(argv[portIdx + 1]) : Number(process.env.PORT ?? 3939);
  return { state: resolve(state), port };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { state, port } = parseArgs(process.argv.slice(2));
  const server = createDashboardServer(state);
  server.listen(port, () => {
    console.log(`[ai-sdlc-dashboard] serving ${state}`);
    console.log(`[ai-sdlc-dashboard] dashboard: http://localhost:${port}/`);
  });
}
