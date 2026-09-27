import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { loadRuns } from "./dashboard.ts";

/**
 * The two HTTP handlers the dashboard needs (`GET /` and `GET /api/runs`), shared between the
 * main webhook server (`index.ts`) and the standalone `dashboard-server.ts` used for demos —
 * neither one duplicates the other's routing logic.
 */

const DASHBOARD_HTML_PATH = fileURLToPath(new URL("./dashboard.html", import.meta.url));

export async function serveDashboardPage(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(DASHBOARD_HTML_PATH, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`dashboard.html을 읽지 못했다: ${(err as Error).message}`);
  }
}

export async function serveRunsJson(res: ServerResponse, stateDir: string): Promise<void> {
  try {
    const runs = await loadRuns(stateDir);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(runs));
  } catch (err) {
    console.error("[dashboard] /api/runs failed:", err);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "internal error" }));
  }
}
