// Ticket key -> Slack thread mapping, persisted to .state/<key>.slack.json so the
// bot can find the right thread (and per-stage/gate message timestamps to edit)
// across runner restarts. Plain fs I/O, no Slack API calls.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StageId } from "../gate.ts";
import { writeJsonAtomic } from "../fs-atomic.ts";

export interface ThreadRecord {
  channel: string;
  threadTs: string;
  ticketId: string;
  /** Stage id -> ts of that stage's message, so progress lines can be edited in place. */
  stageTs: Record<string, string>;
  gateTs: Partial<Record<StageId, string>>;
  gateResolvedBy: Partial<Record<StageId, string>>;
}

export function threadPath(stateDir: string, key: string): string {
  return join(stateDir, `${key}.slack.json`);
}

/** Missing file or corrupted JSON both come back as null — never throws. */
export async function readThread(stateDir: string, key: string): Promise<ThreadRecord | null> {
  try {
    const raw = await readFile(threadPath(stateDir, key), "utf8");
    return JSON.parse(raw) as ThreadRecord;
  } catch {
    return null;
  }
}

export async function writeThread(stateDir: string, key: string, rec: ThreadRecord): Promise<void> {
  await writeJsonAtomic(threadPath(stateDir, key), rec);
}
