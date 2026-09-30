// Bolt (Socket Mode) wiring for the Slack bot. This is the ONLY file allowed to import
// `@slack/bolt` (see Task 6 brief) — everything else (notifier, `handleGateAction`,
// `parseSdlcCommand`) is plain, Bolt-free logic that's unit-testable with fakes.
//
// `startSlackApp` itself is intentionally thin and NOT exercised by tests (Socket Mode must
// never start under `npm test`); the business logic it wires together lives in the exported
// pure functions below, which test/slack-actions.test.ts covers directly.

import { App } from "@slack/bolt";
import type { Config } from "../config.ts";
import type { Ticket, TicketSource } from "../adapters/types.ts";
import { readGateMap, classifyState, STAGES, type StageId } from "../gate.ts";
import { listActiveRuns } from "../state.ts";
import { RoleChecker } from "./roles.ts";
import { readThread, writeThread } from "./threads.ts";
import { ACTIONS, REJECT_MODAL, ticketNotice, gateMessage, rejectModal, type ActionValue } from "./blocks.ts";
import { createSlackNotifier, type SlackClientLike } from "./notifier.ts";

// ── isSlackStartupRejection ──────────────────────────────────────────────────

/**
 * Identifies whether an unhandled rejection originated from Slack/Bolt/socket-mode, as opposed
 * to an unrelated bug elsewhere in the runner (a pipeline stage, the webhook handler, etc.).
 *
 * This exists because a bad SLACK_BOT_TOKEN/SLACK_APP_TOKEN can reject a promise deep inside
 * `@slack/bolt`'s Socket Mode client (its `apps.connections.open` call, in
 * `@slack/socket-mode`'s `retrieveWSSURL`) in a way that never reaches the `try/catch` around
 * `app.start()` in `startSlackApp` below — traced as far as: `invalid_auth` (and the other
 * `UnrecoverableSocketModeStartError` codes) short-circuits socket-mode's own retry loop and
 * throws, but the resulting rejection still surfaces as a process-level unhandled rejection
 * rather than through our `await`. index.ts registers a narrow `unhandledRejection` handler
 * (only when `config.slack` is set) that uses this predicate to swallow exactly that class of
 * failure and nothing else — a real bug anywhere else in the runner must still crash loudly.
 *
 * Kept pure and exported (no Slack SDK import) so the matching logic is unit-testable without
 * a live Slack connection.
 */
export function isSlackStartupRejection(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;

  const constructorName = reason.constructor?.name ?? "";
  // @slack/web-api's own error classes: WebAPIPlatformError, WebAPIRequestError,
  // WebAPIHTTPError, WebAPIRateLimitedError.
  if (constructorName.startsWith("WebAPI")) return true;

  const data = (reason as { data?: { error?: string } }).data;
  const UNRECOVERABLE_SOCKET_MODE_ERRORS = ["not_authed", "invalid_auth", "account_inactive", "user_removed_from_team", "team_disabled"];
  if (data?.error && UNRECOVERABLE_SOCKET_MODE_ERRORS.includes(data.error)) return true;

  // Fallback: the error's own stack trace runs through an `@slack/*` package.
  if (/node_modules\/@slack\//.test(reason.stack ?? "")) return true;

  return false;
}

// ── handleGateAction ─────────────────────────────────────────────────────────

export interface GateActionDeps {
  source: TicketSource;
  roles: RoleChecker;
  stateDir: string;
  runnerDir: string;
  isRunActive: (key: string) => boolean;
  gateRoles: Record<StageId, string>;
}

export type GateActionResult = { ok: true; note?: string } | { ok: false; message: string };

// Guards against two near-simultaneous button presses (or a button press racing a modal
// submission) on the same gate both passing the "still pending" check and both commenting +
// moving the Linear card. Keyed by "<key>:<stage>", held for the whole function body (acquired
// synchronously before the first `await`, so two calls fired back-to-back in the same tick can
// never both see it unheld), released in `finally`. In-memory only — fine, since this is
// process-local contention between two Slack clicks arriving within the same runner process,
// not a durability concern (the Linear card state is still the source of truth).
const inFlightGates = new Set<string>();

/**
 * The business logic behind the Slack ✅/⛔ buttons, with no Slack SDK dependency so it's
 * directly unit-testable. Order matters and is load-bearing (see the Task 6 brief):
 *
 * 0. in-flight lock for this (key, stage) — see `inFlightGates` above
 * 1. role check (no Linear call at all if the clicker isn't allowed to act)
 * 2. read the gate map
 * 3. confirm the gate is still pending (an already-resolved gate is a no-op, not an error)
 * 4. record who resolved it in the thread record BEFORE moving the Linear card — this is what
 *    lets `notifier.gateResolved` tell "the Slack button already handled this" apart from
 *    "someone moved the card directly in Linear", without a race window.
 * 5. comment (the rejection reason, or "Slack에서 <@user> 승인"), THEN move the card
 * 6. warn if the runner that would resume this run isn't actually alive
 */
export async function handleGateAction(
  a: { userId: string; key: string; stage: StageId; approved: boolean; reason?: string },
  d: GateActionDeps,
): Promise<GateActionResult> {
  const lockKey = `${a.key}:${a.stage}`;
  if (inFlightGates.has(lockKey)) {
    return { ok: false, message: "이미 처리 중이다" };
  }
  inFlightGates.add(lockKey);
  try {
    const role = d.gateRoles[a.stage];
    const canAct = await d.roles.canAct(role, a.userId);
    if (!canAct.ok) {
      if (canAct.error) return { ok: false, message: `역할 확인에 실패했다: ${canAct.error}` };
      return { ok: false, message: `이 게이트는 <!subteam^${canAct.groupId}> 만 승인할 수 있다.` };
    }

    let gates;
    try {
      gates = await readGateMap(d.runnerDir, a.key);
    } catch (err) {
      return { ok: false, message: `게이트 정보를 찾을 수 없다: ${(err as Error).message}` };
    }
    const gate = gates[a.stage];

    let stateType;
    try {
      stateType = await d.source.getStateType(gate.issueId);
    } catch (err) {
      return { ok: false, message: `상태 조회에 실패했다: ${(err as Error).message}` };
    }
    const verdict = classifyState(stateType);
    if (verdict === "approved") return { ok: false, message: "이미 승인됨" };
    if (verdict === "rejected") return { ok: false, message: "이미 반려됨" };

    // Recorded before the card moves — see the docstring above.
    const rec = await readThread(d.stateDir, a.key);
    if (rec) {
      rec.gateResolvedBy[a.stage] = a.userId;
      await writeThread(d.stateDir, a.key, rec);
    }

    try {
      if (a.approved) {
        await d.source.comment(gate.issueId, `Slack에서 <@${a.userId}> 승인`);
        await d.source.setStateType(gate.issueId, "completed");
      } else {
        await d.source.comment(gate.issueId, a.reason ?? "사유 없음");
        await d.source.setStateType(gate.issueId, "canceled");
      }
    } catch (err) {
      return { ok: false, message: `처리에 실패했다: ${(err as Error).message}` };
    }

    if (!d.isRunActive(a.key)) {
      return { ok: true, note: `러너 재시작으로 이 실행은 중단됐다. /sdlc run ${a.key} 로 다시 시작한다.` };
    }
    return { ok: true };
  } finally {
    inFlightGates.delete(lockKey);
  }
}

// ── parseSdlcCommand ─────────────────────────────────────────────────────────

export type SdlcCommand = { kind: "create"; title: string } | { kind: "run"; key: string } | { kind: "status" } | { kind: "help" };

export function parseSdlcCommand(text: string): SdlcCommand {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "help") return { kind: "help" };
  if (trimmed.toLowerCase() === "status") return { kind: "status" };
  const runMatch = trimmed.match(/^run\s+(\S+)$/i);
  if (runMatch) return { kind: "run", key: runMatch[1] };
  return { kind: "create", title: trimmed };
}

/**
 * Pure predicate behind the "▶ 시작" button's double-click guard: block when this key was
 * already marked started by a previous click, or when its pipeline run is already active.
 * Exported (and kept trivial) so it's cheaply unit-testable without standing up a Bolt app.
 */
export function shouldBlockDoubleStart(key: string, startedKeys: ReadonlySet<string>, isRunActive: (key: string) => boolean): boolean {
  return startedKeys.has(key) || isRunActive(key);
}

const HELP_TEXT = [
  "*AI-SDLC 사용법*",
  "`/sdlc <제목>` — 새 티켓을 만들고 알림을 게시한다",
  "`/sdlc run <키>` — 기존 티켓으로 파이프라인을 시작한다 (예: `/sdlc run ENG-12`)",
  "`/sdlc status` — 진행 중인 실행 목록을 본다",
  "`/sdlc help` — 이 도움말을 본다",
].join("\n");

// ── startSlackApp ────────────────────────────────────────────────────────────

export interface StartSlackAppOptions {
  config: Config;
  source: TicketSource;
  stateDir: string;
  runnerDir: string;
  /** Queues a pipeline run, returning its 1-based position in the queue. */
  enqueue: (t: Ticket) => number;
  isRunActive: (key: string) => boolean;
  /**
   * Marks a ticket id as already handled by LinearWatcher, so a `/sdlc <title>`-created ticket
   * isn't also picked up (and re-announced) by the next poll. Optional: only needed when
   * `config.linearTrigger === "poll"`, i.e. when index.ts actually has a watcher running.
   */
  markTicketSeen?: (id: string) => Promise<void>;
}

async function updateGateMessage(
  client: SlackClientLike,
  o: { stateDir: string; runnerDir: string; key: string; stage: StageId; approved: boolean; userId: string; reason?: string },
): Promise<void> {
  const rec = await readThread(o.stateDir, o.key);
  if (!rec) return;
  const ts = rec.gateTs[o.stage];
  if (!ts) return;
  let gateUrl = "";
  try {
    gateUrl = (await readGateMap(o.runnerDir, o.key))[o.stage].url;
  } catch {
    // best effort — the message still updates without a working Linear link
  }
  const msg = gateMessage({
    key: o.key,
    ticketId: rec.ticketId,
    stage: o.stage,
    role: "",
    summary: "게이트가 처리됐다. 자세한 내용은 Linear 카드의 코멘트를 확인하라.",
    gateUrl,
    state: o.approved ? "approved" : "rejected",
    by: o.approved ? o.userId : undefined,
    reason: o.reason,
  });
  await client.chat.update({ channel: rec.channel, ts, text: msg.text, blocks: msg.blocks });
}

/**
 * Builds and starts the Socket Mode Bolt app. Never called under `npm test`. All the logic it
 * delegates to (`handleGateAction`, `parseSdlcCommand`, `createSlackNotifier`) is independently
 * unit-tested — this function is glue.
 */
export async function startSlackApp(
  o: StartSlackAppOptions,
): Promise<{ notifier: ReturnType<typeof createSlackNotifier>; stop(): Promise<void> }> {
  if (!o.config.slack) throw new Error("startSlackApp called without config.slack");
  const slackConfig = o.config.slack;

  const app = new App({ token: slackConfig.botToken, appToken: slackConfig.appToken, socketMode: true });
  const client = app.client as unknown as SlackClientLike;

  const roles = new RoleChecker({
    roleGroups: slackConfig.roleGroups,
    listMembers: async (groupId: string) => {
      const res = await app.client.usergroups.users.list({ usergroup: groupId });
      return (res.users as string[] | undefined) ?? [];
    },
  });

  const notifier = createSlackNotifier({ client, channel: slackConfig.channelId, stateDir: o.stateDir, roleGroups: slackConfig.roleGroups });

  const gateDeps: GateActionDeps = {
    source: o.source,
    roles,
    stateDir: o.stateDir,
    runnerDir: o.runnerDir,
    isRunActive: o.isRunActive,
    gateRoles: o.config.gateRoles,
  };

  // Keys whose "▶ 시작" click (or `/sdlc run`) has already been accepted — guards a double click
  // that arrives before the first click's own message update (or queue position) lands. See
  // `shouldBlockDoubleStart`.
  const startedKeys = new Set<string>();

  app.action(ACTIONS.start, async ({ ack, body, client: actionClient }) => {
    await ack();
    const b = body as any;
    const value: ActionValue = JSON.parse(b.actions[0].value);
    const userId: string = b.user.id;
    if (shouldBlockDoubleStart(value.key, startedKeys, o.isRunActive)) {
      await actionClient.chat.postEphemeral({ channel: b.channel.id, user: userId, text: "이미 시작됨" });
      return;
    }
    startedKeys.add(value.key);
    try {
      const ticket = await o.source.getTicket(value.key);
      await notifier.markStarted(value.key, userId);
      const position = o.enqueue(ticket);
      if (position > 1) {
        const rec = await readThread(o.stateDir, value.key);
        if (rec) {
          await actionClient.chat.postMessage({
            channel: rec.channel,
            thread_ts: rec.threadTs,
            text: `대기열 ${position}번째 — 앞선 실행이 끝나면 시작한다`,
          });
        }
      }
    } catch (err) {
      startedKeys.delete(value.key); // let the operator retry after a real failure
      await actionClient.chat.postEphemeral({ channel: b.channel.id, user: userId, text: `시작 실패: ${(err as Error).message}` });
    }
  });

  app.action(ACTIONS.ignore, async ({ ack, body, client: actionClient }) => {
    await ack();
    const b = body as any;
    const value: ActionValue = JSON.parse(b.actions[0].value);
    const userId: string = b.user.id;
    const ticket = await o.source.getTicket(value.key).catch(() => null);
    const msg = ticketNotice(
      { key: value.key, title: ticket?.title ?? value.key, url: ticket?.url ?? "", labels: ticket?.labels ?? [], ticketId: value.ticketId },
      { state: "ignored", by: userId },
    );
    await actionClient.chat.update({ channel: b.channel.id, ts: b.message.ts, text: msg.text, blocks: msg.blocks as any });
  });

  app.action(ACTIONS.approve, async ({ ack, body, client: actionClient }) => {
    await ack();
    const b = body as any;
    const value: ActionValue = JSON.parse(b.actions[0].value);
    const userId: string = b.user.id;
    if (!value.stage) return;
    const result = await handleGateAction({ userId, key: value.key, stage: value.stage, approved: true }, gateDeps);
    if (!result.ok) {
      await actionClient.chat.postEphemeral({ channel: b.channel.id, user: userId, text: result.message });
      return;
    }
    await updateGateMessage(client, { stateDir: o.stateDir, runnerDir: o.runnerDir, key: value.key, stage: value.stage, approved: true, userId });
    if (result.note) await actionClient.chat.postEphemeral({ channel: b.channel.id, user: userId, text: result.note });
  });

  app.action(ACTIONS.reject, async ({ ack, body, client: actionClient }) => {
    await ack();
    const b = body as any;
    const value: ActionValue = JSON.parse(b.actions[0].value);
    await actionClient.views.open({ trigger_id: b.trigger_id, view: rejectModal(value) as any });
  });

  app.view(REJECT_MODAL, async ({ ack, view, body, client: viewClient }) => {
    await ack();
    const value: ActionValue = JSON.parse(view.private_metadata);
    const userId: string = (body as any).user.id;
    const reason = view.state.values.reason?.reason?.value ?? "";
    if (!value.stage) return;
    const result = await handleGateAction({ userId, key: value.key, stage: value.stage, approved: false, reason }, gateDeps);
    if (!result.ok) {
      await viewClient.chat.postEphemeral({ channel: slackConfig.channelId, user: userId, text: result.message });
      return;
    }
    await updateGateMessage(client, {
      stateDir: o.stateDir,
      runnerDir: o.runnerDir,
      key: value.key,
      stage: value.stage,
      approved: false,
      userId,
      reason,
    });
    if (result.note) await viewClient.chat.postEphemeral({ channel: slackConfig.channelId, user: userId, text: result.note });
  });

  app.command("/sdlc", async ({ ack, command, respond, client: cmdClient }) => {
    await ack();
    const parsed = parseSdlcCommand(command.text ?? "");
    switch (parsed.kind) {
      case "help":
        await respond({ response_type: "ephemeral", text: HELP_TEXT });
        return;
      case "status": {
        const active = await listActiveRuns(o.stateDir);
        const text = active.length
          ? active
              .map((r) => `• <${r.meta.url}|${r.meta.key}> ${r.meta.title} — ${r.live.stage} (${r.live.phase}${r.live.role ? `, ${r.live.role} 대기` : ""})`)
              .join("\n")
          : "진행 중인 실행이 없다.";
        await respond({ response_type: "ephemeral", text });
        return;
      }
      case "run": {
        if (shouldBlockDoubleStart(parsed.key, startedKeys, o.isRunActive)) {
          await respond({ response_type: "ephemeral", text: "이미 시작됨" });
          return;
        }
        startedKeys.add(parsed.key);
        try {
          const ticket = await o.source.getTicket(parsed.key);
          await notifier.markStarted(ticket.key, command.user_id);
          const position = o.enqueue(ticket);
          if (position > 1) {
            await respond({ response_type: "ephemeral", text: `대기열 ${position}번째 — 앞선 실행이 끝나면 시작한다` });
          }
        } catch (err) {
          startedKeys.delete(parsed.key);
          await respond({ response_type: "ephemeral", text: `시작 실패: ${(err as Error).message}` });
        }
        return;
      }
      case "create": {
        try {
          const ticket = await o.source.createTicket({ title: parsed.title, body: parsed.title });
          if (o.markTicketSeen) await o.markTicketSeen(ticket.id);
          const state = slackConfig.startMode === "auto" ? "auto" : "new";
          await notifier.postTicketNotice({ ...ticket, createdAt: new Date().toISOString(), creator: command.user_name }, state);
          if (state === "auto") o.enqueue(ticket);
        } catch (err) {
          await respond({ response_type: "ephemeral", text: `티켓 생성 실패: ${(err as Error).message}` });
        }
        return;
      }
    }
  });

  // Bolt's Socket Mode receiver can fail asynchronously (a bad token, a dropped connection)
  // outside the promise `app.start()` returns. Without this handler, that surfaces as an
  // unhandled rejection that crashes the whole runner — one bad Slack token must never take
  // down the webhook path along with it.
  app.error(async (error) => {
    console.error(`[slack] 오류: ${(error as { message?: string }).message ?? error}`);
  });

  try {
    await app.start();
  } catch (err) {
    // A failed start can leave the underlying socket-mode client mid-retry; stop it explicitly
    // so a bad token logs one clear error and exits this path, instead of crashing the process
    // on a later unhandled rejection from a retry we no longer care about.
    try {
      await app.stop();
    } catch {
      // best effort
    }
    throw new Error(`Slack Socket Mode 연결 실패 — SLACK_BOT_TOKEN/SLACK_APP_TOKEN을 확인하라: ${(err as Error).message}`);
  }

  // Confirms the bot can actually post before declaring success — a channel the bot hasn't
  // been invited to fails here, not silently on the first real notice.
  try {
    await client.chat.postMessage({ channel: slackConfig.channelId, text: "🤖 AI-SDLC 봇이 연결됐다." });
  } catch (err) {
    const message = (err as { data?: { error?: string } }).data?.error ?? (err as Error).message;
    if (message === "not_in_channel") {
      console.error(`[slack] 봇이 채널 ${slackConfig.channelId} 에 초대되지 않았다. Slack에서 /invite @AI-SDLC 로 초대하라.`);
    } else {
      console.error(`[slack] 기동 확인 메시지 전송 실패: ${message}`);
    }
  }

  const unrestricted = roles.unrestrictedRoles(STAGES.map((s) => o.config.gateRoles[s]));
  console.log(`[slack] 연결됨 — 채널 ${slackConfig.channelId}, 시작 모드 ${slackConfig.startMode}, 폴링 주기 ${o.config.linearPollIntervalMs}ms`);
  if (unrestricted.length) {
    console.log(`[slack] 역할 제한 없음 (누구나 승인 가능): ${[...new Set(unrestricted)].join(", ")}`);
  }

  return {
    notifier,
    async stop() {
      await app.stop();
    },
  };
}
