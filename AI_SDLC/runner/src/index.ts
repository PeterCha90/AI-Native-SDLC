import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { loadConfig } from "./config.ts";
import { createTicketSource } from "./adapters/index.ts";
import { runPipeline } from "./pipeline.ts";
import { sessionsDirFor } from "./claude.ts";

const RUNNER_DIR = dirname(fileURLToPath(import.meta.url)).replace(/\/src$/, "");

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// Serializes pipeline runs to exactly one at a time — a demo runner has no need for concurrency,
// and it keeps "what's running right now" (.state/*.live.json) unambiguous: one active session
// at a time.
class Queue {
  private tasks: Array<() => Promise<void>> = [];
  private running = false;

  push(task: () => Promise<void>): void {
    this.tasks.push(task);
    this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let task: (() => Promise<void>) | undefined;
    while ((task = this.tasks.shift())) {
      try {
        await task();
      } catch (err) {
        console.error("[queue] pipeline run threw:", err);
      }
    }
    this.running = false;
  }
}

export function startServer(): void {
  const config = loadConfig();
  const source = createTicketSource(config);
  const queue = new Queue();

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        json(res, 200, { status: "ok" });
        return;
      }

      const match = req.method === "POST" && req.url?.match(/^\/webhook\/([^/?]+)/);
      if (match) {
        const sourceParam = match[1];
        if (sourceParam !== config.ticketSource) {
          json(res, 404, { error: `no adapter configured for source "${sourceParam}"` });
          return;
        }
        const rawBody = await readRawBody(req);
        if (!source.verify(req.headers, rawBody)) {
          json(res, 401, { error: "signature verification failed" });
          return;
        }
        const ticket = source.parse(rawBody);
        if (!ticket) {
          json(res, 200, { ignored: true });
          return;
        }
        queue.push(() => runPipeline(ticket, config, source, RUNNER_DIR));
        json(res, 202, { queued: true, key: ticket.key });
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      console.error("[server] request handler error:", err);
      json(res, 500, { error: "internal error" });
    }
  });

  server.listen(config.port, () => {
    console.log(`[ai-sdlc-runner] listening on :${config.port}`);
    console.log(`[ai-sdlc-runner] webhook: POST /webhook/${config.ticketSource}`);
    console.log(`[ai-sdlc-runner] sessions for repo ${config.repoPath}:`);
    console.log(`  ${sessionsDirFor(config.repoPath)}`);
    console.log(`[ai-sdlc-runner] health check: http://localhost:${config.port}/health`);
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startServer();
}
