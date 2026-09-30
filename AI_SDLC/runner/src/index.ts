import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import type { Config } from "./config.ts";
import { createTicketSource } from "./adapters/index.ts";
import type { RecentIssue, Ticket, TicketSource } from "./adapters/types.ts";
import { runPipeline } from "./pipeline.ts";
import { sessionsDirFor } from "./claude.ts";
import { noopEvents, safeEvents, type PipelineEvents } from "./events.ts";
import { LinearWatcher } from "./linear-watcher.ts";
import { startSlackApp, isSlackStartupRejection } from "./slack/app.ts";
import type { createSlackNotifier } from "./slack/notifier.ts";
import { noInterview, type InterviewChannel } from "./interview.ts";

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

/**
 * Builds the HTTP handler `startServer` mounts. Exported (and factored out of `startServer`
 * itself) so it's unit-testable against a real `http.Server` bound to an ephemeral port, without
 * standing up Slack or the LinearWatcher.
 *
 * The `/webhook/<source>` route is only ever mounted when `config.linearTrigger === "webhook"` —
 * when Slack is on (the default once it's configured turns `linearTrigger` to `"poll"`),
 * `LINEAR_WEBHOOK_SECRET` is optional (see README, "poll mode needs no webhook secret"), so
 * leaving this route live would let anyone reaching the port forge a signature against an empty
 * secret. `source.verify` also refuses an empty secret on its own (defense in depth), but the
 * route must not even be reachable in poll mode.
 */
export function createRequestHandler(
  config: Config,
  source: TicketSource,
  enqueueTicket: (t: Ticket) => number,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        json(res, 200, { status: "ok" });
        return;
      }

      const match = req.method === "POST" && req.url?.match(/^\/webhook\/([^/?]+)/);
      if (match) {
        if (config.linearTrigger !== "webhook") {
          json(res, 404, { error: `webhook endpoint disabled — linearTrigger is "${config.linearTrigger}", not "webhook"` });
          return;
        }
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
        enqueueTicket(ticket);
        json(res, 202, { queued: true, key: ticket.key });
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      console.error("[server] request handler error:", err);
      json(res, 500, { error: "internal error" });
    }
  };
}

// Serializes pipeline runs to exactly one at a time — a demo runner has no need for concurrency,
// and it keeps "what's running right now" (.state/*.live.json) unambiguous: one active session
// at a time. Exported so test/slack-actions.test.ts can exercise `createIdempotentEnqueuer`
// below against a real Queue rather than a fake.
export class Queue {
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

/**
 * Wraps a `Queue` with per-key idempotency: a key already active (queued or running) is not
 * enqueued a second time — `enqueue` returns `0` and `runOne` is never called for it. A key
 * becomes active the instant it's enqueued (before it waits in the queue, not once the queue
 * gets around to running it) and stays active until `runOne` settles, success or failure — so a
 * finished or aborted run is no longer active and CAN be started again. This is what backs
 * `isRunActive` everywhere in this module (the webhook handler, the Slack "▶ 시작" button,
 * `/sdlc run`, and auto-start all go through the one `enqueue` this returns).
 *
 * Exported (and generic, no dependency on `Ticket` beyond `key`/`id`) so it's unit-testable with
 * a fake `runOne` and a real `Queue`, without standing up the HTTP server or Slack.
 */
export function createIdempotentEnqueuer<T extends { key: string; id: string }>(
  queue: Queue,
  runOne: (t: T) => Promise<void>,
): { enqueue: (t: T) => number; isActive: (key: string) => boolean } {
  const activeKeys = new Set<string>();
  return {
    isActive: (key: string) => activeKeys.has(key),
    enqueue: (t: T): number => {
      const key = t.key || t.id;
      if (activeKeys.has(key)) return 0;
      activeKeys.add(key);
      return queue.enqueue(() => runOne(t).finally(() => activeKeys.delete(key)));
    },
  };
}

export function startServer(config: Config = loadConfig()): void {
  const source = createTicketSource(config);
  const queue = new Queue();
  const stateDir = join(config.baseDir, ".state");

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

  // Set once Slack starts (if it does) — declared here so the LinearWatcher's onNew closure and
  // the Slack app's markTicketSeen closure can both refer to it without a startup-order dependency.
  let events: PipelineEvents = noopEvents;
  let interview: InterviewChannel = noInterview;
  let slackNotifier: ReturnType<typeof createSlackNotifier> | null = null;
  let watcher: LinearWatcher<RecentIssue> | null = null;

  // Ticket key -> creator email, remembered the moment a run is enqueued so the Slack interview
  // channel can mention the right person without threading `creatorEmail` through every caller of
  // `runPipeline`. Read lazily by `getRequesterEmail` below (passed into `startSlackApp`, which
  // constructs the interview channel with it) — works whether or not Slack is even on.
  const requesterEmails = new Map<string, string>();
  const getRequesterEmail = (key: string): string | undefined => requesterEmails.get(key);

  // `isRunActive` covers a key from the moment it's enqueued (queued and waiting, not just once
  // it starts executing) through to `runPipeline` settling — a finished or aborted run is no
  // longer active and CAN be started again (`/sdlc run <키>`, or a fresh "▶ 시작" click), matching
  // the gate note "이 실행은 중단됐다 — /sdlc run <키>로 다시 시작한다". `events`/`interview` are read
  // lazily inside the closure below (not captured at this point), so they see whatever Slack sets
  // them to later.
  const { enqueue: enqueueTicket, isActive: isRunActive } = createIdempotentEnqueuer<Ticket>(queue, (ticket) => {
    const key = ticket.key || ticket.id;
    if (ticket.creatorEmail) requesterEmails.set(key, ticket.creatorEmail);
    return runPipeline(ticket, config, source, config.baseDir, events, interview);
  });

  async function setupNotifications(): Promise<void> {
    if (config.slack) {
      const { notifier, interview: slackInterview } = await startSlackApp({
        config,
        source,
        stateDir,
        runnerDir: config.baseDir,
        enqueue: enqueueTicket,
        isRunActive,
        markTicketSeen: async (id: string) => {
          if (watcher) await watcher.markSeen(id);
        },
        getRequesterEmail,
        setRequesterEmail: (key: string, email: string) => requesterEmails.set(key, email),
      });
      slackNotifier = notifier;
      events = safeEvents(notifier);
      interview = slackInterview;
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
          if (startMode === "auto") enqueueTicket(t);
        },
      });
      watcher.start();
    }
  }

  const server = createServer(createRequestHandler(config, source, enqueueTicket));

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
