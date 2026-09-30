import type { GateRef, StageId } from "./gate.ts";
import type { RunMeta } from "./state.ts";

/**
 * The pipeline's observation points, as pure notifications. `pipeline.ts` calls these at
 * the moments it already writes `.state/*` — it never needs to know who's listening (Slack,
 * or nothing at all). See docs/superpowers/specs/2026-10-01-sdlc-slack-bot-design.md §3.1.
 */
export interface PipelineEvents {
  runStarted(meta: RunMeta): Promise<void>;
  stageStarted(key: string, stage: string): Promise<void>;
  stageFinished(key: string, stage: string, ok: boolean, durationMs: number, note?: string): Promise<void>;
  gateWaiting(key: string, stage: StageId, role: string, gate: GateRef, summary: string): Promise<void>;
  gateResolved(key: string, stage: StageId, approved: boolean, reason?: string): Promise<void>;
  followupCreated(key: string, followup: { key: string; url: string }): Promise<void>;
  runFinished(key: string, outcome: "done" | "aborted"): Promise<void>;
}

export const noopEvents: PipelineEvents = {
  async runStarted() {},
  async stageStarted() {},
  async stageFinished() {},
  async gateWaiting() {},
  async gateResolved() {},
  async followupCreated() {},
  async runFinished() {},
};

function safeCall<Args extends unknown[]>(
  label: string,
  fn: (...args: Args) => Promise<void>,
  log: (m: string) => void,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await fn(...args);
    } catch (err) {
      log(`[events] ${label} failed: ${(err as Error).message}`);
    }
  };
}

/**
 * Wraps every call to `inner` in try/catch, logging instead of throwing. `pipeline.ts` always
 * calls events through this wrapper: a dead Slack connection (or any other notifier failure)
 * must never stop the pipeline — Linear cards stay the source of truth for approvals either way.
 */
export function safeEvents(inner: PipelineEvents, log: (m: string) => void = console.error): PipelineEvents {
  return {
    runStarted: safeCall("runStarted", inner.runStarted.bind(inner), log),
    stageStarted: safeCall("stageStarted", inner.stageStarted.bind(inner), log),
    stageFinished: safeCall("stageFinished", inner.stageFinished.bind(inner), log),
    gateWaiting: safeCall("gateWaiting", inner.gateWaiting.bind(inner), log),
    gateResolved: safeCall("gateResolved", inner.gateResolved.bind(inner), log),
    followupCreated: safeCall("followupCreated", inner.followupCreated.bind(inner), log),
    runFinished: safeCall("runFinished", inner.runFinished.bind(inner), log),
  };
}
