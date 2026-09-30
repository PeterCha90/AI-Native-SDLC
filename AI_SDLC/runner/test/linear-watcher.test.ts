import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinearWatcher, type WatchState } from "../src/linear-watcher.ts";

/**
 * LinearWatcher is generic over the issue shape so it never has to import the
 * RecentIssue type another implementer owns — it only needs `id` and `createdAt`.
 */
interface FakeIssue {
  id: string;
  createdAt: string;
}

function issue(id: string, createdAt: string): FakeIssue {
  return { id, createdAt };
}

async function tempStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-linear-watcher-"));
  // Nested so we exercise the mkdir-recursive-before-write behaviour.
  return join(dir, "nested", "watch-state.json");
}

async function readState(statePath: string): Promise<WatchState> {
  return JSON.parse(await readFile(statePath, "utf8"));
}

test("first poll() with no state file sets cursor=now(), notifies nothing, returns 0", async () => {
  const statePath = await tempStatePath();
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");
  let listCalls = 0;
  const notified: FakeIssue[] = [];

  const watcher = new LinearWatcher<FakeIssue>({
    listRecentIssues: async () => {
      listCalls++;
      return [];
    },
    statePath,
    intervalMs: 1000,
    onNew: async (t) => {
      notified.push(t);
    },
    now: () => fixedNow,
  });

  const count = await watcher.poll();

  assert.equal(count, 0);
  assert.equal(listCalls, 0, "first poll must not call listRecentIssues at all");
  assert.deepEqual(notified, []);

  const state = await readState(statePath);
  assert.equal(state.cursor, fixedNow.toISOString());
  assert.deepEqual(state.seen, []);
});

test("second poll with two new issues notifies onNew twice and advances cursor to the max createdAt", async () => {
  const statePath = await tempStatePath();
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");
  const notified: FakeIssue[] = [];

  const issues = [issue("a", "2026-01-01T00:05:00.000Z"), issue("b", "2026-01-01T00:10:00.000Z")];

  const watcher = new LinearWatcher<FakeIssue>({
    listRecentIssues: async () => issues,
    statePath,
    intervalMs: 1000,
    onNew: async (t) => {
      notified.push(t);
    },
    now: () => fixedNow,
  });

  await watcher.poll(); // primes cursor=now, calls listRecentIssues 0 times
  const count = await watcher.poll();

  assert.equal(count, 2);
  assert.deepEqual(
    notified.map((n) => n.id),
    ["a", "b"],
  );

  const state = await readState(statePath);
  assert.equal(state.cursor, "2026-01-01T00:10:00.000Z");
  assert.deepEqual(state.seen.sort(), ["a", "b"]);
});

test("an issue that reappears in a later poll is not re-notified", async () => {
  const statePath = await tempStatePath();
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");
  const notified: FakeIssue[] = [];
  let issues = [issue("a", "2026-01-01T00:05:00.000Z")];

  const watcher = new LinearWatcher<FakeIssue>({
    listRecentIssues: async () => issues,
    statePath,
    intervalMs: 1000,
    onNew: async (t) => {
      notified.push(t);
    },
    now: () => fixedNow,
  });

  await watcher.poll(); // prime
  const first = await watcher.poll();
  assert.equal(first, 1);

  // "a" appears again in a subsequent fetch window (e.g. cursor semantics overlap)
  issues = [issue("a", "2026-01-01T00:05:00.000Z")];
  const second = await watcher.poll();
  assert.equal(second, 0);
  assert.equal(notified.length, 1, "onNew must only fire once for the same id");
});

test("a fetch failure leaves the cursor unchanged and the missed issue is notified next poll", async () => {
  const statePath = await tempStatePath();
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");
  const notified: FakeIssue[] = [];
  let shouldFail = false;
  const pending = [issue("a", "2026-01-01T00:05:00.000Z")];

  const watcher = new LinearWatcher<FakeIssue>({
    listRecentIssues: async (since) => {
      if (shouldFail) throw new Error("boom: linear API down");
      return pending;
    },
    statePath,
    intervalMs: 1000,
    onNew: async (t) => {
      notified.push(t);
    },
    now: () => fixedNow,
  });

  await watcher.poll(); // prime, cursor = now

  const stateBefore = await readState(statePath);

  shouldFail = true;
  const failed = await watcher.poll();
  assert.equal(failed, 0);

  const stateAfterFailure = await readState(statePath);
  assert.equal(stateAfterFailure.cursor, stateBefore.cursor, "cursor must be unchanged on fetch failure");

  shouldFail = false;
  const recovered = await watcher.poll();
  assert.equal(recovered, 1);
  assert.deepEqual(
    notified.map((n) => n.id),
    ["a"],
  );
});

test("onNew failure is logged and the issue is still treated as seen (no repeat notification attempts)", async () => {
  const statePath = await tempStatePath();
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");
  const logs: string[] = [];
  let onNewCalls = 0;
  const issues = [issue("a", "2026-01-01T00:05:00.000Z")];

  const watcher = new LinearWatcher<FakeIssue>({
    listRecentIssues: async () => issues,
    statePath,
    intervalMs: 1000,
    onNew: async () => {
      onNewCalls++;
      throw new Error("handler exploded");
    },
    now: () => fixedNow,
    log: (m) => logs.push(m),
  });

  await watcher.poll(); // prime
  const count = await watcher.poll();

  // onNew failure must be counted as "handled", not left pending forever, and
  // must not itself count toward the returned "notified" total since the
  // handler never completed successfully.
  assert.equal(count, 0);
  assert.equal(onNewCalls, 1);
  assert.ok(
    logs.some((m) => m.includes("handler exploded")),
    "must log the onNew failure",
  );

  const state = await readState(statePath);
  assert.ok(state.seen.includes("a"));

  // Poll again: "a" must not trigger onNew a second time.
  const again = await watcher.poll();
  assert.equal(again, 0);
  assert.equal(onNewCalls, 1, "onNew must not be retried for an id already marked seen");
});

test("markSeen(id) prevents that id from being notified even on its first appearance", async () => {
  const statePath = await tempStatePath();
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");
  const notified: FakeIssue[] = [];
  const issues = [issue("x", "2026-01-01T00:05:00.000Z")];

  const watcher = new LinearWatcher<FakeIssue>({
    listRecentIssues: async () => issues,
    statePath,
    intervalMs: 1000,
    onNew: async (t) => {
      notified.push(t);
    },
    now: () => fixedNow,
  });

  await watcher.poll(); // prime, creates state file
  await watcher.markSeen("x");

  const count = await watcher.poll();
  assert.equal(count, 0);
  assert.deepEqual(notified, []);
});

test("seen list is capped at 500 entries, dropping the oldest first", async () => {
  const statePath = await tempStatePath();
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");

  const watcher = new LinearWatcher<FakeIssue>({
    listRecentIssues: async () => [],
    statePath,
    intervalMs: 1000,
    onNew: async () => {},
    now: () => fixedNow,
  });

  await watcher.poll(); // prime

  for (let i = 0; i < 501; i++) {
    await watcher.markSeen(`id-${i}`);
  }

  const state = await readState(statePath);
  assert.equal(state.seen.length, 500);
  assert.ok(!state.seen.includes("id-0"), "oldest entry must have been dropped");
  assert.ok(state.seen.includes("id-500"), "newest entry must be retained");
});

test("markSeen() issued while poll() is awaiting a slow listRecentIssues is not lost — after both finish, the file has the marked id plus poll's own cursor/seen", async () => {
  const statePath = await tempStatePath();
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");
  const notified: FakeIssue[] = [];
  const issues = [issue("a", "2026-01-01T00:05:00.000Z")];
  let releaseFetch: (() => void) | null = null;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });

  const watcher = new LinearWatcher<FakeIssue>({
    listRecentIssues: async () => {
      await fetchGate; // held open until the test fires markSeen()
      return issues;
    },
    statePath,
    intervalMs: 1000,
    onNew: async (t) => {
      notified.push(t);
    },
    now: () => fixedNow,
  });

  await watcher.poll(); // prime: seeds cursor, no fetch

  const pollPromise = watcher.poll(); // this poll's listRecentIssues is now stuck on fetchGate
  const markSeenPromise = watcher.markSeen("z"); // races the poll's read-modify-write
  releaseFetch!();
  await Promise.all([pollPromise, markSeenPromise]);

  const state = await readState(statePath);
  assert.ok(state.seen.includes("z"), "markSeen's id must not be lost to poll's write");
  assert.ok(state.seen.includes("a"), "poll's own newly-seen id must still be recorded");
  assert.equal(state.cursor, "2026-01-01T00:05:00.000Z", "poll's cursor advance must not be lost either");
  assert.deepEqual(
    notified.map((n) => n.id),
    ["a"],
  );
});

test("stop() clears the timer so start()'d polling does not continue", async () => {
  const statePath = await tempStatePath();
  let pollCount = 0;

  const watcher = new LinearWatcher<FakeIssue>({
    listRecentIssues: async () => {
      pollCount++;
      return [];
    },
    statePath,
    intervalMs: 5,
    onNew: async () => {},
  });

  watcher.start();
  await new Promise((r) => setTimeout(r, 30));
  watcher.stop();
  // clearInterval() above is synchronous, so no *new* tick can start from here on.
  // But a tick that fired just before stop() may still be mid-poll (e.g. inside the
  // readState() await, before it has even called listRecentIssues yet) — awaiting
  // idle() here, rather than just snapshotting pollCount immediately, is what makes
  // this deterministic instead of racing that in-flight poll against the snapshot.
  await watcher.idle();
  const countAfterStop = pollCount;
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(pollCount, countAfterStop, "no further polls should happen after stop()");
});

test("start() never overlaps polls — ticks that fire while a fetch is still pending are no-ops", async () => {
  const statePath = await tempStatePath();
  let callCount = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  let releaseFirstFetch: (() => void) | null = null;
  const firstFetchGate = new Promise<void>((resolve) => {
    releaseFirstFetch = resolve;
  });

  const watcher = new LinearWatcher<FakeIssue>({
    listRecentIssues: async () => {
      callCount++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      if (callCount === 1) {
        await firstFetchGate; // held open by the test until we're done asserting
      }
      concurrent--;
      return [];
    },
    statePath,
    intervalMs: 5,
    onNew: async () => {},
  });

  await watcher.poll(); // prime: seeds cursor, does not call listRecentIssues

  watcher.start();
  // Let many 5ms ticks elapse while the first real fetch is deliberately stuck.
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(callCount, 1, "a tick firing while a fetch is in flight must not start a second one");
  assert.equal(concurrent, 1, "exactly one listRecentIssues call should be pending");
  assert.equal(maxConcurrent, 1, "at no point should more than one listRecentIssues call be in flight");

  releaseFirstFetch!();
  await watcher.idle(); // let the first poll finish and release the "polling" guard

  await new Promise((r) => setTimeout(r, 25)); // polling may now resume
  watcher.stop();
  await watcher.idle();

  assert.ok(callCount > 1, "polling should resume once the blocked fetch resolves");
  assert.equal(maxConcurrent, 1, "the overlap guard must hold for the entire run, not just the blocked window");
});
