import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.ts";
import { createTicketSource } from "./adapters/index.ts";
import type { RecentIssue, Ticket } from "./adapters/types.ts";
import { runPipeline } from "./pipeline.ts";
import { sessionsDirFor } from "./claude.ts";
import { noopEvents, safeEvents, type PipelineEvents } from "./events.ts";
import { LinearWatcher } from "./linear-watcher.ts";
import { startSlackApp, isSlackStartupRejection } from "./slack/app.ts";
import type { createSlackNotifier } from "./slack/notifier.ts";

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

  /** Number of runs waiting (not counting one already in flight). */
  get size(): number {
    return this.tasks.length;
  }

  /**
   * Queues a run and returns its 1-based position in line: 1 means "starts right away" (nothing
   * else is running or waiting), N>1 means N-1 runs are ahead of it.
   */
  enqueue(task: () => Promise<void>): number {
    this.tasks.push(task);
    const position = (this.running ? 1 : 0) + this.tasks.length;
    this.drain();
    return position;
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
  const stateDir = join(RUNNER_DIR, ".state");

  // A bad SLACK_BOT_TOKEN/SLACK_APP_TOKEN combination can reject an internal promise deep
  // inside @slack/bolt's Socket Mode client in a way that never reaches the `try/catch` around
  // `startSlackApp()` below (see `isSlackStartupRejection`'s docstring for the trace). Only
  // registered when Slack is actually configured, and only swallows rejections this predicate
  // recognises as Slack/Bolt in origin — anything else still crashes the process loudly
  // (`process.exitCode = 1` then rethrow), so a real bug in the pipeline or webhook path is
  // never silently masked by this net.
  if (config.slack) {
    process.on("unhandledRejection", (reason) => {
      if (isSlackStartupRejection(reason)) {
        console.error("[ai-sdlc-runner] unhandled Slack/Bolt rejection (continuing):", reason);
        return;
      }
      console.error("[ai-sdlc-runner] unhandled rejection (not Slack-related) — crashing:", reason);
      process.exitCode = 1;
      throw reason instanceof Error ? reason : new Error(String(reason));
    });
  }

  // Which keys currently have a live `runPipeline` call in flight (as opposed to merely having
  // `.state/*` files on disk from a run the runner no longer remembers — see gate.ts's
  // "runner restarted" note). Populated only for the duration of runTicket below.
  const activeKeys = new Set<string>();
  const isRunActive = (key: string): boolean => activeKeys.has(key);

  // Set once Slack starts (if it does) — declared here so the LinearWatcher's onNew closure and
  // the Slack app's markTicketSeen closure can both refer to it without a startup-order dependency.
  let events: PipelineEvents = noopEvents;
  let slackNotifier: ReturnType<typeof createSlackNotifier> | null = null;
  let watcher: LinearWatcher<RecentIssue> | null = null;

  function runTicket(ticket: Ticket): Promise<void> {
    const key = ticket.key || ticket.id;
    activeKeys.add(key);
    return runPipeline(ticket, config, source, RUNNER_DIR, events).finally(() => activeKeys.delete(key));
  }

  async function setupNotifications(): Promise<void> {
    if (config.slack) {
      const { notifier } = await startSlackApp({
        config,
        source,
        stateDir,
        runnerDir: RUNNER_DIR,
        enqueue: (ticket) => queue.enqueue(() => runTicket(ticket)),
        isRunActive,
        markTicketSeen: async (id: string) => {
          if (watcher) await watcher.markSeen(id);
        },
      });
      slackNotifier = notifier;
      events = safeEvents(notifier);
    }

    if (config.linearTrigger === "poll" && !config.slack) {
      // Reachable only via an explicit `linearTrigger: "poll"` override in sdlc.config.json with
      // no Slack tokens/channel set — poll notices have nowhere to go, so there's no point
      // paying for the polling at all. Chose "warn loudly and don't start the watcher" over
      // "start it anyway and warn": a watcher that silently no-ops on every new ticket forever
      // is a worse failure mode than one that never starts.
      console.warn(
        "[ai-sdlc-runner] linearTrigger가 poll이지만 Slack이 꺼져 있다 — poll 알림을 보낼 곳이 없어 LinearWatcher를 시작하지 않는다. " +
          "linearTrigger를 webhook으로 두거나, SLACK_BOT_TOKEN/SLACK_APP_TOKEN과 slack.channelId로 Slack을 켜라.",
      );
    } else if (config.linearTrigger === "poll") {
      watcher = new LinearWatcher<RecentIssue>({
        listRecentIssues: (since) => source.listRecentIssues(since),
        statePath: join(stateDir, "linear-watch.json"),
        intervalMs: config.linearPollIntervalMs,
        onNew: async (t) => {
          if (!slackNotifier) return; // Slack configured but not yet connected (or failed to connect) — nothing to post to yet
          const startMode = config.slack?.startMode ?? "button";
          await slackNotifier.postTicketNotice(t, startMode === "auto" ? "auto" : "new");
          if (startMode === "auto") queue.enqueue(() => runTicket(t));
        },
      });
      watcher.start();
    }
  }

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
        queue.enqueue(() => runTicket(ticket));
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

  // Fire-and-forget: Slack/Socket Mode startup and the Linear poller must never block the HTTP
  // server (or the existing webhook path, which works today with neither) from listening.
  setupNotifications().catch((err) => {
    console.error("[ai-sdlc-runner] failed to start Slack/Linear notifications:", err);
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startServer();
}
