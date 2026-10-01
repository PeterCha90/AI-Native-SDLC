import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleGateAction,
  parseSdlcCommand,
  isSlackStartupRejection,
  shouldBlockDoubleStart,
  handleSdlcCreate,
  resolveSlackUserEmail,
  type GateActionDeps,
} from "../src/slack/app.ts";
import { createSlackNotifier, type SlackClientLike } from "../src/slack/notifier.ts";
import { RoleChecker } from "../src/slack/roles.ts";
import { readThread, writeThread, type ThreadRecord } from "../src/slack/threads.ts";
import { STAGES, type StageId } from "../src/gate.ts";
import { Queue, createIdempotentEnqueuer } from "../src/index.ts";
import type { IssueComment, NewTicket, RecentIssue, StateType, Ticket, TicketSource } from "../src/adapters/types.ts";

// ── test fixtures ────────────────────────────────────────────────────────────

const GATE_ROLES: Record<StageId, string> = Object.fromEntries(STAGES.map((s) => [s, "Product Owner"])) as Record<StageId, string>;

async function tmpRunnerDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-slack-app-"));
  await mkdir(join(dir, ".state"), { recursive: true });
  return dir;
}

async function writeGateMap(runnerDir: string, key: string, issueId = "gate-uuid"): Promise<void> {
  const map = Object.fromEntries(STAGES.map((s) => [s, { issueId, key: `GATE-${s}`, url: `http://x/${s}` }]));
  await writeFile(join(runnerDir, ".state", `${key}.gates.json`), JSON.stringify(map), "utf8");
}

interface FakeSource extends TicketSource {
  calls: string[];
  stateType: StateType;
}

function fakeSource(stateType: StateType = "started"): FakeSource {
  const calls: string[] = [];
  const src: FakeSource = {
    calls,
    stateType,
    name: "fake",
    verify: () => true,
    parse: () => null,
    createTicket: async (t: NewTicket): Promise<Ticket> => ({
      id: "new-id",
      key: "ENG-99",
      title: t.title,
      body: t.body,
      labels: t.labels ?? [],
      url: "http://x/ENG-99",
    }),
    comment: async (issueId: string, body: string) => {
      calls.push(`comment:${issueId}:${body}`);
    },
    createSubIssue: async () => {
      throw new Error("not used");
    },
    getStateType: async (): Promise<StateType> => {
      calls.push("getStateType");
      return src.stateType;
    },
    listComments: async (): Promise<IssueComment[]> => [],
    // Mutates the fake's own state, like a real adapter would — lets a test call
    // handleGateAction twice in sequence and see the second call observe the first's effect.
    setStateType: async (issueId: string, type: "completed" | "canceled") => {
      calls.push(`setStateType:${issueId}:${type}`);
      src.stateType = type;
    },
    listRecentIssues: async () => [],
    getTicket: async (idOrKey: string): Promise<Ticket> => ({
      id: `id-${idOrKey}`,
      key: idOrKey,
      title: `title ${idOrKey}`,
      body: "",
      labels: [],
      url: `http://x/${idOrKey}`,
    }),
  };
  return src;
}

function deps(runnerDir: string, source: TicketSource, o: Partial<Omit<GateActionDeps, "runnerDir" | "source">> = {}): GateActionDeps {
  return {
    source,
    roles: o.roles ?? new RoleChecker({ roleGroups: {}, listMembers: async () => [] }),
    stateDir: o.stateDir ?? join(runnerDir, ".state"),
    runnerDir,
    isRunActive: o.isRunActive ?? (() => true),
    gateRoles: o.gateRoles ?? GATE_ROLES,
  };
}

// ── handleGateAction ─────────────────────────────────────────────────────────

test("handleGateAction: no permission -> ok:false, setStateType never called", async () => {
  const runnerDir = await tmpRunnerDir();
  await writeGateMap(runnerDir, "ENG-1");
  const source = fakeSource("started");
  const roles = new RoleChecker({ roleGroups: { "Product Owner": "S1" }, listMembers: async () => ["someone-else"] });

  const result = await handleGateAction(
    { userId: "U1", key: "ENG-1", stage: "01-plan", approved: true },
    deps(runnerDir, source, { roles }),
  );

  assert.equal(result.ok, false);
  assert.equal(source.calls.filter((c) => c.startsWith("setStateType")).length, 0);
});

test("handleGateAction: pending gate, approve -> comments then setStateType(gate-uuid, completed)", async () => {
  const runnerDir = await tmpRunnerDir();
  await writeGateMap(runnerDir, "ENG-1", "gate-uuid");
  const source = fakeSource("started");

  const result = await handleGateAction({ userId: "U1", key: "ENG-1", stage: "01-plan", approved: true }, deps(runnerDir, source));

  assert.equal(result.ok, true);
  const commentIdx = source.calls.findIndex((c) => c.startsWith("comment:"));
  const setStateIdx = source.calls.findIndex((c) => c.startsWith("setStateType:"));
  assert.ok(commentIdx >= 0, "a comment must be posted");
  assert.ok(setStateIdx >= 0, "setStateType must be called");
  assert.ok(commentIdx < setStateIdx, "comment must happen before setStateType");
  assert.equal(source.calls[setStateIdx], "setStateType:gate-uuid:completed");
});

test("handleGateAction: already completed -> ok:false '이미 승인되었습니다', setStateType never called", async () => {
  const runnerDir = await tmpRunnerDir();
  await writeGateMap(runnerDir, "ENG-1");
  const source = fakeSource("completed");

  const result = await handleGateAction({ userId: "U1", key: "ENG-1", stage: "01-plan", approved: true }, deps(runnerDir, source));

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /이미 승인되었습니다/);
  assert.equal(source.calls.filter((c) => c.startsWith("setStateType")).length, 0);
});

test("handleGateAction: already canceled -> ok:false '이미 반려되었습니다'", async () => {
  const runnerDir = await tmpRunnerDir();
  await writeGateMap(runnerDir, "ENG-1");
  const source = fakeSource("canceled");

  const result = await handleGateAction({ userId: "U1", key: "ENG-1", stage: "01-plan", approved: true }, deps(runnerDir, source));

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /이미 반려되었습니다/);
});

test("handleGateAction: reject -> reason comment happens before setStateType(…, canceled)", async () => {
  const runnerDir = await tmpRunnerDir();
  await writeGateMap(runnerDir, "ENG-1", "gate-uuid");
  const source = fakeSource("started");

  const result = await handleGateAction(
    { userId: "U1", key: "ENG-1", stage: "01-plan", approved: false, reason: "아직 준비 안 됨" },
    deps(runnerDir, source),
  );

  assert.equal(result.ok, true);
  const commentIdx = source.calls.findIndex((c) => c.startsWith("comment:"));
  const setStateIdx = source.calls.findIndex((c) => c.startsWith("setStateType:"));
  assert.ok(commentIdx >= 0 && commentIdx < setStateIdx);
  assert.equal(source.calls[setStateIdx], "setStateType:gate-uuid:canceled");
  assert.match(source.calls[commentIdx], /아직 준비 안 됨/);
});

test("handleGateAction: isRunActive=false -> ok:true with a note pointing at /sdlc run", async () => {
  const runnerDir = await tmpRunnerDir();
  await writeGateMap(runnerDir, "ENG-1");
  const source = fakeSource("started");

  const result = await handleGateAction(
    { userId: "U1", key: "ENG-1", stage: "01-plan", approved: true },
    deps(runnerDir, source, { isRunActive: () => false }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.note, "expected a note about the interrupted run");
    assert.match(result.note!, /\/sdlc run/);
  }
});

test("handleGateAction: no gate map on disk -> ok:false", async () => {
  const runnerDir = await tmpRunnerDir();
  const source = fakeSource("started");

  const result = await handleGateAction({ userId: "U1", key: "ENG-404", stage: "01-plan", approved: true }, deps(runnerDir, source));

  assert.equal(result.ok, false);
});

test("handleGateAction: records gateResolvedBy in the thread record before setStateType, when a thread exists", async () => {
  const runnerDir = await tmpRunnerDir();
  const stateDir = join(runnerDir, ".state");
  await writeGateMap(runnerDir, "ENG-1", "gate-uuid");
  const rec: ThreadRecord = {
    channel: "C1",
    threadTs: "1.1",
    ticketId: "t-1",
    stageTs: {},
    gateTs: { "01-plan": "2.2" },
    gateResolvedBy: {},
  };
  await writeThread(stateDir, "ENG-1", rec);
  const source = fakeSource("started");

  await handleGateAction({ userId: "U1", key: "ENG-1", stage: "01-plan", approved: true }, deps(runnerDir, source));

  const updated = await readThread(stateDir, "ENG-1");
  assert.equal(updated?.gateResolvedBy["01-plan"], "U1");
});

test("handleGateAction: two concurrent approve calls on the same key+stage are serialized — one succeeds, one is rejected as in-flight, setStateType runs once", async () => {
  const runnerDir = await tmpRunnerDir();
  await writeGateMap(runnerDir, "ENG-1", "gate-uuid");
  const source = fakeSource("started");
  // Slow this down deliberately: the lock must span the whole async critical section (through
  // setStateType), not just the synchronous prefix, otherwise a call that's already past the
  // pending check could still race a concurrent one here.
  const realSetStateType = source.setStateType;
  source.setStateType = async (issueId: string, type: "completed" | "canceled") => {
    await new Promise((r) => setTimeout(r, 20));
    await realSetStateType(issueId, type);
  };

  const d = deps(runnerDir, source);
  const [r1, r2] = await Promise.all([
    handleGateAction({ userId: "U1", key: "ENG-1", stage: "01-plan", approved: true }, d),
    handleGateAction({ userId: "U2", key: "ENG-1", stage: "01-plan", approved: true }, d),
  ]);

  const results = [r1, r2];
  assert.equal(results.filter((r) => r.ok).length, 1, "exactly one concurrent call should succeed");
  const rejected = results.find((r) => !r.ok);
  assert.ok(rejected && !rejected.ok);
  if (rejected && !rejected.ok) assert.match(rejected.message, /이미 처리 중/);
  assert.equal(source.calls.filter((c) => c.startsWith("setStateType")).length, 1, "setStateType must run exactly once");
});

test("handleGateAction: the in-flight lock is released after completion, so a later call for the same key+stage proceeds normally", async () => {
  const runnerDir = await tmpRunnerDir();
  await writeGateMap(runnerDir, "ENG-2", "gate-uuid-2");
  const source = fakeSource("started");
  const d = deps(runnerDir, source);

  const first = await handleGateAction({ userId: "U1", key: "ENG-2", stage: "01-plan", approved: true }, d);
  assert.equal(first.ok, true);

  // The gate is now "completed" per the fake source's fixed stateType — a later call should hit
  // the ordinary "already resolved" path, not the in-flight lock (proving the lock was released).
  const second = await handleGateAction({ userId: "U2", key: "ENG-2", stage: "01-plan", approved: true }, d);
  assert.equal(second.ok, false);
  if (!second.ok) assert.doesNotMatch(second.message, /이미 처리 중/);
});

// ── parseSdlcCommand ─────────────────────────────────────────────────────────

test("parseSdlcCommand: 'run ENG-12' -> run", () => {
  assert.deepEqual(parseSdlcCommand("run ENG-12"), { kind: "run", key: "ENG-12" });
});

test("parseSdlcCommand: 'status' -> status", () => {
  assert.deepEqual(parseSdlcCommand("status"), { kind: "status" });
});

test("parseSdlcCommand: '' -> help", () => {
  assert.deepEqual(parseSdlcCommand(""), { kind: "help" });
});

test("parseSdlcCommand: 'help' -> help", () => {
  assert.deepEqual(parseSdlcCommand("help"), { kind: "help" });
});

test("parseSdlcCommand: '결제 버그' -> create", () => {
  assert.deepEqual(parseSdlcCommand("결제 버그"), { kind: "create", title: "결제 버그" });
});

// ── createSlackNotifier ──────────────────────────────────────────────────────

function fakeClient(): SlackClientLike & { posted: any[]; updated: any[]; ephemeral: any[] } {
  const posted: any[] = [];
  const updated: any[] = [];
  const ephemeral: any[] = [];
  let tsCounter = 0;
  return {
    posted,
    updated,
    ephemeral,
    chat: {
      postMessage: async (a: any) => {
        posted.push(a);
        tsCounter += 1;
        return { ts: `${tsCounter}.0` };
      },
      update: async (a: any) => {
        updated.push(a);
        return {};
      },
      postEphemeral: async (a: any) => {
        ephemeral.push(a);
        return {};
      },
    },
  };
}

const RECENT_ISSUE: RecentIssue = {
  id: "issue-1",
  key: "ENG-7",
  title: "새 버그",
  body: "",
  labels: [],
  url: "http://x/ENG-7",
  createdAt: "2026-01-01T00:00:00.000Z",
  creator: "alice",
};

test("notifier.postTicketNotice: posts once and creates the thread file", async () => {
  const runnerDir = await tmpRunnerDir();
  const stateDir = join(runnerDir, ".state");
  const client = fakeClient();
  const notifier = createSlackNotifier({ client, channel: "C1", stateDir, roleGroups: {} });

  await notifier.postTicketNotice(RECENT_ISSUE, "new");

  assert.equal(client.posted.length, 1);
  const rec = await readThread(stateDir, "ENG-7");
  assert.ok(rec, "thread record must be created");
  assert.equal(rec?.channel, "C1");
  assert.equal(rec?.ticketId, "issue-1");
});

test("notifier: stageStarted then stageFinished update the same message ts", async () => {
  const runnerDir = await tmpRunnerDir();
  const stateDir = join(runnerDir, ".state");
  const client = fakeClient();
  const notifier = createSlackNotifier({ client, channel: "C1", stateDir, roleGroups: {} });

  await notifier.runStarted({
    key: "ENG-7",
    title: "새 버그",
    url: "http://x/ENG-7",
    labels: [],
    depth: 0,
    autoApprove: false,
    startedAt: new Date().toISOString(),
    gateRoles: GATE_ROLES,
  });
  await notifier.stageStarted("ENG-7", "01-intent");
  const postsAfterStart = client.posted.length;
  const startedTs = `${postsAfterStart}.0`; // fakeClient's postMessage returns "<call count>.0"
  await notifier.stageFinished("ENG-7", "01-intent", true, 1234);

  assert.equal(client.posted.length, postsAfterStart, "stageFinished must update, not post a new message");
  assert.equal(client.updated.length, 1);
  assert.equal(client.updated[0].ts, startedTs);
});

test("notifier.stageReworking: updates the existing gate message to show '재작업 1/3'", async () => {
  const runnerDir = await tmpRunnerDir();
  const stateDir = join(runnerDir, ".state");
  const client = fakeClient();
  const notifier = createSlackNotifier({ client, channel: "C1", stateDir, roleGroups: {} });

  await notifier.gateWaiting("ENG-7", "01-plan", "Product Owner", { issueId: "gate-1", key: "GATE-1", url: "http://x/gate-1" }, "요약");
  await notifier.stageReworking?.("ENG-7", "01-plan", 1, 3, "재검토 필요");

  assert.ok(client.updated.length >= 1, "the gate message must be updated");
  const lastUpdate = client.updated[client.updated.length - 1];
  assert.match(lastUpdate.text, /재작업 1\/3/);
});

test("notifier.interviewAnswered: posts a note into the ticket thread naming the round and answer count", async () => {
  const runnerDir = await tmpRunnerDir();
  const stateDir = join(runnerDir, ".state");
  const client = fakeClient();
  const notifier = createSlackNotifier({ client, channel: "C1", stateDir, roleGroups: {} });

  await notifier.runStarted({
    key: "ENG-7",
    title: "새 버그",
    url: "http://x/ENG-7",
    labels: [],
    depth: 0,
    autoApprove: false,
    startedAt: new Date().toISOString(),
    gateRoles: GATE_ROLES,
  });
  const postsBefore = client.posted.length;
  await notifier.interviewAnswered("ENG-7", 2, 3);

  assert.equal(client.posted.length, postsBefore + 1, "must post a new message, not update an existing one");
  const posted = client.posted[client.posted.length - 1];
  assert.match(posted.text, /3개/);
  assert.match(posted.text, /round 2|2회|2\)/);
});

test("notifier.gateWaiting: posts with reply_broadcast true", async () => {
  const runnerDir = await tmpRunnerDir();
  const stateDir = join(runnerDir, ".state");
  const client = fakeClient();
  const notifier = createSlackNotifier({ client, channel: "C1", stateDir, roleGroups: {} });

  await notifier.gateWaiting("ENG-7", "01-plan", "Product Owner", { issueId: "gate-1", key: "GATE-1", url: "http://x/gate-1" }, "요약");

  const gatePost = client.posted.find((p: any) => p.reply_broadcast === true);
  assert.ok(gatePost, "gateWaiting must post with reply_broadcast: true");
});

test("notifier.gateWaiting clears a stale gateResolvedBy for the stage so a second round's gateResolved (Linear) can update the message", async () => {
  const runnerDir = await tmpRunnerDir();
  const stateDir = join(runnerDir, ".state");
  const client = fakeClient();
  const notifier = createSlackNotifier({ client, channel: "C1", stateDir, roleGroups: {} });
  const gateRef = { issueId: "gate-1", key: "GATE-1", url: "http://x/gate-1" };

  // Round 1: gate opens, then gets resolved via the Slack button path — handleGateAction records
  // gateResolvedBy BEFORE moving the Linear card, so by the time gateResolved fires it's a no-op.
  await notifier.gateWaiting("ENG-7", "01-plan", "Product Owner", gateRef, "요약 1");
  const afterRound1Open = await readThread(stateDir, "ENG-7");
  afterRound1Open!.gateResolvedBy["01-plan"] = "U1";
  await writeThread(stateDir, "ENG-7", afterRound1Open!);
  await notifier.gateResolved("ENG-7", "01-plan", true);
  const updatesAfterRound1 = client.updated.length;

  // Round 2: the rework loop reuses the same stage id for the new gate wait. Without clearing
  // gateResolvedBy, gateResolved below would see the stale round-1 marker and skip updating.
  await notifier.gateWaiting("ENG-7", "01-plan", "Product Owner", gateRef, "요약 2");
  const recAfterReopen = await readThread(stateDir, "ENG-7");
  assert.equal(recAfterReopen?.gateResolvedBy["01-plan"], undefined, "gateWaiting must clear the stage's stale gateResolvedBy");

  await notifier.gateResolved("ENG-7", "01-plan", true);
  assert.ok(client.updated.length > updatesAfterRound1, "round 2's gateResolved (moved directly in Linear) must update the message");
});

// ── resolveSlackUserEmail / handleSdlcCreate ──────────────────────────────────

test("resolveSlackUserEmail: returns the profile email on success", async () => {
  const client = { users: { info: async (a: { user: string }) => ({ user: { profile: { email: `${a.user}@x.com` } } }) } };
  assert.equal(await resolveSlackUserEmail(client, "U1"), "U1@x.com");
});

test("resolveSlackUserEmail: degrades silently (returns undefined, does not throw) when users.info fails", async () => {
  const client = { users: { info: async () => { throw new Error("missing_scope"); } } };
  await assert.doesNotReject(async () => {
    const email = await resolveSlackUserEmail(client, "U1");
    assert.equal(email, undefined);
  });
});

test("handleSdlcCreate: resolves the inviting user's email and attaches it as the new ticket's creatorEmail", async () => {
  const runnerDir = await tmpRunnerDir();
  const source = fakeSource("started");
  const notices: Array<{ t: any; state: string }> = [];
  const setEmails: Array<[string, string]> = [];

  const result = await handleSdlcCreate(
    { title: "결제 버그", userId: "U1", userName: "alice" },
    {
      source,
      notifier: { postTicketNotice: async (t: any, state: any) => { notices.push({ t, state }); } },
      enqueue: () => 1,
      resolveEmail: async () => "alice@example.com",
      setRequesterEmail: (key, email) => setEmails.push([key, email]),
      startMode: "button",
    },
  );

  assert.equal(result.ok, true);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].t.creatorEmail, "alice@example.com", "the posted notice's ticket must carry the resolved email");
  assert.deepEqual(setEmails, [["ENG-99", "alice@example.com"]], "setRequesterEmail must be called so a later button-start still finds it");
});

test("handleSdlcCreate: degrades silently when email resolution fails — ticket is still created and announced", async () => {
  const runnerDir = await tmpRunnerDir();
  const source = fakeSource("started");
  const notices: Array<{ t: any; state: string }> = [];

  const result = await handleSdlcCreate(
    { title: "결제 버그", userId: "U1", userName: "alice" },
    {
      source,
      notifier: { postTicketNotice: async (t: any, state: any) => { notices.push({ t, state }); } },
      enqueue: () => 1,
      resolveEmail: async () => undefined,
      startMode: "button",
    },
  );

  assert.equal(result.ok, true);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].t.creatorEmail, undefined);
});

test("handleSdlcCreate: startMode auto enqueues the ticket (with creatorEmail attached)", async () => {
  const runnerDir = await tmpRunnerDir();
  const source = fakeSource("started");
  const enqueued: any[] = [];

  const result = await handleSdlcCreate(
    { title: "결제 버그", userId: "U1", userName: "alice" },
    {
      source,
      notifier: { postTicketNotice: async () => {} },
      enqueue: (t: any) => {
        enqueued.push(t);
        return 1;
      },
      resolveEmail: async () => "alice@example.com",
      startMode: "auto",
    },
  );

  assert.equal(result.ok, true);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].creatorEmail, "alice@example.com");
});

// ── isSlackStartupRejection ──────────────────────────────────────────────────

test("isSlackStartupRejection: a @slack/web-api WebAPIPlatformError-shaped error is recognised", () => {
  class WebAPIPlatformError extends Error {
    data = { ok: false, error: "invalid_auth" };
  }
  assert.equal(isSlackStartupRejection(new WebAPIPlatformError("An API error occurred: invalid_auth")), true);
});

test("isSlackStartupRejection: any error carrying an unrecoverable socket-mode start code is recognised, regardless of class name", () => {
  class SomeOtherError extends Error {
    data = { error: "account_inactive" };
  }
  assert.equal(isSlackStartupRejection(new SomeOtherError("boom")), true);
});

test("isSlackStartupRejection: an error whose stack runs through node_modules/@slack/* is recognised", () => {
  const err = new Error("mystery failure");
  err.stack = "Error: mystery failure\n    at WebClient.apiCall (/app/node_modules/@slack/web-api/dist/WebClient.js:206:19)";
  assert.equal(isSlackStartupRejection(err), true);
});

test("isSlackStartupRejection: an ordinary application error is NOT recognised as Slack-related", () => {
  const err = new Error("pipeline stage 03-build failed: exit 1");
  err.stack = "Error: pipeline stage 03-build failed\n    at runStage (/app/src/claude.ts:42:9)";
  assert.equal(isSlackStartupRejection(err), false);
});

test("isSlackStartupRejection: a non-Error rejection reason is NOT recognised as Slack-related", () => {
  assert.equal(isSlackStartupRejection("just a string rejection"), false);
  assert.equal(isSlackStartupRejection({ error: "invalid_auth" }), false);
  assert.equal(isSlackStartupRejection(undefined), false);
});

// ── shouldBlockDoubleStart ───────────────────────────────────────────────────

test("shouldBlockDoubleStart: not active -> false", () => {
  assert.equal(shouldBlockDoubleStart("ENG-1", () => false), false);
});

test("shouldBlockDoubleStart: active -> true", () => {
  assert.equal(shouldBlockDoubleStart("ENG-1", (key: string) => key === "ENG-1"), true);
});

test("shouldBlockDoubleStart: a different key being active does not block this one", () => {
  assert.equal(shouldBlockDoubleStart("ENG-2", (key: string) => key === "ENG-1"), false);
});

// ── createIdempotentEnqueuer ─────────────────────────────────────────────────
// Fix round 2: `activeKeys` used to be set only once a queued task actually started executing,
// so (a) a finished run's key stayed blocked forever (no separate "started" bookkeeping was ever
// cleared) and (b) two starts for a key still waiting in line both looked "not active yet" and
// could both be queued. These tests exercise the real `Queue` together with
// `createIdempotentEnqueuer`, the way index.ts actually wires `enqueue`/`isRunActive`.

test("createIdempotentEnqueuer: a key is active again as soon as its run completes, so starting it again is accepted (not blocked forever)", async () => {
  const queue = new Queue();
  let runCount = 0;
  const { enqueue, isActive } = createIdempotentEnqueuer<{ key: string; id: string }>(queue, async () => {
    runCount++;
  });
  const ticket = { key: "ENG-1", id: "t-1" };

  const firstPosition = enqueue(ticket);
  assert.equal(firstPosition, 1, "first enqueue starts right away");
  assert.equal(isActive("ENG-1"), true);

  await new Promise((r) => setTimeout(r, 10)); // let the queue actually finish draining this run

  assert.equal(isActive("ENG-1"), false, "the key must no longer be active once the run settles");
  assert.equal(runCount, 1);

  const secondPosition = enqueue(ticket);
  assert.notEqual(secondPosition, 0, "starting the same key again after completion must be accepted, not rejected as a duplicate");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(runCount, 2, "runOne must actually run a second time");
});

test("createIdempotentEnqueuer: two starts for the same key while the first is still waiting in the queue -> only one enqueue happens", async () => {
  const queue = new Queue();
  const runCalls: string[] = [];
  let resolveBlocker: () => void = () => {};
  const blocker = new Promise<void>((r) => {
    resolveBlocker = r;
  });

  const { enqueue, isActive } = createIdempotentEnqueuer<{ key: string; id: string }>(queue, async (t) => {
    runCalls.push(t.key);
    if (t.key === "BLOCKER") await blocker;
  });

  // Occupy the queue's one execution slot with an unrelated, slow run, so the next ticket has to
  // wait in line rather than start running immediately.
  enqueue({ key: "BLOCKER", id: "b-1" });

  const ticket = { key: "ENG-3", id: "t-3" };
  const firstPosition = enqueue(ticket); // queued behind BLOCKER — not yet running
  const secondPosition = enqueue(ticket); // duplicate start while ENG-3 is still only queued

  assert.equal(firstPosition, 2, "ENG-3 is second in line, behind BLOCKER");
  assert.equal(secondPosition, 0, "a duplicate start for a key that's still only queued must be rejected, not queued again");
  assert.equal(isActive("ENG-3"), true);

  resolveBlocker();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(runCalls.filter((k) => k === "ENG-3").length, 1, "ENG-3's runOne must run exactly once");
  assert.equal(isActive("ENG-3"), false);
});
