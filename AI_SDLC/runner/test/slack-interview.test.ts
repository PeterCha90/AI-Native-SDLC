import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSlackInterviewChannel } from "../src/slack/interview.ts";
import { writeThread, type ThreadRecord } from "../src/slack/threads.ts";
import type { SlackClientLike } from "../src/slack/notifier.ts";

// ── fixtures ─────────────────────────────────────────────────────────────────

async function tmpStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-slack-interview-"));
  await mkdir(join(dir, ".state"), { recursive: true });
  return join(dir, ".state");
}

interface FakeClient extends SlackClientLike {
  posted: any[];
  updated: any[];
  lookupCalls: string[];
  lookupResult: (email: string) => Promise<{ user?: { id?: string } }>;
  users: { lookupByEmail(a: { email: string }): Promise<{ user?: { id?: string } }> };
}

function fakeClient(lookupResult?: (email: string) => Promise<{ user?: { id?: string } }>): FakeClient {
  const posted: any[] = [];
  const updated: any[] = [];
  const lookupCalls: string[] = [];
  let tsCounter = 0;
  const client: FakeClient = {
    posted,
    updated,
    lookupCalls,
    lookupResult: lookupResult ?? (async (email) => ({ user: { id: `U-${email}` } })),
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
      postEphemeral: async () => ({}),
    },
    users: {
      lookupByEmail: async (a: { email: string }) => {
        lookupCalls.push(a.email);
        return client.lookupResult(a.email);
      },
    },
  };
  return client;
}

async function seedThread(stateDir: string, key: string, rec: Partial<ThreadRecord> = {}): Promise<void> {
  await writeThread(stateDir, key, {
    channel: "C1",
    threadTs: "100.0",
    ticketId: "t-1",
    stageTs: {},
    gateTs: {},
    gateResolvedBy: {},
    ...rec,
  });
}

// `ask()`'s returned promise doesn't resolve until a button press or the timeout, so tests that
// need to inspect its *intermediate* effects (the post, the freshly-written .interview.json) can't
// just `await` it. A fixed wall-clock sleep (the previous approach) races the real async chain
// inside ask() — readThread -> lookupByEmail -> chat.postMessage -> writeJsonAtomic — which does
// real disk I/O and can take longer than a few ms when the whole suite runs many test files'
// worth of fs work concurrently (`npm test`), even though it's instant in isolation. That produced
// intermittent failures (e.g. onThreadMessage racing ahead of ask()'s own state-file write and
// hitting its "existing === null" fallback, which types answers but withholds messageTs and so
// stays "안읽음" for the update). Poll for the real completion signal — the state file actually
// containing the round `ask()` just posted — instead of guessing a sleep duration.
async function waitForInterviewRound(stateDir: string, key: string, round: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      const raw = await readFile(join(stateDir, `${key}.interview.json`), "utf8");
      const state = JSON.parse(raw);
      if (state.round === round) return;
    } catch {
      // Not written yet (ENOENT) or mid-write (partial JSON) — keep polling.
    }
    if (Date.now() > deadline) {
      throw new Error(`waitForInterviewRound: ${key} round ${round} never appeared within 5s`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ── ask() ────────────────────────────────────────────────────────────────────

test("ask: posts once to the ticket thread, mentions the requester, and writes .state/<key>.interview.json", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-1");
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: (key) => (key === "ENG-1" ? "alice@example.com" : undefined),
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-1", ["질문 하나", "질문 둘"], 1, 5);

  await waitForInterviewRound(stateDir, "ENG-1", 1);

  assert.equal(client.posted.length, 1, "ask must post exactly once");
  const posted = client.posted[0];
  assert.equal(posted.thread_ts, "100.0");
  assert.match(posted.text, /<@U-alice@example\.com>/, "must mention the requester");

  const raw = await readFile(join(stateDir, "ENG-1.interview.json"), "utf8");
  const state = JSON.parse(raw);
  assert.equal(state.round, 1);
  assert.deepEqual(state.questions, ["질문 하나", "질문 둘"]);
  assert.equal(state.answers.length, 0);
  assert.equal(state.messageTs, "1.0");

  // Resolve so the test doesn't leave a dangling timer.
  await channel.onButton("ENG-1", "proceed", "U-someone");
  await pending;
});

test("ask: lookupByEmail failure -> message has no mention", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-2");
  const client = fakeClient(async () => {
    throw new Error("users_not_found");
  });
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => "ghost@example.com",
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-2", ["질문"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-2", 1);

  const posted = client.posted[0];
  assert.doesNotMatch(posted.text, /<@/, "must not contain a Slack mention when lookup fails");

  await channel.onButton("ENG-2", "proceed", "U-someone");
  await pending;
});

test("ask: no requester email at all -> message has no mention", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-9");
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-9", ["질문"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-9", 1);

  assert.doesNotMatch(client.posted[0].text, /<@/);
  assert.equal(client.lookupCalls.length, 0, "no email means lookupByEmail is never called");

  await channel.onButton("ENG-9", "proceed", "U-someone");
  await pending;
});

// ── onThreadMessage ──────────────────────────────────────────────────────────

test("onThreadMessage: messages outside the open interview thread are ignored", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-3");
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-3", ["질문"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-3", 1);

  await channel.onThreadMessage({ threadTs: "999.0", user: "U-bob", text: "엉뚱한 스레드", ts: "999.1" });
  const raw = await readFile(join(stateDir, "ENG-3.interview.json"), "utf8");
  assert.equal(JSON.parse(raw).answers.length, 0);

  await channel.onButton("ENG-3", "proceed", "U-someone");
  await pending;
});

test("onThreadMessage: bot messages and subtyped messages (edits/deletes) in the open thread are ignored", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-4");
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-4", ["질문"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-4", 1);

  await channel.onThreadMessage({ threadTs: "100.0", user: "U-bot", botId: "B1", text: "봇 메시지", ts: "100.1" });
  await channel.onThreadMessage({ threadTs: "100.0", user: "U-bob", subtype: "message_changed", text: "수정됨", ts: "100.2" });

  const raw = await readFile(join(stateDir, "ENG-4.interview.json"), "utf8");
  assert.equal(JSON.parse(raw).answers.length, 0);

  await channel.onButton("ENG-4", "proceed", "U-someone");
  await pending;
});

test("onThreadMessage: two real replies accumulate, and the message update shows the count", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-5");
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-5", ["질문"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-5", 1);

  await channel.onThreadMessage({ threadTs: "100.0", user: "U-bob", text: "답1", ts: "100.1" });
  await channel.onThreadMessage({ threadTs: "100.0", user: "U-carol", text: "답2", ts: "100.2" });

  const raw = await readFile(join(stateDir, "ENG-5.interview.json"), "utf8");
  assert.equal(JSON.parse(raw).answers.length, 2);

  const lastUpdate = client.updated[client.updated.length - 1];
  assert.match(JSON.stringify(lastUpdate.blocks), /2/, "the updated message must show the new answer count");

  await channel.onButton("ENG-5", "apply", "U-someone");
  const outcome = await pending;
  assert.equal(outcome.kind, "answers");
  if (outcome.kind === "answers") assert.equal(outcome.answers.length, 2);
});

test("onThreadMessage: after the state-file-missing fallback, a second reply never calls chat.update with an empty ts", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-9");
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-9", ["질문"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-9", 1);

  // Simulate the state file going missing out-of-band (e.g. deleted) — ask() has already
  // returned its pending promise, so the in-memory ActiveAsk is still tracking this thread.
  await rm(join(stateDir, "ENG-9.interview.json"));

  // First reply after the file vanished: hits the "existing === null" fallback, which persists a
  // fresh state with messageTs:"" and — per the existing guard — must skip the chat.update (no
  // reliable ts to edit yet).
  await channel.onThreadMessage({ threadTs: "100.0", user: "U-bob", text: "답1", ts: "100.1" });
  assert.equal(client.updated.length, 0, "first reply after the fallback must not call chat.update");

  // Second reply: the state file now exists again (written by the fallback above) but its
  // messageTs is still "" — chat.update must still be skipped rather than called with ts:"".
  await channel.onThreadMessage({ threadTs: "100.0", user: "U-carol", text: "답2", ts: "100.2" });
  assert.equal(client.updated.length, 0, "a second reply must still skip chat.update while messageTs is empty");
  assert.ok(
    client.updated.every((u: any) => u.ts !== ""),
    "chat.update must never be called with an empty ts",
  );

  await channel.onButton("ENG-9", "apply", "U-someone");
  await pending;
});

// ── onButton ─────────────────────────────────────────────────────────────────

test("onButton apply with 2 collected answers -> ask() resolves {kind:'answers', answers:[2]}", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-6");
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-6", ["질문"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-6", 1);
  await channel.onThreadMessage({ threadTs: "100.0", user: "U-bob", text: "답1", ts: "100.1" });
  await channel.onThreadMessage({ threadTs: "100.0", user: "U-carol", text: "답2", ts: "100.2" });

  const result = await channel.onButton("ENG-6", "apply", "U-po");
  assert.equal(result.ok, true);

  const outcome = await pending;
  assert.equal(outcome.kind, "answers");
  if (outcome.kind === "answers") {
    assert.equal(outcome.answers.length, 2);
    assert.deepEqual(
      outcome.answers.map((a) => a.text),
      ["답1", "답2"],
    );
  }
});

test("onButton apply with 0 collected answers -> behaves like proceed", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-7");
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-7", ["질문"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-7", 1);

  const result = await channel.onButton("ENG-7", "apply", "U-po");
  assert.equal(result.ok, true);

  const outcome = await pending;
  assert.equal(outcome.kind, "proceed");
});

test("onButton proceed -> ask() resolves {kind:'proceed'} immediately, regardless of answers", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-8");
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-8", ["질문"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-8", 1);
  await channel.onThreadMessage({ threadTs: "100.0", user: "U-bob", text: "답1", ts: "100.1" });

  const result = await channel.onButton("ENG-8", "proceed", "U-po");
  assert.equal(result.ok, true);

  const outcome = await pending;
  assert.equal(outcome.kind, "proceed");
});

test("onButton: a key with no pending ask (runner restarted) -> ok:false with /sdlc run note", async () => {
  const stateDir = await tmpStateDir();
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 60_000,
  });

  const result = await channel.onButton("ENG-GONE", "apply", "U-po");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message!, /\/sdlc run/);
});

// ── timeout ──────────────────────────────────────────────────────────────────

test("ask: resolves {kind:'timeout'} after timeoutMs with no button press or reply", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-10");
  const client = fakeClient();
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 20,
  });

  // The interview channel's own timer is deliberately unref()'d (it must never keep a real runner
  // process alive on its own — see the fix for point 3 of review round 1) — in production the HTTP
  // server/queue keep the event loop alive regardless, but in this isolated test nothing else
  // does. Hold a ref'd keep-alive handle for the duration so the unref'd timer still gets a chance
  // to fire, same as it would inside the real runner process.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const outcome = await channel.ask("ENG-10", ["질문"], 1, 5);
    assert.equal(outcome.kind, "timeout");
  } finally {
    clearInterval(keepAlive);
  }
});

// ── concurrency ──────────────────────────────────────────────────────────────

test("onButton: two near-simultaneous presses (apply + proceed) on the same key are serialized — one settles, one is rejected as in-flight, and the final message matches the settled outcome", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-11");
  const client = fakeClient();
  // Slow this down deliberately: the lock must span the whole async critical section (through
  // chat.update), not just the synchronous prefix, otherwise a call already past the "is there a
  // pending ask" check could still race a concurrent one here.
  const realUpdate = client.chat.update;
  client.chat.update = async (a: any) => {
    await new Promise((r) => setTimeout(r, 20));
    return realUpdate(a);
  };
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => undefined,
    timeoutMs: 60_000,
  });

  const pending = channel.ask("ENG-11", ["질문"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-11", 1);
  await channel.onThreadMessage({ threadTs: "100.0", user: "U-bob", text: "답1", ts: "100.1" });

  const [applyResult, proceedResult] = await Promise.all([
    channel.onButton("ENG-11", "apply", "U-po1"),
    channel.onButton("ENG-11", "proceed", "U-po2"),
  ]);

  const results = [applyResult, proceedResult];
  assert.equal(results.filter((r) => r.ok).length, 1, "exactly one concurrent press should settle the ask");
  const rejected = results.find((r) => !r.ok);
  assert.ok(rejected && !rejected.ok);
  if (rejected && !rejected.ok) assert.match(rejected.message!, /이미 처리 중/);

  const outcome = await pending;
  // Only "apply" (with the one collected answer) can win the race, since "apply" is issued first
  // and holds the lock for the whole critical section — "proceed" can never observe the ask as
  // still pending once "apply" has started.
  assert.equal(outcome.kind, "answers");

  const lastUpdate = client.updated[client.updated.length - 1];
  assert.match(lastUpdate.text, /답변 1개를 반영했습니다/, "the final Slack message must reflect the settled outcome, not a partial/raced one");
});

// ── missing_scope warning ────────────────────────────────────────────────────

test("ask: a missing_scope lookup failure is logged once per channel instance, not once per round", async () => {
  const stateDir = await tmpStateDir();
  await seedThread(stateDir, "ENG-12");
  const client = fakeClient(async () => {
    const err = new Error("missing_scope") as Error & { data?: { error?: string } };
    err.data = { error: "missing_scope" };
    throw err;
  });
  const logs: string[] = [];
  const channel = createSlackInterviewChannel({
    client,
    channel: "C1",
    stateDir,
    getRequesterEmail: () => "alice@example.com",
    timeoutMs: 60_000,
    log: (m) => logs.push(m),
  });

  const first = channel.ask("ENG-12", ["질문1"], 1, 5);
  await waitForInterviewRound(stateDir, "ENG-12", 1);
  await channel.onButton("ENG-12", "proceed", "U-x");
  await first;

  const second = channel.ask("ENG-12", ["질문2"], 2, 5);
  await waitForInterviewRound(stateDir, "ENG-12", 2);
  await channel.onButton("ENG-12", "proceed", "U-x");
  await second;

  assert.equal(client.lookupCalls.length, 2, "both rounds must attempt the lookup");
  assert.equal(logs.length, 1, "the missing_scope warning must be logged only once per channel instance");
});
