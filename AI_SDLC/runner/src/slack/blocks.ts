// Pure Block Kit message builders for the Slack bot. No Slack API calls here —
// every function just returns `{ text, blocks }` JSON that a caller (src/slack/app.ts,
// a later task) posts or updates via the Slack Web API. Keeping this pure makes the
// message content testable without a live Slack connection or any SDK dependency.

import type { StageId } from "../gate.ts";

export interface Msg {
  text: string;
  blocks: unknown[];
}

export const ACTIONS = {
  start: "sdlc_start",
  ignore: "sdlc_ignore",
  approve: "sdlc_approve",
  reject: "sdlc_reject",
  interviewApply: "sdlc_interview_apply",
  interviewProceed: "sdlc_interview_proceed",
} as const;

export const REJECT_MODAL = "sdlc_reject_modal";

export interface ActionValue {
  key: string;
  ticketId: string;
  stage?: StageId;
}

/**
 * Maps a runner stage/gate id (e.g. "01-intent", "04-test-loop", "gate:03-build")
 * onto the fixed 7-column pipeline label the design shows in Slack and Linear.
 * Unknown ids are returned unchanged so a future stage never renders as "undefined".
 */
const COLUMN_LABELS: Record<string, string> = {
  "00": "00 Setup",
  "01": "01 Plan",
  "02": "02 Design",
  "03": "03 Build",
  "04": "04 Test",
  "05": "05 Deploy",
  "06": "06 Maintain",
};

export function stageLabel(stage: string): string {
  const bare = stage.startsWith("gate:") ? stage.slice("gate:".length) : stage;
  const prefix = bare.slice(0, 2);
  const label = COLUMN_LABELS[prefix];
  return label ?? stage;
}

/** Slack section blocks cap `text` at 3000 chars; leave headroom for the truncation marker. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Escapes Slack mrkdwn's three special characters in user-controlled text (ticket
 * titles, creator names, role names, summaries, rejection reasons, ...) so it can
 * never be read as mrkdwn syntax — e.g. `<http://evil|text>` forging a link, or
 * `<`/`>`/`&` garbling the message. `&` must go first or its own escape would be
 * re-escaped. Never apply this to Slack syntax we generate ourselves
 * (`<url|KEY>`, `<@U>`, `<!subteam^S>`) — that would break the real link/mention.
 */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function section(text: string): unknown {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function context(text: string): unknown {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

export function ticketNotice(
  t: { key: string; title: string; url: string; creator?: string; labels: string[]; ticketId: string },
  o: { state: "new" | "started" | "ignored" | "auto"; by?: string; parentKey?: string; depth?: number },
): Msg {
  let text = `🆕 *<${t.url}|${t.key}>* ${escapeMrkdwn(t.title)}`;
  if (t.creator) text += ` — ${escapeMrkdwn(t.creator)}`;
  if (t.labels.includes("sdlc-auto") && o.parentKey) {
    text += ` · ↺ ${o.parentKey}에서 생성`;
    if (o.depth && o.depth > 1) text += ` (${o.depth}회차)`;
  }

  const blocks: unknown[] = [section(text)];
  const by = o.by ? ` (by <@${o.by}>)` : "";

  switch (o.state) {
    case "new":
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: ACTIONS.start,
            text: { type: "plain_text", text: "▶ 파이프라인 시작" },
            value: JSON.stringify({ key: t.key, ticketId: t.ticketId } satisfies ActionValue),
          },
          {
            type: "button",
            action_id: ACTIONS.ignore,
            text: { type: "plain_text", text: "무시" },
            value: JSON.stringify({ key: t.key, ticketId: t.ticketId } satisfies ActionValue),
          },
        ],
      });
      break;
    case "started":
      blocks.push(context(`▶ 시작함${by}`));
      break;
    case "auto":
      blocks.push(context("▶ 자동 시작됨"));
      break;
    case "ignored":
      blocks.push(context(`🚫 무시함${by}`));
      break;
  }

  return { text, blocks };
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
  return `${Math.round(ms / 60_000)}분`;
}

export function stageLine(stage: string, status: "running" | "ok" | "failed", durationMs?: number, note?: string): Msg {
  const label = stageLabel(stage);
  const icon = status === "running" ? "⏳" : status === "ok" ? "✅" : "❌";
  const word = status === "running" ? "실행 중" : status === "ok" ? "완료" : "실패";

  let text = `${icon} ${label} ${word}`;
  if (status !== "running" && durationMs !== undefined) text += ` (${formatDuration(durationMs)})`;
  if (note) text += ` — ${escapeMrkdwn(note)}`;

  return { text, blocks: [section(text)] };
}

export function gateMessage(g: {
  key: string;
  ticketId: string;
  stage: StageId;
  role: string;
  roleGroupId?: string;
  summary: string;
  gateUrl: string;
  state: "waiting" | "approved" | "rejected" | "timeout";
  by?: string;
  reason?: string;
  /** Set when this rejection is about to trigger a rework attempt (spec §4) — appends "→ 재작업 N/M" to the header. */
  rework?: { attempt: number; maxAttempts: number };
}): Msg {
  const label = stageLabel(g.stage);
  let headerText: string;

  switch (g.state) {
    case "waiting": {
      const mention = g.roleGroupId ? `<!subteam^${g.roleGroupId}>` : escapeMrkdwn(g.role);
      headerText = `🔔 ${mention} 승인 필요 — ${label}`;
      break;
    }
    case "approved":
      headerText = g.by === "Linear" ? "✅ Linear에서 승인" : g.by ? `✅ <@${g.by}> 승인` : "✅ 승인";
      break;
    case "rejected": {
      const reason = g.reason && g.reason.length > 0 ? escapeMrkdwn(g.reason) : "(사유 없음)";
      headerText = `⛔ 반려: ${reason}`;
      if (g.rework) headerText += ` → 재작업 ${g.rework.attempt}/${g.rework.maxAttempts}`;
      break;
    }
    case "timeout":
      headerText = `⏰ 승인 대기 시간 초과 — ${label}`;
      break;
  }

  const blocks: unknown[] = [
    section(headerText),
    section(truncate(escapeMrkdwn(g.summary), 2900)),
    context(`<${g.gateUrl}|Linear에서 보기>`),
  ];

  if (g.state === "waiting") {
    const value: ActionValue = { key: g.key, ticketId: g.ticketId, stage: g.stage };
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: ACTIONS.approve,
          style: "primary",
          text: { type: "plain_text", text: "✅ 승인" },
          value: JSON.stringify(value),
        },
        {
          type: "button",
          action_id: ACTIONS.reject,
          style: "danger",
          text: { type: "plain_text", text: "⛔ 반려" },
          value: JSON.stringify(value),
        },
      ],
    });
  }

  return { text: headerText, blocks };
}

/**
 * The 01 Plan interview message (spec §3.4): a numbered list of open questions, the
 * requester mentioned when known (otherwise a note that anyone in the thread can answer),
 * a running count of replies collected, and — only while still `"open"` — the two buttons
 * that resolve the round. `"applied"`/`"proceeded"` render the same message post-resolution,
 * with no buttons, showing who acted.
 */
export function interviewMessage(i: {
  key: string;
  ticketId: string;
  questions: string[];
  round: number;
  maxRounds: number;
  requesterId?: string;
  answerCount: number;
  state: "open" | "applied" | "proceeded";
  by?: string;
}): Msg {
  let headerText: string;
  switch (i.state) {
    case "open": {
      const mention = i.requesterId ? `<@${i.requesterId}> ` : "";
      const note = i.requesterId ? "" : " (스레드에서 누구나 답할 수 있다)";
      headerText = `🙋 ${mention}질문 ${i.questions.length}개 (${i.round}/${i.maxRounds})${note}`;
      break;
    }
    case "applied":
      headerText = i.by ? `✅ 답변 ${i.answerCount}개 반영 (by <@${i.by}>)` : `✅ 답변 ${i.answerCount}개 반영`;
      break;
    case "proceeded":
      headerText = i.by ? `➡️ 이대로 진행 (by <@${i.by}>)` : "➡️ 이대로 진행";
      break;
  }

  const blocks: unknown[] = [section(headerText)];
  if (i.questions.length > 0) {
    const list = i.questions.map((q, idx) => `${idx + 1}. ${escapeMrkdwn(q)}`).join("\n");
    blocks.push(section(list));
  }

  if (i.state === "open") {
    blocks.push(context(`답변 ${i.answerCount}개 받음`));
    const value = JSON.stringify({ key: i.key, ticketId: i.ticketId });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: ACTIONS.interviewApply,
          style: "primary",
          text: { type: "plain_text", text: "답변 반영" },
          value,
        },
        {
          type: "button",
          action_id: ACTIONS.interviewProceed,
          text: { type: "plain_text", text: "이대로 진행" },
          value,
        },
      ],
    });
  }

  return { text: headerText, blocks };
}

export function rejectModal(v: ActionValue): unknown {
  return {
    type: "modal",
    callback_id: REJECT_MODAL,
    private_metadata: JSON.stringify(v),
    title: { type: "plain_text", text: "반려 사유" },
    submit: { type: "plain_text", text: "제출" },
    close: { type: "plain_text", text: "취소" },
    blocks: [
      {
        type: "input",
        block_id: "reason",
        label: { type: "plain_text", text: "반려 사유" },
        element: { type: "plain_text_input", action_id: "reason", multiline: true },
      },
    ],
  };
}

export function followupLine(f: { key: string; url: string }): Msg {
  const text = `↺ 후속 티켓 생성: <${f.url}|${f.key}>`;
  return { text, blocks: [section(text)] };
}

export function runFinishedLine(outcome: "done" | "aborted"): Msg {
  const text = outcome === "done" ? "🏁 파이프라인 완료" : "🛑 파이프라인 중단됨";
  return { text, blocks: [section(text)] };
}
