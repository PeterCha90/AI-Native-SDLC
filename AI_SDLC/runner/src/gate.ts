import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { StateType, TicketSource } from "./adapters/types.ts";

/**
 * Human-in-the-loop approval gates.
 *
 * One pipeline stage = one Linear sub-issue = one gate. The 00-setup stage creates
 * those sub-issues through the Linear MCP connector and records the mapping; this
 * module is the deterministic half that blocks the runner until a human moves the
 * sub-issue. No model is involved in reading an approval — a gate verdict must never
 * be a judgement call.
 */

export const STAGES = ["01-plan", "02-design", "03-build", "04-test", "05-deploy", "06-maintain"] as const;
export type StageId = (typeof STAGES)[number];

export interface GateRef {
  /** Linear issue UUID — what getStateType/listComments take. */
  issueId: string;
  /** Human-facing identifier, e.g. "ENG-43". */
  key: string;
  url: string;
}

export type GateMap = Record<StageId, GateRef>;

export type GateVerdict = "approved" | "rejected" | "pending";

/**
 * The whole approval protocol, in one pure function: a human moving the gate
 * sub-issue to a Done-type state approves the stage, moving it to a Canceled-type
 * state rejects it, and everything else means they haven't decided yet.
 *
 * Using Linear's own workflow states rather than a magic comment string means the
 * approver needs no instructions beyond "move the card".
 */
export function classifyState(stateType: StateType): GateVerdict {
  if (stateType === "completed") return "approved";
  if (stateType === "canceled") return "rejected";
  return "pending";
}

export function gateMapPath(runnerDir: string, ticketKey: string): string {
  return join(runnerDir, ".state", `${ticketKey}.gates.json`);
}

/** Type guard for the on-disk shape, so a truncated or hand-edited file fails here and not mid-pipeline. */
export function parseGateMap(raw: string): GateMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`gate map is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("gate map must be a JSON object keyed by stage id");
  }
  const record = parsed as Record<string, unknown>;
  const map = {} as GateMap;
  for (const stage of STAGES) {
    const entry = record[stage];
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`gate map is missing an entry for stage "${stage}"`);
    }
    const { issueId, key, url } = entry as Record<string, unknown>;
    if (typeof issueId !== "string" || !issueId) throw new Error(`gate map entry "${stage}" has no issueId`);
    map[stage] = {
      issueId,
      key: typeof key === "string" ? key : issueId,
      url: typeof url === "string" ? url : "",
    };
  }
  return map;
}

/**
 * Loads the stage→sub-issue mapping written by 00-setup.
 *
 * Throws if it's absent or malformed. That is deliberate: a missing gate map means
 * nobody is being asked to approve anything, and a pipeline that silently runs all
 * six stages unattended is exactly the failure this feature exists to prevent.
 */
export async function readGateMap(runnerDir: string, ticketKey: string): Promise<GateMap> {
  const path = gateMapPath(runnerDir, ticketKey);
  if (!existsSync(path)) {
    throw new Error(
      `no approval-gate map at ${path} — the 00-setup stage did not create the Linear sub-issues. ` +
        `Refusing to run the pipeline ungated. Check the Linear MCP connection, or set SDLC_AUTO_APPROVE=1 to rehearse without gates.`,
    );
  }
  return parseGateMap(await readFile(path, "utf8"));
}

export interface AwaitApprovalOptions {
  source: TicketSource;
  gate: GateRef;
  /** Stage id, used only in log lines. */
  stage: StageId;
  /** Role expected to approve, e.g. "Product Owner". Shown to the operator while waiting. */
  role: string;
  /** Posted as a comment on the gate sub-issue so the approver sees what to review. */
  summary: string;
  pollIntervalMs: number;
  timeoutMs: number;
  /** Rehearsal escape hatch. Always logged when taken. */
  autoApprove: boolean;
  /** Injected so tests don't sleep. */
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export interface ApprovalResult {
  approved: boolean;
  /** Set when rejected or timed out. */
  reason?: string;
  autoApproved: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Posts the stage summary onto the gate sub-issue, then blocks until a human moves it.
 * Never throws on a transport hiccup — a failed poll is retried, because a flaky network
 * must not read as "rejected".
 */
export async function awaitApproval(opts: AwaitApprovalOptions): Promise<ApprovalResult> {
  const log = opts.log ?? console.log;
  const sleep = opts.sleep ?? defaultSleep;

  if (opts.autoApprove) {
    log(`[gate:${opts.stage}] SDLC_AUTO_APPROVE=1 — 게이트를 자동 승인했다 (리허설 모드). 승인자 ${opts.role} 는 개입하지 않았다.`);
    return { approved: true, autoApproved: true };
  }

  try {
    await opts.source.comment(opts.gate.issueId, opts.summary);
  } catch (err) {
    log(`[gate:${opts.stage}] 요약 코멘트를 남기지 못했다 (계속 대기한다): ${(err as Error).message}`);
  }

  log(`[gate:${opts.stage}] ${opts.role} 승인 대기 — ${opts.gate.key} ${opts.gate.url}`);
  log(`[gate:${opts.stage}] 승인: 카드를 Done 으로 / 반려: 카드를 Canceled 로 (사유는 코멘트에)`);

  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    let verdict: GateVerdict = "pending";
    try {
      verdict = classifyState(await opts.source.getStateType(opts.gate.issueId));
    } catch (err) {
      log(`[gate:${opts.stage}] 상태 조회 실패, 재시도한다: ${(err as Error).message}`);
    }

    if (verdict === "approved") {
      log(`[gate:${opts.stage}] 승인됨 (${opts.gate.key})`);
      return { approved: true, autoApproved: false };
    }
    if (verdict === "rejected") {
      const reason = await latestCommentBody(opts.source, opts.gate.issueId);
      log(`[gate:${opts.stage}] 반려됨 (${opts.gate.key}): ${reason ?? "사유 코멘트 없음"}`);
      return { approved: false, reason: reason ?? "사유 코멘트 없음", autoApproved: false };
    }

    await sleep(opts.pollIntervalMs);
  }

  const reason = `승인 대기 시간(${Math.round(opts.timeoutMs / 1000)}s)을 초과했습니다. ${opts.gate.key} 를 사람이 처리해야 합니다.`;
  log(`[gate:${opts.stage}] ${reason}`);
  return { approved: false, reason, autoApproved: false };
}

async function latestCommentBody(source: TicketSource, issueId: string): Promise<string | null> {
  try {
    const comments = await source.listComments(issueId);
    return comments.length ? comments[comments.length - 1].body : null;
  } catch {
    return null;
  }
}
