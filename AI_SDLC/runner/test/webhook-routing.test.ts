import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { createRequestHandler } from "../src/index.ts";
import { STAGES, type StageId } from "../src/gate.ts";
import type { Config } from "../src/config.ts";
import type { IssueComment, NewTicket, StateType, Ticket, TicketSource } from "../src/adapters/types.ts";

/**
 * Covers the webhook-auth regression in the final review findings: with Slack on (or any config
 * with linearTrigger "poll", the default once Slack is configured), LINEAR_WEBHOOK_SECRET may be
 * empty — POST /webhook/<source> must 404 outright rather than reach `source.verify`.
 */

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ticketSource: "linear",
    repoPath: "/tmp/unused",
    port: 0,
    e2eDriver: "ego-lite",
    demoAppUrl: "http://localhost:5173",
    useWorktree: true,
    autoTicketLabel: "sdlc-auto",
    maxAutoTicketDepth: 3,
    gateRoles: Object.fromEntries(STAGES.map((s) => [s, "Tester"])) as Record<StageId, string>,
    gatePollIntervalMs: 1,
    gateTimeoutMs: 5000,
    autoApprove: false,
    detectScript: "ops/detect.sh",
    detectMetric: "e2e_failure_rate",
    linear: { webhookSecret: "", apiKey: "x", teamId: "x" },
    jira: { baseUrl: "", email: "", apiToken: "", projectKey: "", webhookSecret: "" },
    linearTrigger: "poll",
    linearPollIntervalMs: 30_000,
    interviewMaxRounds: 5,
    reworkMaxAttempts: 3,
    slack: null,
    ...overrides,
  };
}

function fakeSource(webhookSecret: string): TicketSource {
  return {
    name: "linear",
    verify: (headers, rawBody) => {
      const signature = String((headers as Record<string, string>)["linear-signature"] ?? "");
      if (!webhookSecret) return false; // mirrors the real adapter's defense-in-depth fix
      const expected = createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex");
      return signature === expected;
    },
    parse: (rawBody) => {
      const data = JSON.parse(rawBody);
      return { id: data.id, key: data.key, title: data.title ?? "", body: "", labels: [], url: "" };
    },
    createTicket: async (t: NewTicket): Promise<Ticket> => ({ id: "x", key: "x", title: t.title, body: t.body, labels: [], url: "" }),
    comment: async () => {},
    createSubIssue: async (): Promise<Ticket> => {
      throw new Error("unused");
    },
    getStateType: async (): Promise<StateType> => "completed",
    listComments: async (): Promise<IssueComment[]> => [],
    setStateType: async () => {},
    listRecentIssues: async () => [],
    getTicket: async (idOrKey: string): Promise<Ticket> => ({ id: idOrKey, key: idOrKey, title: "", body: "", labels: [], url: "" }),
  };
}

async function withServer<T>(config: Config, source: TicketSource, fn: (baseUrl: string, queued: Ticket[]) => Promise<T>): Promise<T> {
  const queued: Ticket[] = [];
  const handler = createRequestHandler(config, source, (t: Ticket) => {
    queued.push(t);
    return 1;
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a bound TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await fn(baseUrl, queued);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("createRequestHandler: POST /webhook/<source> 404s when linearTrigger is \"poll\" (the Slack default), even with a correctly signed body", async () => {
  const config = makeConfig({ linearTrigger: "poll" });
  const source = fakeSource(""); // poll mode: no webhook secret configured
  await withServer(config, source, async (baseUrl, queued) => {
    const body = JSON.stringify({ id: "1", key: "ENG-1", title: "t" });
    const res = await fetch(`${baseUrl}/webhook/linear`, {
      method: "POST",
      headers: { "linear-signature": createHmac("sha256", "").update(body, "utf8").digest("hex") },
      body,
    });
    assert.equal(res.status, 404);
    assert.equal(queued.length, 0, "a disabled webhook route must never enqueue a ticket");
  });
});

test("createRequestHandler: POST /webhook/<source> works as before when linearTrigger is \"webhook\"", async () => {
  const secret = "s3cr3t";
  const config = makeConfig({ linearTrigger: "webhook", linear: { webhookSecret: secret, apiKey: "x", teamId: "x" } });
  const source = fakeSource(secret);
  await withServer(config, source, async (baseUrl, queued) => {
    const body = JSON.stringify({ id: "1", key: "ENG-1", title: "t" });
    const res = await fetch(`${baseUrl}/webhook/linear`, {
      method: "POST",
      headers: { "linear-signature": createHmac("sha256", secret).update(body, "utf8").digest("hex") },
      body,
    });
    assert.equal(res.status, 202);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].key, "ENG-1");
  });
});

test("createRequestHandler: GET /health still works when linearTrigger is \"poll\"", async () => {
  const config = makeConfig({ linearTrigger: "poll" });
  const source = fakeSource("");
  await withServer(config, source, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
  });
});
