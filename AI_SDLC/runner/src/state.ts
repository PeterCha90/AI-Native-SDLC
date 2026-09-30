import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { StageId } from "./gate.ts";

/**
 * The on-disk `.state/<key>.*` shapes every pipeline run writes, plus the one query
 * `/sdlc status` (a later task) needs: which runs are currently active.
 *
 * This module only reads/describes `.state/*` files — it never touches Linear, git, or
 * the network — so it stays trivially unit-testable and has no dependency on how a run's
 * progress gets surfaced (Slack, CLI, …).
 */

export interface StageLogEntry {
  stage: string;
  startedAt: string;
  endedAt: string;
  ok: boolean;
  sessionJsonlPath: string | null;
  note?: string;
}

export interface LiveStatus {
  /** Raw stage id as written by runAndLog (e.g. "03-build") or "gate:<stageId>" while awaiting approval. */
  stage: string;
  phase: "running" | "waiting" | "done" | "aborted";
  role?: string;
  gateUrl?: string;
  since: string;
}

export interface RunMeta {
  key: string;
  title: string;
  url: string;
  labels: string[];
  depth: number;
  parentUrl?: string;
  autoApprove: boolean;
  startedAt: string;
  /** config.gateRoles at the time the run started. */
  gateRoles: Record<StageId, string>;
}

async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    // Missing or corrupt — the caller treats this the same as "not there yet".
    return null;
  }
}

/**
 * Every run currently `running` a stage or `waiting` on a gate, newest activity first.
 * Tolerates a missing state dir, a missing companion file, or a corrupt one — a single
 * broken run must never hide the rest of the list.
 */
export async function listActiveRuns(stateDir: string): Promise<Array<{ meta: RunMeta; live: LiveStatus }>> {
  let files: string[];
  try {
    files = await readdir(stateDir);
  } catch {
    return [];
  }

  const keys = files.filter((f) => f.endsWith(".meta.json")).map((f) => f.slice(0, -".meta.json".length));

  const active: Array<{ meta: RunMeta; live: LiveStatus }> = [];
  for (const key of keys) {
    const meta = await readJsonSafe<RunMeta>(join(stateDir, `${key}.meta.json`));
    if (!meta) continue;
    const live = await readJsonSafe<LiveStatus>(join(stateDir, `${key}.live.json`));
    if (!live) continue;
    if (live.phase !== "running" && live.phase !== "waiting") continue;
    active.push({ meta, live });
  }

  active.sort((a, b) => b.live.since.localeCompare(a.live.since));
  return active;
}
