// Slack side of the 01 Plan interview loop (spec §3.3-§3.4): posts the intent's open
// questions in the ticket's thread, collects thread replies via Socket Mode message
// events (routed in from src/slack/app.ts), and resolves the pending `ask()` when a
// thread participant presses [답변 반영]/[이대로 진행] or `timeoutMs` elapses.
//
// No `@slack/bolt` import here — only the thin `SlackClientLike` shape (extended with
// `users.lookupByEmail`) the caller injects — so this module is testable with a fake
// client, same as notifier.ts.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { InterviewChannel, InterviewOutcome } from "../interview.ts";
import type { SlackClientLike } from "./notifier.ts";
import { readThread } from "./threads.ts";
import { interviewMessage } from "./blocks.ts";

export interface InterviewState {
  round: number;
  questions: string[];
  messageTs: string;
  threadTs: string;
  answers: Array<{ user: string; text: string; ts: string }>;
}

export interface SlackInterviewClient extends SlackClientLike {
  users: {
    lookupByEmail(a: { email: string }): Promise<{ user?: { id?: string } }>;
  };
}

export interface CreateSlackInterviewChannelOptions {
  client: SlackInterviewClient;
  channel: string;
  stateDir: string;
  /** The ticket's creator email, remembered by the caller (index.ts) at enqueue time. */
  getRequesterEmail: (key: string) => string | undefined;
  /** How long `ask()` waits for a button press before resolving `{ kind: "timeout" }`. */
  timeoutMs: number;
}

export type SlackInterviewChannel = InterviewChannel & {
  onThreadMessage(m: { threadTs?: string; user?: string; botId?: string; subtype?: string; text: string; ts: string }): Promise<void>;
  onButton(key: string, action: "apply" | "proceed", userId: string): Promise<{ ok: boolean; message?: string }>;
};

function interviewStatePath(stateDir: string, key: string): string {
  return join(stateDir, `${key}.interview.json`);
}

async function readInterviewState(stateDir: string, key: string): Promise<InterviewState | null> {
  try {
    const raw = await readFile(interviewStatePath(stateDir, key), "utf8");
    return JSON.parse(raw) as InterviewState;
  } catch {
    return null;
  }
}

async function writeInterviewState(stateDir: string, key: string, state: InterviewState): Promise<void> {
  const path = interviewStatePath(stateDir, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}

/** Everything needed to re-render `interviewMessage` for an ask that's still open, kept in memory only. */
interface ActiveAsk {
  resolve: (o: InterviewOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  channel: string;
  threadTs: string;
  ticketId: string;
  questions: string[];
  round: number;
  maxRounds: number;
  requesterId?: string;
}

export function createSlackInterviewChannel(o: CreateSlackInterviewChannelOptions): SlackInterviewChannel {
  const { client, channel, stateDir, getRequesterEmail, timeoutMs } = o;

  // At most one open interview per ticket key; `runPipeline`'s single-queue execution means in
  // practice at most one is ever open across the whole runner, but keying by `key` costs nothing
  // and avoids relying on that.
  const active = new Map<string, ActiveAsk>();
  // Reverse index so `onThreadMessage` (which only knows a Slack thread_ts, not a ticket key) can
  // find the open interview a reply belongs to.
  const threadIndex = new Map<string, string>();

  function settle(key: string, outcome: InterviewOutcome): void {
    const a = active.get(key);
    if (!a) return;
    clearTimeout(a.timer);
    active.delete(key);
    threadIndex.delete(a.threadTs);
    a.resolve(outcome);
  }

  async function resolveRequesterId(key: string): Promise<string | undefined> {
    const email = getRequesterEmail(key);
    if (!email) return undefined;
    try {
      const res = await client.users.lookupByEmail({ email });
      return res.user?.id;
    } catch (err) {
      const code = (err as { data?: { error?: string } }).data?.error;
      if (code === "missing_scope") {
        console.warn(
          `[slack:interview] users:read.email 스코프가 없어 요청자를 찾지 못했다 — 매니페스트를 다시 붙여넣고 앱을 재설치해야 한다.`,
        );
      }
      return undefined;
    }
  }

  async function ask(key: string, questions: string[], round: number, maxRounds: number): Promise<InterviewOutcome> {
    const rec = await readThread(stateDir, key);
    const postChannel = rec?.channel ?? channel;
    const threadTsOpt = rec?.threadTs;
    const ticketId = rec?.ticketId ?? key;

    const requesterId = await resolveRequesterId(key);

    const msg = interviewMessage({ key, ticketId, questions, round, maxRounds, requesterId, answerCount: 0, state: "open" });
    const posted = await client.chat.postMessage({
      channel: postChannel,
      ...(threadTsOpt ? { thread_ts: threadTsOpt } : {}),
      text: msg.text,
      blocks: msg.blocks,
    });
    const messageTs = posted.ts ?? "";
    const threadTs = threadTsOpt ?? messageTs;

    const state: InterviewState = { round, questions, messageTs, threadTs, answers: [] };
    await writeInterviewState(stateDir, key, state);

    return new Promise<InterviewOutcome>((resolve) => {
      const timer = setTimeout(() => settle(key, { kind: "timeout" }), timeoutMs);
      active.set(key, { resolve, timer, channel: postChannel, threadTs, ticketId, questions, round, maxRounds, requesterId });
      threadIndex.set(threadTs, key);
    });
  }

  async function onThreadMessage(m: {
    threadTs?: string;
    user?: string;
    botId?: string;
    subtype?: string;
    text: string;
    ts: string;
  }): Promise<void> {
    if (!m.threadTs) return;
    if (m.botId) return;
    if (m.subtype) return;
    const key = threadIndex.get(m.threadTs);
    if (!key) return;
    const a = active.get(key);
    if (!a) return;

    const state = (await readInterviewState(stateDir, key)) ?? {
      round: a.round,
      questions: a.questions,
      messageTs: a.threadTs,
      threadTs: a.threadTs,
      answers: [],
    };
    state.answers.push({ user: m.user ?? "", text: m.text, ts: m.ts });
    await writeInterviewState(stateDir, key, state);

    const msg = interviewMessage({
      key,
      ticketId: a.ticketId,
      questions: a.questions,
      round: a.round,
      maxRounds: a.maxRounds,
      requesterId: a.requesterId,
      answerCount: state.answers.length,
      state: "open",
    });
    await client.chat.update({ channel: a.channel, ts: state.messageTs, text: msg.text, blocks: msg.blocks });
  }

  async function onButton(key: string, action: "apply" | "proceed", userId: string): Promise<{ ok: boolean; message?: string }> {
    const a = active.get(key);
    if (!a) {
      return { ok: false, message: `러너 재시작으로 이 실행은 중단됐다. /sdlc run ${key} 로 다시 시작한다.` };
    }

    const state = await readInterviewState(stateDir, key);
    const answers = state?.answers ?? [];

    let outcome: InterviewOutcome;
    let renderState: "applied" | "proceeded";
    if (action === "apply" && answers.length > 0) {
      outcome = { kind: "answers", answers: answers.map((ans) => ({ user: ans.user, text: ans.text })) };
      renderState = "applied";
    } else {
      outcome = { kind: "proceed" };
      renderState = "proceeded";
    }

    const msg = interviewMessage({
      key,
      ticketId: a.ticketId,
      questions: a.questions,
      round: a.round,
      maxRounds: a.maxRounds,
      requesterId: a.requesterId,
      answerCount: answers.length,
      state: renderState,
      by: userId,
    });
    await client.chat.update({ channel: a.channel, ts: state?.messageTs ?? a.threadTs, text: msg.text, blocks: msg.blocks });

    settle(key, outcome);
    return { ok: true };
  }

  return { ask, onThreadMessage, onButton };
}
