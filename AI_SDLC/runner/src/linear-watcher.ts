import { mkdir, readFile, writeFile } from "node:fs/promises";
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

  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(o: LinearWatcherOptions<T>) {
    this.listRecentIssues = o.listRecentIssues;
    this.statePath = o.statePath;
    this.intervalMs = o.intervalMs;
    this.onNew = o.onNew;
    this.now = o.now ?? (() => new Date());
    this.log = o.log ?? console.log;
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

  private async writeState(state: WatchState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const seen = state.seen.length > MAX_SEEN ? state.seen.slice(state.seen.length - MAX_SEEN) : state.seen;
    await writeFile(this.statePath, JSON.stringify({ cursor: state.cursor, seen }, null, 2), "utf8");
  }

  /**
   * Runs one poll cycle and returns the number of tickets successfully handed
   * to `onNew`.
   *
   * No state file yet → this is the first run: the cursor is seeded to
   * `now()` and nothing is fetched or notified, so a fresh watcher never
   * floods `onNew` with every pre-existing ticket.
   *
   * A fetch failure leaves the cursor untouched so the missed window is
   * retried on the next poll. An `onNew` failure is logged but the ticket is
   * still marked seen — re-delivering a ticket whose handler already ran
   * (and may have partially acted) is worse than dropping one.
   */
  async poll(): Promise<number> {
    const state = await this.readState();
    if (state === null) {
      await this.writeState({ cursor: this.now().toISOString(), seen: [] });
      return 0;
    }

    let issues: T[];
    try {
      issues = await this.listRecentIssues(state.cursor);
    } catch (err) {
      this.log(`[linear-watcher] failed to list recent issues, keeping cursor at ${state.cursor}: ${(err as Error).message}`);
      return 0;
    }

    const seen = new Set(state.seen);
    const nextSeen = [...state.seen];
    let cursor = state.cursor;
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
  }

  /** Marks an id as already handled without waiting for it to surface in a poll. */
  async markSeen(id: string): Promise<void> {
    const state = (await this.readState()) ?? { cursor: this.now().toISOString(), seen: [] };
    if (!state.seen.includes(id)) state.seen.push(id);
    await this.writeState(state);
  }

  /** Starts polling on `intervalMs`. A poll already in flight is never overlapped by the next tick. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.polling) return;
      this.polling = true;
      this.poll()
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
}
