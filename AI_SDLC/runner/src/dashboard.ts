import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { StageId } from "./gate.ts";

/**
 * Pure aggregation for the pipeline dashboard. Everything here only reads `.state/*` files —
 * it never touches Linear, git, or the network — so it can be unit-tested against fixture
 * files in a temp dir and reused by both the main server (`index.ts`) and the standalone
 * `dashboard-server.ts` used for demos.
 */

export const COLUMN_IDS = ["00", "01", "02", "03", "04", "05", "06"] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];

export const COLUMN_LABELS: Record<ColumnId, string> = {
  "00": "00 Setup",
  "01": "01 Plan",
  "02": "02 Design",
  "03": "03 Build",
  "04": "04 Test",
  "05": "05 Deploy",
  "06": "06 Maintain",
};

/** The stage id a gate:<stageId> log entry belongs to, mapped onto a dashboard column. */
const GATE_STAGE_TO_COLUMN: Record<StageId, ColumnId> = {
  "01-plan": "01",
  "02-design": "02",
  "03-build": "03",
  "04-test": "04",
  "05-deploy": "05",
  "06-maintain": "06",
};

/** The reverse mapping: which gate (if any) a column ends in. Column "00" has no gate. */
const COLUMN_TO_GATE_STAGE: Record<ColumnId, StageId | null> = {
  "00": null,
  "01": "01-plan",
  "02": "02-design",
  "03": "03-build",
  "04": "04-test",
  "05": "05-deploy",
  "06": "06-maintain",
};

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
  /** config.gateRoles at the time the run started, so the page never needs the runner's config file. */
  gateRoles: Record<StageId, string>;
}

export interface GateRefLite {
  key: string;
  url: string;
}

export type GateMapLite = Record<StageId, GateRefLite>;

/** Maps a stage-log stage name (or "gate:<stageId>") onto the dashboard column it belongs in. */
export function stageColumn(stage: string): ColumnId | null {
  if (stage.startsWith("gate:")) {
    const inner = stage.slice("gate:".length) as StageId;
    return GATE_STAGE_TO_COLUMN[inner] ?? null;
  }
  const match = stage.match(/^(\d{2})-/);
  if (!match) return null;
  return (COLUMN_IDS as readonly string[]).includes(match[1]) ? (match[1] as ColumnId) : null;
}

export type StepStatus = "대기" | "실행 중" | "완료" | "실패";

export interface StepView {
  stage: string;
  status: StepStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  sessionJsonlPath: string | null;
  note?: string;
}

export type GateVerdictView = "승인 대기" | "승인" | "반려" | "자동 승인";

export interface GateView {
  role: string;
  verdict: GateVerdictView;
  url: string | null;
  note?: string;
}

export interface ColumnView {
  id: ColumnId;
  label: string;
  steps: StepView[];
  gate: GateView | null;
  /** True when this is the column the run is currently active in, per live.json. */
  active: boolean;
}

export interface FollowupView {
  key: string;
  url: string;
  depth: number;
}

export interface RunView {
  key: string;
  title: string;
  url: string;
  labels: string[];
  depth: number;
  parentUrl: string | null;
  autoApprove: boolean;
  startedAt: string;
  live: LiveStatus | null;
  followup: FollowupView | null;
  columns: ColumnView[];
}

/** Pulls a `KEY-123` style ticket key out of a 06-maintain note, when the runner's fallback path created one. */
function extractFollowupFromNote(note: string | undefined): { key: string; url: string } | null {
  if (!note) return null;
  const match = note.match(/후속\s*티켓\s*([A-Za-z][A-Za-z0-9]*-\d+)(?:\s*\(([^)]+)\))?/);
  if (!match) return null;
  return { key: match[1], url: match[2] ?? "" };
}

async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    // Missing or corrupt — the caller treats this the same as "not there yet".
    return null;
  }
}

/** Builds one dashboard-ready run from its raw `.state/<key>.*` files. Never throws. */
export function buildRun(
  key: string,
  meta: RunMeta,
  stageLog: StageLogEntry[],
  gateMap: GateMapLite | null,
  live: LiveStatus | null,
): RunView {
  const activeColumn = live ? stageColumn(live.stage) : null;

  // Latest entry per exact stage name wins (a stage can legitimately log more than once,
  // e.g. 03-plan then 03-build both land in column "03").
  const byStage = new Map<string, StageLogEntry>();
  for (const entry of stageLog) byStage.set(entry.stage, entry);

  let followup: FollowupView | null = null;
  for (const entry of stageLog) {
    if (!entry.stage.startsWith("06-maintain")) continue;
    const found = extractFollowupFromNote(entry.note);
    if (found) {
      const depthMatch = entry.note?.match(/depth\s*(\d+)/i);
      followup = { key: found.key, url: found.url, depth: depthMatch ? Number(depthMatch[1]) : meta.depth + 1 };
    }
  }

  const columns: ColumnView[] = COLUMN_IDS.map((id) => {
    const steps: StepView[] = [];
    for (const entry of byStage.values()) {
      if (entry.stage.startsWith("gate:")) continue;
      if (stageColumn(entry.stage) !== id) continue;
      const startedAt = new Date(entry.startedAt).getTime();
      const endedAt = new Date(entry.endedAt).getTime();
      steps.push({
        stage: entry.stage,
        status: entry.ok ? "완료" : "실패",
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        durationMs: Number.isFinite(startedAt) && Number.isFinite(endedAt) ? Math.max(0, endedAt - startedAt) : 0,
        sessionJsonlPath: entry.sessionJsonlPath,
        note: entry.note,
      });
    }
    steps.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    // Overlay the currently running step (if any) — runAndLog only appends to the log once a
    // stage finishes, so mid-flight the only evidence is live.json.
    if (activeColumn === id && live?.phase === "running" && !live.stage.startsWith("gate:")) {
      const already = steps.find((s) => s.stage === live.stage);
      if (!already) {
        steps.push({
          stage: live.stage,
          status: "실행 중",
          startedAt: live.since,
          endedAt: "",
          durationMs: 0,
          sessionJsonlPath: null,
        });
      }
    }

    const stageId = COLUMN_TO_GATE_STAGE[id];
    const role = stageId ? meta.gateRoles[stageId] : null;
    const gateLogEntry = stageId ? stageLog.find((e) => e.stage === `gate:${stageId}`) : undefined;
    const gateRef = stageId && gateMap ? gateMap[stageId] ?? null : null;

    let gate: GateView | null = null;
    if (role) {
      const hasRunInColumn = steps.length > 0;
      if (gateLogEntry) {
        gate = {
          role,
          verdict: gateLogEntry.ok ? "승인" : "반려",
          url: gateRef?.url ?? null,
          note: gateLogEntry.note,
        };
      } else if (meta.autoApprove && hasRunInColumn) {
        gate = { role, verdict: "자동 승인", url: gateRef?.url ?? null };
      } else if (activeColumn === id && live?.phase === "waiting" && live.stage === `gate:${stageId}`) {
        gate = { role, verdict: "승인 대기", url: live.gateUrl ?? gateRef?.url ?? null };
      } else if (hasRunInColumn && !meta.autoApprove) {
        // The stage finished but no verdict yet and we're not the active waiting column
        // (e.g. server restarted mid-wait) — still worth flagging as pending.
        gate = { role, verdict: "승인 대기", url: gateRef?.url ?? null };
      }
    }

    return { id, label: COLUMN_LABELS[id], steps, gate, active: activeColumn === id };
  });

  return {
    key,
    title: meta.title,
    url: meta.url,
    labels: meta.labels,
    depth: meta.depth,
    parentUrl: meta.parentUrl ?? null,
    autoApprove: meta.autoApprove,
    startedAt: meta.startedAt,
    live,
    followup,
    columns,
  };
}

/**
 * Reads every `.state/<key>.meta.json` and assembles the matching run, tolerating missing or
 * corrupt companion files (stage log, gate map, live status) — a run in progress may not have
 * all of them yet, and a hand-edited or half-written file must never take the whole dashboard down.
 */
export async function loadRuns(stateDir: string): Promise<RunView[]> {
  let files: string[];
  try {
    files = await readdir(stateDir);
  } catch {
    return [];
  }

  const keys = files.filter((f) => f.endsWith(".meta.json")).map((f) => f.slice(0, -".meta.json".length));

  const runs: RunView[] = [];
  for (const key of keys) {
    const meta = await readJsonSafe<RunMeta>(join(stateDir, `${key}.meta.json`));
    if (!meta) continue; // meta.json existed in the listing but failed to parse by the time we read it — skip, don't crash.
    const stageLog = (await readJsonSafe<StageLogEntry[]>(join(stateDir, `${key}.json`))) ?? [];
    const gateMap = await readJsonSafe<GateMapLite>(join(stateDir, `${key}.gates.json`));
    const live = await readJsonSafe<LiveStatus>(join(stateDir, `${key}.live.json`));
    try {
      runs.push(buildRun(key, meta, stageLog, gateMap, live));
    } catch (err) {
      console.error(`[dashboard] failed to build run "${key}", skipping:`, err);
    }
  }

  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return runs;
}
