import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * On-disk cursor + dedupe record. `seen` is capped at MAX_SEEN entries so the
 * file doesn't grow forever; entries are dropped oldest-first because dedupe
 * only needs to cover the ids a poll could plausibly re-fetch near the cursor.
 */
export interface WatchState {
  cursor: string;
  seen: string[];
}

const MAX_SEEN = 500;

export interface LinearWatcherOptions<T extends { id: string; createdAt: string }> {
  listRecentIssues: (since: string) => Promise<T[]>;
  statePath: string;
  intervalMs: number;
  onNew: (t: T) => Promise<void>;
  /** Injected for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  log?: (m: string) => void;
  /**
   * On the first poll only (no state file yet), also fetches issues created within the last
   * `sinceMs` and hands each one `include` accepts to `onNew`, oldest first — catching up on
   * tickets that existed before the watcher's very first start, which the plain
   * cursor=now()-and-notify-nothing seeding would otherwise skip forever (see poll() below).
   * Every fetched issue — included or not — is marked seen, and the cursor is advanced to
   * cover them, so this catch-up window is never re-fetched by the next ordinary poll.
   * Omitted entirely, behaviour is unchanged: first poll seeds cursor=now() and notifies nothing.
   */
  catchUp?: { sinceMs: number; include: (t: T) => boolean };
}

/**
 * Polls a ticket source for newly created tickets and hands each one to `onNew`
 * exactly once, persisting a cursor + seen-id file so a restart doesn't replay
 * or drop tickets.
 *
 * Generic over the issue shape (only `id` and `createdAt` are needed) rather
 * than importing a concrete `RecentIssue` type, so this module has no
 * compile-time dependency on whichever adapter produces that type.
 */
export class LinearWatcher<T extends { id: string; createdAt: string }> {
  private readonly listRecentIssues: (since: string) => Promise<T[]>;
  private readonly statePath: string;
  private readonly intervalMs: number;
  private readonly onNew: (t: T) => Promise<void>;
  private readonly now: () => Date;
  private readonly log: (m: string) => void;
  private readonly catchUp?: { sinceMs: number; include: (t: T) => boolean };

  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  /** Resolves when the most recently started tick's poll() settles. Lets tests (and
   *  callers) observe "no poll in flight" deterministically instead of racing stop()
   *  against an in-flight readState()/listRecentIssues() that started just before it. */
  private currentPoll: Promise<void> = Promise.resolve();
  /**
   * Serializes every read-modify-write section against `statePath` through one in-process
   * promise chain, so `poll()` and `markSeen()` — which can otherwise run concurrently, since
   * `markSeen()` isn't gated by the `polling` flag — never interleave a read from one with a
   * write from the other. The network fetch inside `poll()` deliberately stays OUTSIDE this
   * lock (only the state file I/O needs serializing, not the whole poll cycle), so a slow
   * `listRecentIssues()` doesn't block `markSeen()` from running and completing while it's in
   * flight; `poll()` re-acquires the lock and re-reads state afterwards, before merging in what
   * it fetched, so a `markSeen()` that ran during the fetch is never lost.
   */
  private lock: Promise<void> = Promise.resolve();

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.lock.then(fn, fn);
    this.lock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  constructor(o: LinearWatcherOptions<T>) {
    this.listRecentIssues = o.listRecentIssues;
    this.statePath = o.statePath;
    this.intervalMs = o.intervalMs;
    this.onNew = o.onNew;
    this.now = o.now ?? (() => new Date());
    this.log = o.log ?? console.log;
    this.catchUp = o.catchUp;
  }

  private async readState(): Promise<WatchState | null> {
    if (!existsSync(this.statePath)) return null;
    try {
      const raw = await readFile(this.statePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return null;
      const { cursor, seen } = parsed as Record<string, unknown>;
      if (typeof cursor !== "string") return null;
      return {
        cursor,
        seen: Array.isArray(seen) ? seen.filter((x): x is string => typeof x === "string") : [],
      };
    } catch (err) {
      this.log(`[linear-watcher] failed to read state file, treating as absent: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Writes via a `<statePath>.tmp` + rename so a crash or concurrent reader
   * never observes a half-written file — `rename` within the same
   * directory is atomic on the filesystems we run on (POSIX, NTFS).
   */
  private async writeState(state: WatchState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const seen = state.seen.length > MAX_SEEN ? state.seen.slice(state.seen.length - MAX_SEEN) : state.seen;
    const tmpPath = `${this.statePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify({ cursor: state.cursor, seen }, null, 2), "utf8");
    await rename(tmpPath, this.statePath);
  }

  /**
   * Runs one poll cycle and returns the number of tickets successfully handed
   * to `onNew`.
   *
   * No state file yet → this is the first run, handled by `firstPoll()`: without
   * `catchUp` configured, the cursor is seeded to `now()` and nothing is fetched or
   * notified, so a fresh watcher never floods `onNew` with every pre-existing ticket.
   * With `catchUp`, a bounded window before `now()` is fetched once and run through
   * `include()` instead.
   *
   * A fetch failure leaves the cursor untouched so the missed window is
   * retried on the next poll. An `onNew` failure is logged but the ticket is
   * still marked seen — re-delivering a ticket whose handler already ran
   * (and may have partially acted) is worse than dropping one.
   */
  async poll(): Promise<number> {
    const state = await this.withLock(() => this.readState());
    if (state === null) {
      return this.firstPoll();
    }

    let issues: T[];
    try {
      issues = await this.listRecentIssues(state.cursor);
    } catch (err) {
      this.log(`[linear-watcher] failed to list recent issues, keeping cursor at ${state.cursor}: ${(err as Error).message}`);
      return 0;
    }

    return this.withLock(async () => {
      // Re-read inside the lock: a concurrent markSeen() may have written while the fetch above
      // was in flight (which ran outside the lock). Merging against that fresh read — rather than
      // the `state` read before the fetch — is what keeps its write from being lost.
      const fresh = (await this.readState()) ?? state;
      const seen = new Set(fresh.seen);
      const nextSeen = [...fresh.seen];
      let cursor = fresh.cursor;
      let notified = 0;

      for (const t of issues) {
        if (t.createdAt > cursor) cursor = t.createdAt;
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        nextSeen.push(t.id);
        try {
          await this.onNew(t);
          notified++;
        } catch (err) {
          this.log(`[linear-watcher] onNew failed for ${t.id}, marking it seen to avoid re-notifying: ${(err as Error).message}`);
        }
      }

      await this.writeState({ cursor, seen: nextSeen });
      return notified;
    });
  }

  /**
   * Handles the very first poll (no state file yet).
   *
   * Without `catchUp`: seeds cursor=`now()`, fetches nothing, notifies nothing — the
   * long-standing "never flood onNew with pre-existing tickets" behaviour.
   *
   * With `catchUp`: fetches `listRecentIssues(now - sinceMs)` once, runs `onNew` for every
   * fetched issue `include()` accepts (oldest first), marks ALL fetched issues seen
   * regardless of `include()`, and sets the cursor to cover both `now()` and the newest
   * `createdAt` fetched — so the very next ordinary poll never re-fetches this window.
   *
   * A fetch failure here writes nothing at all (unlike the steady-state path, there's no
   * cursor yet to "leave untouched"), so the next poll still sees no state file and retries
   * catch-up from scratch rather than silently falling back to "skip everything before now".
   */
  private async firstPoll(): Promise<number> {
    if (!this.catchUp) {
      await this.withLock(() => this.writeState({ cursor: this.now().toISOString(), seen: [] }));
      return 0;
    }

    const catchUp = this.catchUp;
    const now = this.now();
    const since = new Date(now.getTime() - catchUp.sinceMs).toISOString();

    let issues: T[];
    try {
      issues = await this.listRecentIssues(since);
    } catch (err) {
      this.log(`[linear-watcher] catch-up fetch failed, will retry catch-up on next poll: ${(err as Error).message}`);
      return 0;
    }

    return this.withLock(async () => {
      // No state file existed when poll() checked, but a concurrent markSeen() could have
      // created one while the fetch above was in flight (it runs outside the lock) — re-read
      // here, same as the steady-state path, so that write is never lost.
      const fresh = (await this.readState()) ?? { cursor: now.toISOString(), seen: [] };
      const seen = new Set(fresh.seen);
      const nextSeen = [...fresh.seen];
      let cursor = fresh.cursor;
      let notified = 0;

      const sorted = [...issues].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      for (const t of sorted) {
        if (t.createdAt > cursor) cursor = t.createdAt;
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        nextSeen.push(t.id);
        if (!catchUp.include(t)) continue;
        try {
          await this.onNew(t);
          notified++;
        } catch (err) {
          this.log(
            `[linear-watcher] onNew failed for ${t.id} during catch-up, marking it seen to avoid re-notifying: ${(err as Error).message}`,
          );
        }
      }

      await this.writeState({ cursor, seen: nextSeen });
      return notified;
    });
  }

  /** Marks an id as already handled without waiting for it to surface in a poll. */
  async markSeen(id: string): Promise<void> {
    await this.withLock(async () => {
      const state = (await this.readState()) ?? { cursor: this.now().toISOString(), seen: [] };
      if (!state.seen.includes(id)) state.seen.push(id);
      await this.writeState(state);
    });
  }

  /** Starts polling on `intervalMs`. A poll already in flight is never overlapped by the next tick. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.polling) return;
      this.polling = true;
      this.currentPoll = this.poll()
        .then(() => undefined)
        .catch((err) => this.log(`[linear-watcher] poll threw unexpectedly: ${(err as Error).message}`))
        .finally(() => {
          this.polling = false;
        });
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Resolves once any poll that was already in flight (started by a `start()` tick)
   * has settled. Does not itself start or stop anything. Intended for callers/tests
   * that need to know "the watcher is idle right now" without guessing at wall-clock
   * timing — e.g. call `stop()` then `await idle()` to be sure no poll is still
   * running before inspecting state.
   */
  idle(): Promise<void> {
    return this.currentPoll;
  }
}
