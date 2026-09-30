// `PipelineEvents` implementation that writes a Slack thread per ticket. No `@slack/bolt`
// import here — only the thin `SlackClientLike` shape the caller injects — so this module is
// testable with a fake client and carries no compile-time dependency on the Bolt SDK.
//
// See docs/superpowers/specs/2026-10-01-sdlc-slack-bot-design.md §3.1, §4.1, §4.3.

import type { PipelineEvents } from "../events.ts";
import type { GateRef, StageId } from "../gate.ts";
import type { RunMeta } from "../state.ts";
import type { RecentIssue } from "../adapters/types.ts";
import { ticketNotice, stageLine, gateMessage, followupLine, runFinishedLine } from "./blocks.ts";
import { readThread, writeThread, type ThreadRecord } from "./threads.ts";

export interface SlackClientLike {
  chat: {
    postMessage(a: object): Promise<{ ts?: string }>;
    update(a: object): Promise<unknown>;
    postEphemeral(a: object): Promise<unknown>;
  };
}

export interface SlackNotifierOptions {
  client: SlackClientLike;
  channel: string;
  stateDir: string;
  roleGroups: Record<string, string>;
}

function simpleMsg(text: string): { text: string; blocks: unknown[] } {
  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
}

function emptyThread(channel: string, threadTs: string, ticketId: string): ThreadRecord {
  return { channel, threadTs, ticketId, stageTs: {}, gateTs: {}, gateResolvedBy: {} };
}

/**
 * Turns pipeline events into a Slack thread per ticket. A run that never got a "new ticket"
 * notice (the existing webhook path, which skips LinearWatcher entirely) still gets a thread:
 * the first event for an unknown key opens one on the spot (see `ensureThread`).
 */
export function createSlackNotifier(
  o: SlackNotifierOptions,
): PipelineEvents &
  Required<Pick<PipelineEvents, "stageReworking" | "interviewAnswered">> & {
    postTicketNotice(t: RecentIssue, state: "new" | "auto"): Promise<void>;
    markStarted(key: string, by: string): Promise<void>;
  } {
  const { client, channel, stateDir, roleGroups } = o;

  async function ensureThread(key: string, fallbackText: string): Promise<ThreadRecord> {
    const existing = await readThread(stateDir, key);
    if (existing) return existing;
    const posted = await client.chat.postMessage({ channel, ...simpleMsg(fallbackText) });
    const rec = emptyThread(channel, posted.ts ?? "", key);
    await writeThread(stateDir, key, rec);
    return rec;
  }

  async function postTicketNotice(t: RecentIssue, state: "new" | "auto"): Promise<void> {
    const msg = ticketNotice({ key: t.key, title: t.title, url: t.url, creator: t.creator, labels: t.labels, ticketId: t.id }, { state });
    const posted = await client.chat.postMessage({ channel, text: msg.text, blocks: msg.blocks });
    await writeThread(stateDir, t.key, emptyThread(channel, posted.ts ?? "", t.id));
  }

  async function markStarted(key: string, by: string): Promise<void> {
    const text = `▶ 시작함 (by <@${by}>)`;
    const rec = await readThread(stateDir, key);
    if (rec) {
      await client.chat.update({ channel: rec.channel, ts: rec.threadTs, ...simpleMsg(text) });
      return;
    }
    const posted = await client.chat.postMessage({ channel, ...simpleMsg(`▶ ${key} ${text}`) });
    await writeThread(stateDir, key, emptyThread(channel, posted.ts ?? "", key));
  }

  return {
    postTicketNotice,
    markStarted,

    async runStarted(meta: RunMeta): Promise<void> {
      await ensureThread(meta.key, `🆕 <${meta.url}|${meta.key}> ${meta.title}`);
    },

    async stageStarted(key: string, stage: string): Promise<void> {
      const rec = await ensureThread(key, `🆕 ${key}`);
      const msg = stageLine(stage, "running");
      const posted = await client.chat.postMessage({ channel: rec.channel, thread_ts: rec.threadTs, text: msg.text, blocks: msg.blocks });
      rec.stageTs[stage] = posted.ts ?? "";
      await writeThread(stateDir, key, rec);
    },

    async stageFinished(key: string, stage: string, ok: boolean, durationMs: number, note?: string): Promise<void> {
      const rec = await readThread(stateDir, key);
      if (!rec) return; // stageStarted always runs first and creates the thread — nothing to update.
      const msg = stageLine(stage, ok ? "ok" : "failed", durationMs, note);
      const ts = rec.stageTs[stage];
      if (ts) {
        await client.chat.update({ channel: rec.channel, ts, text: msg.text, blocks: msg.blocks });
        return;
      }
      // No stageStarted message on record (e.g. runner restarted mid-stage) — post fresh rather than drop it.
      const posted = await client.chat.postMessage({ channel: rec.channel, thread_ts: rec.threadTs, text: msg.text, blocks: msg.blocks });
      rec.stageTs[stage] = posted.ts ?? "";
      await writeThread(stateDir, key, rec);
    },

    async gateWaiting(key: string, stage: StageId, role: string, gate: GateRef, summary: string): Promise<void> {
      const rec = await ensureThread(key, `🆕 ${key}`);
      // A rework round reopens this same stage's gate under the same stage id — clear any stale
      // "who resolved it" marker from a previous round before posting the new wait message, or
      // gateResolved would wrongly read the new round as already handled (see finding: stale
      // gateResolvedBy freezes the Slack gate message after a rework round).
      if (rec.gateResolvedBy[stage]) {
        delete rec.gateResolvedBy[stage];
        await writeThread(stateDir, key, rec);
      }
      const msg = gateMessage({ key, ticketId: rec.ticketId, stage, role, roleGroupId: roleGroups[role], summary, gateUrl: gate.url, state: "waiting" });
      const posted = await client.chat.postMessage({
        channel: rec.channel,
        thread_ts: rec.threadTs,
        reply_broadcast: true,
        text: msg.text,
        blocks: msg.blocks,
      });
      rec.gateTs[stage] = posted.ts ?? "";
      await writeThread(stateDir, key, rec);
    },

    async gateResolved(key: string, stage: StageId, approved: boolean, reason?: string): Promise<void> {
      const rec = await readThread(stateDir, key);
      if (!rec) return;
      // The Slack button path already updated this message (and recorded who) before moving the
      // Linear card — see handleGateAction in app.ts. Only a resolution that happened elsewhere
      // (moved directly in Linear) reaches here with gateResolvedBy unset.
      if (rec.gateResolvedBy[stage]) return;
      const ts = rec.gateTs[stage];
      if (!ts) return; // no gate message was ever posted for this stage — nothing to update.
      const msg = gateMessage({
        key,
        ticketId: rec.ticketId,
        stage,
        role: "",
        summary: "(Linear에서 처리됨)",
        gateUrl: "",
        state: approved ? "approved" : "rejected",
        by: approved ? "Linear" : undefined,
        reason,
      });
      await client.chat.update({ channel: rec.channel, ts, text: msg.text, blocks: msg.blocks });
    },

    async stageReworking(key: string, stage: StageId, attempt: number, maxAttempts: number, reason: string): Promise<void> {
      const rec = await readThread(stateDir, key);
      if (!rec) return;
      const ts = rec.gateTs[stage];
      if (!ts) return; // no gate message on record — nothing to update (e.g. runner restarted mid-gate).
      const msg = gateMessage({
        key,
        ticketId: rec.ticketId,
        stage,
        role: "",
        summary: "(재작업을 준비한다)",
        gateUrl: "",
        state: "rejected",
        reason,
        rework: { attempt, maxAttempts },
      });
      await client.chat.update({ channel: rec.channel, ts, text: msg.text, blocks: msg.blocks });
    },

    async interviewAnswered(key: string, round: number, answerCount: number): Promise<void> {
      const rec = await ensureThread(key, `🆕 ${key}`);
      const text = `📝 01 Plan 인터뷰 답변 ${answerCount}개 반영 (round ${round}) — intent.md를 다시 쓴다`;
      await client.chat.postMessage({ channel: rec.channel, thread_ts: rec.threadTs, ...simpleMsg(text) });
    },

    async followupCreated(key: string, followup: { key: string; url: string }): Promise<void> {
      const rec = await ensureThread(key, `🆕 ${key}`);
      const msg = followupLine(followup);
      await client.chat.postMessage({ channel: rec.channel, thread_ts: rec.threadTs, text: msg.text, blocks: msg.blocks });
    },

    async runFinished(key: string, outcome: "done" | "aborted"): Promise<void> {
      const rec = await ensureThread(key, `🆕 ${key}`);
      const msg = runFinishedLine(outcome);
      await client.chat.postMessage({ channel: rec.channel, thread_ts: rec.threadTs, text: msg.text, blocks: msg.blocks });
    },
  };
}
