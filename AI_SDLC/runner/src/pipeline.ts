import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Config } from "./config.ts";
import type { StateType, Ticket, TicketSource } from "./adapters/types.ts";
import { runStage, type StageResult } from "./claude.ts";
import { runE2E } from "./e2e.ts";
import { awaitApproval, gateMapPath, readGateMap, type GateMap, type StageId } from "./gate.ts";
import type { LiveStatus, RunMeta, StageLogEntry } from "./state.ts";
import { noopEvents, safeEvents, type PipelineEvents } from "./events.ts";
import { noInterview, parseOpenQuestions, type InterviewChannel } from "./interview.ts";

const DEPTH_MARKER = /sdlc-depth:\s*(\d+)/i;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reads the `sdlc-depth: N` marker embedded in an auto-generated ticket's body. Absent = depth 0 (a human-created ticket). */
export function extractDepth(ticket: Pick<Ticket, "body">): number {
  const match = ticket.body.match(DEPTH_MARKER);
  return match ? Number(match[1]) : 0;
}

/**
 * The loop-closing guard: only create a follow-up ticket from a ticket that
 * carries the auto label, and only while we're below the configured depth.
 * A human-authored ticket (no auto label) never counts against the depth.
 */
export function shouldCreateFollowupTicket(ticket: Ticket, autoTicketLabel: string, maxAutoTicketDepth: number): boolean {
  if (!ticket.labels.includes(autoTicketLabel)) return true;
  return extractDepth(ticket) < maxAutoTicketDepth;
}

/**
 * Turns a detection script's `tier=N` line into a number.
 * Returns null when the output has no tier line at all, so the caller can tell
 * "the script said tier 0" apart from "the script never ran properly".
 */
export function parseTier(output: string): number | null {
  const match = output.match(/\btier=(\d+)\b/);
  return match ? Number(match[1]) : null;
}

async function appendStateLog(runnerDir: string, key: string, entry: StageLogEntry): Promise<void> {
  const stateDir = join(runnerDir, ".state");
  await mkdir(stateDir, { recursive: true });
  const statePath = join(stateDir, `${key}.json`);
  let log: StageLogEntry[] = [];
  if (existsSync(statePath)) {
    try {
      log = JSON.parse(await readFile(statePath, "utf8"));
    } catch {
      log = [];
    }
  }
  log.push(entry);
  await writeFile(statePath, JSON.stringify(log, null, 2));
}

/** Written once, at the start of a run — everything a listener needs that never changes again. */
async function writeMeta(runnerDir: string, key: string, meta: RunMeta): Promise<void> {
  await mkdir(join(runnerDir, ".state"), { recursive: true });
  await writeFile(join(runnerDir, ".state", `${key}.meta.json`), JSON.stringify(meta, null, 2));
}

/**
 * The single choke point for "what is this run doing right now". Every write replaces the whole
 * file — this is a live snapshot for `/sdlc status` (a later task) to poll, not a log — so a
 * reader never has to guess whether a stage is still running from a stale entry.
 */
async function writeLive(runnerDir: string, key: string, status: LiveStatus): Promise<void> {
  await mkdir(join(runnerDir, ".state"), { recursive: true });
  await writeFile(join(runnerDir, ".state", `${key}.live.json`), JSON.stringify(status, null, 2));
}

/**
 * Best-effort: an auto-generated ticket's body always contains a link back to the ticket that
 * caused it (see `runMaintain` below), so a listener can draw the "↺ back to 01" loop.
 * A human-authored ticket has no such link, and that's fine — it just means depth 0 has no parent.
 */
function extractParentUrl(body: string): string | undefined {
  const match = body.match(/https?:\/\/\S+/);
  return match ? match[0].replace(/[)\].,]+$/, "") : undefined;
}

async function runAndLog(
  runnerDir: string,
  key: string,
  stage: string,
  prompt: string,
  cwd: string,
  events: PipelineEvents,
  pluginDir: string,
  allowedTools?: string[],
  resumeSessionId?: string,
): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  await writeLive(runnerDir, key, { stage, phase: "running", since: startedAt });
  console.log(`[pipeline:${key}] ${stage} starting`);
  await events.stageStarted(key, stage);
  const result = await runStage({ prompt, cwd, allowedTools, pluginDir, resumeSessionId });
  const endedAt = new Date().toISOString();
  await appendStateLog(runnerDir, key, {
    stage,
    startedAt,
    endedAt,
    ok: result.ok,
    sessionJsonlPath: result.sessionJsonlPath,
    note: result.error,
  });
  console.log(
    `[pipeline:${key}] ${stage} ${result.ok ? "ok" : "FAILED"}${result.sessionJsonlPath ? ` (session: ${result.sessionJsonlPath})` : ""}`,
  );
  const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
  await events.stageFinished(key, stage, result.ok, durationMs, result.error);
  return result;
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd });
    let output = "";
    child.stdout?.on("data", (c: Buffer) => (output += c.toString("utf8")));
    child.stderr?.on("data", (c: Buffer) => (output += c.toString("utf8")));
    child.on("error", (err) => resolvePromise({ ok: false, output: `${cmd} spawn error: ${err.message}` }));
    child.on("close", (code) => resolvePromise({ ok: code === 0, output }));
  });
}

async function detectTestCommand(repoDir: string): Promise<[string, string[]] | null> {
  const pkgPath = join(repoDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      if (pkg.scripts?.test) return ["npm", ["test", "--silent"]];
    } catch {
      // fall through to other detectors
    }
  }
  if (existsSync(join(repoDir, "Makefile"))) return ["make", ["test"]];
  if (existsSync(join(repoDir, "pytest.ini")) || existsSync(join(repoDir, "pyproject.toml"))) {
    return ["pytest", ["-q"]];
  }
  return null;
}

/**
 * 00-setup: build the approval pipeline inside Linear itself.
 *
 * Deliberately an agent step rather than a runner API call — this is the playbook's
 * "write the outcome back through an MCP connector" in its most literal form, and it
 * means the sub-issues, their role labels and their descriptions are authored in the
 * same session log the gate map links to.
 */
async function setupGates(
  runnerDir: string,
  key: string,
  ticket: Ticket,
  config: Config,
  repoRoot: string,
  events: PipelineEvents,
): Promise<GateMap> {
  const outPath = gateMapPath(runnerDir, key);
  await mkdir(join(runnerDir, ".state"), { recursive: true });

  // `/sdlc run <키>` after an aborted run (or any restart) must not duplicate the six Linear gate
  // sub-issues — reuse whatever 00-setup already wrote last time, and skip running the agent
  // again, as long as the file on disk still parses as a valid gate map.
  if (existsSync(outPath)) {
    try {
      const existing = await readGateMap(runnerDir, key);
      console.log(`[gate:setup] 기존 게이트 재사용 (${outPath})`);
      return existing;
    } catch (err) {
      console.warn(`[gate:setup] 기존 게이트 맵이 손상돼 새로 만든다: ${(err as Error).message}`);
    }
  }

  const stageLines = (Object.entries(config.gateRoles) as Array<[StageId, string]>)
    .map(([stage, role]) => `  - "${stage}": 제목 "[gate] ${stage} — 승인자: ${role}"`)
    .join("\n");

  const prompt = [
    `Linear MCP를 사용해 이슈 "${ticket.key}" (id: ${ticket.id}, ${ticket.url}) 아래에 승인 게이트용 하위 이슈 6개를 만들어라.`,
    `부모 이슈와 같은 팀에 만든다.`,
    ``,
    `만들 하위 이슈:`,
    stageLines,
    ``,
    `각 하위 이슈 본문에는 다음을 넣어라:`,
    `  - 이 게이트가 무엇을 승인하는 것인지 한 줄`,
    `  - "승인하려면 이 카드를 Done 으로 옮긴다. 반려하려면 Canceled 로 옮기고 사유를 코멘트로 남긴다."`,
    `  - 원 티켓 링크 ${ticket.url}`,
    ``,
    `모두 만든 뒤, 정확히 아래 형식의 JSON을 ${outPath} 에 Write 해라. 다른 키를 추가하지 마라.`,
    `{`,
    `  "01-plan":     { "issueId": "<uuid>", "key": "<식별자>", "url": "<url>" },`,
    `  "02-design":   { ... }, "03-build": { ... }, "04-test": { ... },`,
    `  "05-deploy":   { ... }, "06-maintain": { ... }`,
    `}`,
    `issueId 는 Linear 내부 UUID 여야 한다 (식별자 ENG-12 가 아니라).`,
  ].join("\n");

  await runAndLog(runnerDir, key, "00-setup", prompt, repoRoot, events, config.pluginDir, ["Write", "mcp__linear__*"]);
  // Throws with an explicit message if the agent didn't produce a usable map — the
  // pipeline must not fall through into an ungated run.
  return readGateMap(runnerDir, key);
}

/**
 * Creates the branch worktree every stage runs in, and returns the directory that corresponds to
 * `repoPath` inside it.
 *
 * `git worktree add` always checks out the whole repository, but `repoPath` may point at a
 * subdirectory of it (the demo app is not a standalone repo), so the same relative offset is
 * re-applied inside the worktree. Every git call is checked: an unchecked failure here would turn
 * git's error text into a path and silently run the whole pipeline against the wrong directory.
 */
export async function prepareWorkDir(
  repoRoot: string,
  runnerDir: string,
  key: string,
  useWorktree: boolean,
): Promise<{ workDir: string; branch: string | null }> {
  if (!useWorktree) return { workDir: repoRoot, branch: null };

  const top = await runCommand("git", ["rev-parse", "--show-toplevel"], repoRoot);
  if (!top.ok) {
    throw new Error(`git rev-parse --show-toplevel failed in ${repoRoot}: ${top.output.trim()}`);
  }
  const toplevel = top.output.trim();

  const branch = `sdlc/${key}`;
  const worktreeRoot = resolve(runnerDir, ".worktrees", key);
  await mkdir(resolve(runnerDir, ".worktrees"), { recursive: true });
  if (!existsSync(worktreeRoot)) {
    const add = await runCommand("git", ["worktree", "add", "-b", branch, worktreeRoot], repoRoot);
    if (!add.ok) {
      throw new Error(`git worktree add -b ${branch} failed: ${add.output.trim()}`);
    }
  }

  const offset = relative(toplevel, repoRoot);
  const workDir = offset ? join(worktreeRoot, offset) : worktreeRoot;
  if (!existsSync(workDir)) {
    throw new Error(`worktree created but ${workDir} does not exist (offset "${offset}" from ${toplevel})`);
  }
  return { workDir, branch };
}

/**
 * A note for the human at the gate when the stage that produced the artifact didn't actually
 * succeed. Approving a document that was never written is worse than seeing no gate at all.
 */
function artifactWarning(result: StageResult, artifactPath: string): string {
  if (!result.ok) {
    const why = result.error ?? (result.timedOut ? "타임아웃" : `exit ${result.exitCode}`);
    return `> ⚠️ 이 단계의 claude 세션이 실패했다 (${why}). 아래 산출물은 없거나 불완전할 수 있다.\n\n`;
  }
  if (!existsSync(artifactPath)) {
    return `> ⚠️ 세션은 정상 종료했지만 \`${artifactPath}\` 가 생성되지 않았다.\n\n`;
  }
  return "";
}

export async function runPipeline(
  ticket: Ticket,
  config: Config,
  source: TicketSource,
  runnerDir: string,
  events: PipelineEvents = noopEvents,
  interview: InterviewChannel = noInterview,
): Promise<void> {
  const key = ticket.key || ticket.id;
  const repoRoot = config.repoPath;
  // Wrapped unconditionally here — the pipeline must never depend on a caller having
  // pre-wrapped `events` itself. A dead notifier can never stop a run.
  const ev = safeEvents(events);

  // Written once, up front, so a listener can show a card for this run the moment it starts —
  // it never has to wait for 00-setup to finish.
  const meta: RunMeta = {
    key,
    title: ticket.title,
    url: ticket.url,
    labels: ticket.labels,
    depth: extractDepth(ticket),
    parentUrl: extractParentUrl(ticket.body),
    autoApprove: config.autoApprove,
    startedAt: new Date().toISOString(),
    gateRoles: config.gateRoles,
  };
  await writeMeta(runnerDir, key, meta);
  await ev.runStarted(meta);

  // The worktree is created up front, before stage 01, so that every stage — the documents as
  // well as the code — runs in ONE checkout.
  //
  // This matters for correctness, not tidiness: the hooks resolve `docs/plan/*.md` relative to
  // their own cwd, which is whatever cwd the stage's `claude -p` was spawned with. If the docs
  // lived in repoRoot while the build stages ran in the worktree, plan-drift.sh and
  // verify-before-done.sh would find no plan file and fail open — silently inert in the default
  // useWorktree=true configuration. Keeping one working directory keeps them armed, and makes the
  // PR carry the intent/spec/plan trio alongside the diff they justify.
  const { workDir, branch } = await prepareWorkDir(repoRoot, runnerDir, key, config.useWorktree);

  const docsIntent = join(workDir, "docs", "intent", `${key}.md`);
  const docsSpec = join(workDir, "docs", "spec", `${key}.md`);
  const docsPlan = join(workDir, "docs", "plan", `${key}.md`);
  await mkdir(join(workDir, "docs", "intent"), { recursive: true });
  await mkdir(join(workDir, "docs", "spec"), { recursive: true });
  await mkdir(join(workDir, "docs", "plan"), { recursive: true });

  const gates = config.autoApprove ? null : await setupGates(runnerDir, key, ticket, config, workDir, ev);

  /**
   * Blocks on the human who owns this stage. `reason` is set when rejected — `gateWithRework`
   * below is the only caller that reads it.
   */
  async function gate(stage: StageId, summary: string): Promise<{ approved: boolean; reason?: string }> {
    if (!gates) {
      console.log(`[gate:${stage}] SDLC_AUTO_APPROVE=1 — 게이트를 건너뛴다 (리허설 모드).`);
      return { approved: true };
    }
    await writeLive(runnerDir, key, {
      stage: `gate:${stage}`,
      phase: "waiting",
      role: config.gateRoles[stage],
      gateUrl: gates[stage].url,
      since: new Date().toISOString(),
    });
    await ev.gateWaiting(key, stage, config.gateRoles[stage], gates[stage], summary);
    const result = await awaitApproval({
      source,
      gate: gates[stage],
      stage,
      role: config.gateRoles[stage],
      summary,
      pollIntervalMs: config.gatePollIntervalMs,
      timeoutMs: config.gateTimeoutMs,
      autoApprove: false,
    });
    await appendStateLog(runnerDir, key, {
      stage: `gate:${stage}`,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      ok: result.approved,
      sessionJsonlPath: null,
      note: result.approved ? `${config.gateRoles[stage]} 승인` : `중단: ${result.reason}`,
    });
    await ev.gateResolved(key, stage, result.approved, result.reason);
    return { approved: result.approved, reason: result.reason };
  }

  const DOC_WRITE_TOOLS = ["Read", "Write", "Glob", "Grep", "Skill"];
  const REWORKABLE_STAGES: readonly StageId[] = ["01-plan", "02-design", "03-build"];

  /** The session id to resume from, plus the most recent `StageResult` that touched the artifact — used to build `artifactWarning` for the *next* gate summary, not just the very first run's. */
  interface StageThread {
    sessionId: string;
    latest: StageResult;
  }

  /**
   * After moving a rejected gate's card back to "unstarted", confirms it no longer reads as
   * "canceled" before handing control back to `gate()`'s own poll — a source with eventual
   * consistency (or a fake source's clamped-last-value polling) could otherwise hand the very
   * first re-poll a stale "canceled" and read it as a second human rejection nobody made. Best
   * effort: retries a few times with a short delay, then gives up and lets the pipeline continue
   * regardless — `gate()`'s own polling loop is still running after this and will eventually see
   * the truth either way.
   */
  async function confirmNotCanceled(stage: StageId, issueId: string): Promise<void> {
    for (let i = 0; i < 3; i++) {
      let state: StateType;
      try {
        state = await source.getStateType(issueId);
      } catch {
        return;
      }
      if (state !== "canceled") return;
      await sleep(config.gatePollIntervalMs);
    }
    console.log(`[gate:${stage}] unstarted로 되돌린 뒤에도 여전히 canceled로 읽힌다 (3회 재확인 실패) — 그래도 게이트를 다시 연다.`);
  }

  /**
   * Runs `stageLabel` with `resumeSessionId`, and if that resume attempt fails in a way that
   * leaves no session transcript behind (`ok:false` and `sessionJsonlPath:null` — i.e. the
   * `--resume` never produced a usable session), retries exactly once in a fresh session that
   * carries the full existing artifact plus the same answers/reason inline. See §6 of the spec.
   */
  async function runStageOrFallback(
    stageLabel: string,
    prompt: string,
    fallbackPrompt: string,
    resumeSessionId: string | undefined,
  ): Promise<StageResult> {
    let result = await runAndLog(runnerDir, key, stageLabel, prompt, workDir, ev, config.pluginDir, DOC_WRITE_TOOLS, resumeSessionId);
    if (!result.ok && result.sessionJsonlPath === null) {
      result = await runAndLog(runnerDir, key, stageLabel, fallbackPrompt, workDir, ev, config.pluginDir, DOC_WRITE_TOOLS);
    }
    return result;
  }

  /**
   * The 01 Plan interview loop (spec §3): reads `docsIntent`'s "## 미해결 질문" section, and
   * while there are still open questions and we haven't hit `interviewMaxRounds`, asks
   * `interview` and — on an answered round — resumes the intent session to revise the document
   * and reparses. Stops (without asking again) the moment questions run out, or the channel
   * returns anything other than an answered round. Returns the session id to resume from next
   * (revised if any round ran, otherwise unchanged) — used both after the initial 01-intent run
   * and again after a 01-plan rework.
   */
  async function runInterviewLoop(thread: StageThread): Promise<StageThread> {
    const maxRounds = config.interviewMaxRounds;
    let current = thread.sessionId;
    let latest = thread.latest;
    for (let round = 1; round <= maxRounds; round++) {
      const content = existsSync(docsIntent) ? await readFile(docsIntent, "utf8") : "";
      const questions = parseOpenQuestions(content);
      if (questions.length === 0) break;

      const outcome = await interview.ask(key, questions, round, maxRounds);
      if (outcome.kind !== "answers" || outcome.answers.length === 0) break;

      const answersList = outcome.answers.map((a) => `- ${a.user}: ${a.text}`).join("\n");
      await source.comment(ticket.id, `01 Plan 인터뷰 답변 (round ${round}/${maxRounds}):\n\n${answersList}`).catch((err: Error) => {
        console.error(`[pipeline:${key}] 인터뷰 답변을 원 티켓에 코멘트로 남기지 못했다 (계속한다): ${err.message}`);
      });
      await ev.interviewAnswered?.(key, round, outcome.answers.length);

      const revisePrompt = `다음 답을 반영해 ${docsIntent} 를 고쳐라:\n\n${answersList}`;
      const fallbackPrompt = `기존 산출물 전문:\n\n${content}\n\n${revisePrompt}`;
      const reviseResult = await runStageOrFallback("01-intent-revise", revisePrompt, fallbackPrompt, current);
      current = reviseResult.sessionId;
      latest = reviseResult;
    }
    return { sessionId: current, latest };
  }

  /**
   * Wraps `gate()` for the three reworkable stages (01-plan, 02-design, 03-build — spec §4): on a
   * rejection, while `attempt < reworkMaxAttempts`, runs `<stage>-rework` resuming the session
   * that produced `artifactPath`, reopens the gate card as "unstarted", posts a "재작업 N/M"
   * comment, and — for 01-plan only — runs the interview loop again before re-gating. Once
   * `reworkMaxAttempts` reworks have all still been rejected, gives up like a non-reworkable gate.
   */
  async function gateWithRework(
    stage: StageId,
    artifactPath: string,
    buildSummary: (latest: StageResult) => string,
    thread: StageThread,
    reworkStageLabel: string = `${stage}-rework`,
  ): Promise<{ approved: boolean; sessionId: string }> {
    const maxAttempts = config.reworkMaxAttempts;
    let attempt = 0;
    let current = thread.sessionId;
    let latest = thread.latest;
    for (;;) {
      const { approved, reason } = await gate(stage, buildSummary(latest));
      if (approved) return { approved: true, sessionId: current };
      if (!REWORKABLE_STAGES.includes(stage) || attempt >= maxAttempts) {
        return { approved: false, sessionId: current };
      }

      attempt++;
      const effectiveReason = reason ?? "사유 없음";
      await ev.stageReworking?.(key, stage, attempt, maxAttempts, effectiveReason);

      const artifactContent = existsSync(artifactPath) ? await readFile(artifactPath, "utf8") : "";
      const reworkPrompt = `반려 사유: ${effectiveReason}. 반영해 ${artifactPath} 를 고쳐라.`;
      const fallbackPrompt = `기존 산출물 전문:\n\n${artifactContent}\n\n${reworkPrompt}`;
      const reworkResult = await runStageOrFallback(reworkStageLabel, reworkPrompt, fallbackPrompt, current);
      current = reworkResult.sessionId;
      // The next gate summary must reflect how the rework actually went — a rework (and its
      // fallback) can fail just like any other stage, and the human re-approving must see that.
      latest = reworkResult;

      if (gates) {
        await source.setStateType(gates[stage].issueId, "unstarted").catch((err: Error) => {
          console.error(`[gate:${stage}] 게이트 카드를 unstarted로 되돌리지 못했다 (계속한다): ${err.message}`);
        });
        await source.comment(gates[stage].issueId, `재작업 ${attempt}/${maxAttempts}`).catch((err: Error) => {
          console.error(`[gate:${stage}] "재작업 ${attempt}/${maxAttempts}" 코멘트를 남기지 못했다 (계속한다): ${err.message}`);
        });
        // The card was just moved back to "unstarted" — make sure the next poll doesn't read a
        // stale "canceled" as a second rejection nobody made.
        await confirmNotCanceled(stage, gates[stage].issueId);
      }

      if (stage === "01-plan") {
        const afterInterview = await runInterviewLoop({ sessionId: current, latest });
        current = afterInterview.sessionId;
        latest = afterInterview.latest;
      }
    }
  }

  // ── 01 Plan ─────────────────────────────────────────────────────────────────
  const intentResult = await runAndLog(
    runnerDir,
    key,
    "01-intent",
    `sdlc-intent 스킬을 사용해 아래 티켓에서 ${docsIntent} 를 작성하라.\n\n` +
      `티켓: ${ticket.title}\n\n${ticket.body}\n\n출처: ${ticket.url}`,
    workDir,
    ev,
    config.pluginDir,
    DOC_WRITE_TOOLS,
  );
  const afterInitialInterview = await runInterviewLoop({ sessionId: intentResult.sessionId, latest: intentResult });
  const plan01 = await gateWithRework(
    "01-plan",
    docsIntent,
    (latest) => `${artifactWarning(latest, docsIntent)}01 Plan 산출물: \`${docsIntent}\`\n\n문제/원하는 결과/영향 범위/제약/미해결 질문이 티켓 의도와 맞는지 확인해 달라.`,
    afterInitialInterview,
  );
  if (!plan01.approved) {
    await writeLive(runnerDir, key, { stage: "01-plan", phase: "aborted", since: new Date().toISOString() });
    await ev.runFinished(key, "aborted");
    return;
  }

  // ── 02 Design ───────────────────────────────────────────────────────────────
  const specResult = await runAndLog(
    runnerDir,
    key,
    "02-spec",
    `sdlc-spec 스킬을 사용해 ${docsIntent} 를 읽고 ${docsSpec} 를 작성하라. 정책 충돌은 해당 설계 항목 바로 아래 인라인으로 표시하라.`,
    workDir,
    ev,
    config.pluginDir,
    DOC_WRITE_TOOLS,
  );
  const design02 = await gateWithRework(
    "02-design",
    docsSpec,
    (latest) => `${artifactWarning(latest, docsSpec)}02 Design 산출물: \`${docsSpec}\`\n\n"정책 충돌" 섹션을 각 정책 담당자와 정리한 뒤 진행 여부를 결정해 달라.`,
    { sessionId: specResult.sessionId, latest: specResult },
  );
  if (!design02.approved) {
    await writeLive(runnerDir, key, { stage: "02-design", phase: "aborted", since: new Date().toISOString() });
    await ev.runFinished(key, "aborted");
    return;
  }

  // ── 03 Build ────────────────────────────────────────────────────────────────
  const planResult = await runAndLog(
    runnerDir,
    key,
    "03-plan",
    `sdlc-plan 스킬을 사용해 ${docsSpec} 를 읽고 ${docsPlan} 를 작성하라. "무엇이 깨질 수 있는가" 심문을 반드시 포함하라. 코드는 아직 수정하지 마라.`,
    workDir,
    ev,
    config.pluginDir,
    DOC_WRITE_TOOLS,
  );
  const build03 = await gateWithRework(
    "03-build",
    docsPlan,
    (latest) => `${artifactWarning(latest, docsPlan)}03 Build 착수 계획: \`${docsPlan}\`\n\n변경할 파일 목록과 "무엇이 깨질 수 있는가"를 심문하고, 이대로 구현해도 되는지 판단해 달라.\n승인 후에만 에이전트가 코드를 편집한다.`,
    { sessionId: planResult.sessionId, latest: planResult },
    // This gate approves the *plan* (docsPlan, written by the 03-plan stage) before any code is
    // touched — the rework session edits that same plan document, so it's "03-plan-rework", not
    // "03-build-rework" (03-build itself only runs after this gate is approved).
    "03-plan-rework",
  );
  if (!build03.approved) {
    await writeLive(runnerDir, key, { stage: "03-build", phase: "aborted", since: new Date().toISOString() });
    await ev.runFinished(key, "aborted");
    return;
  }

  await runAndLog(
    runnerDir,
    key,
    "03-build",
    `승인된 ${docsPlan} 의 작업 목록을 순서대로 구현하라. 계획에 없는 파일은 건드리지 마라 — ` +
      `plan-drift 훅이 커밋 시점에 계획과 실제 변경을 대조한다. 저장소 CLAUDE.md 의 규칙을 따르라.`,
    workDir,
    ev,
    config.pluginDir,
  );

  // ── 04 Test ─────────────────────────────────────────────────────────────────
  await runAndLog(
    runnerDir,
    key,
    "04-test-loop",
    `sdlc-test 스킬을 사용해 ${docsPlan} 의 "성공 기준"을 실제로 실행하고, 통과할 때까지 피드백 루프를 돌려라. ` +
      `이건 버그 수정 작업일 수 있으니 테스트를 고쳐서 통과시키지 마라. 마지막에 verifier 서브에이전트로 독립 검증을 받아라.`,
    workDir,
    ev,
    config.pluginDir,
  );

  const testCmd = await detectTestCommand(workDir);
  const unitResult = testCmd ? await runCommand(testCmd[0], testCmd[1], workDir) : { ok: true, output: "no test command detected, skipped" };
  const e2eResult = await runE2E(config.e2eDriver, config.demoAppUrl).catch((err: Error) => ({ ok: false, output: err.message }));
  const testOk = unitResult.ok && e2eResult.ok;
  await appendStateLog(runnerDir, key, {
    stage: "04-test",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    ok: testOk,
    sessionJsonlPath: null,
    note: `unit: ${unitResult.ok ? "ok" : "fail"}; e2e: ${e2eResult.ok ? "ok" : "fail"}`,
  });
  console.log(`[pipeline:${key}] 04-test ${testOk ? "ok" : "FAILED"}`);

  const testSummary =
    `04 Test 결과\n\n- 단위/빌드: ${unitResult.ok ? "통과" : "실패"}\n- e2e: ${e2eResult.ok ? "통과" : "실패"}\n\n` +
    "```\n" +
    (unitResult.output + "\n" + e2eResult.output).slice(-1500) +
    "\n```";
  // A rejection here means "do not ship this", not "throw the run away": 06 Maintain still runs
  // below, records why, and — if the detection tier warrants it — opens the follow-up ticket that
  // closes the loop. Gates 01–03 are different: rejecting those means the work itself was wrong,
  // so the pipeline returns and there is nothing to maintain.
  const testApproved = (await gate("04-test", `${testSummary}\n\n기계적 증거는 위에 붙였다. 의도와 리스크 관점에서 판단해 달라.`)).approved;

  // ── 05 Deploy ───────────────────────────────────────────────────────────────
  let deployOk = false;
  let deployOutput = "";
  let reviewNote = "";
  if (testOk && testApproved) {
    const reviewResult = await runAndLog(
      runnerDir,
      key,
      "05-review",
      `sdlc-review 스킬을 사용해 이 브랜치의 diff 를 Bugs/Security/Compliance 세 패스로 리뷰하라. ` +
        `저장소 REVIEW.md 의 정책을 따르고, ${docsSpec} 의 요구사항 대비 준수 여부를 확인하라. 승인하지 마라 — 발견만 보고하라.`,
      workDir,
      ev,
      config.pluginDir,
      ["Read", "Glob", "Grep", "Bash(git diff *)", "Bash(git log *)", "Bash(git status)", "Skill"],
    );
    // The release manager needs to know whether a review actually happened. An unreported failed
    // review session looks identical to a clean one at the gate.
    if (!reviewResult.ok) {
      reviewNote = `> ⚠️ sdlc-review 세션이 실패했다 (${reviewResult.error ?? (reviewResult.timedOut ? "타임아웃" : `exit ${reviewResult.exitCode}`)}). Bugs/Security/Compliance 리뷰 결과가 없다.\n\n`;
    }
    if (branch) {
      const pr = await runCommand("gh", ["pr", "create", "--fill", "--head", branch], workDir);
      deployOk = pr.ok;
      deployOutput = pr.output;
    } else {
      deployOutput = "useWorktree=false: no dedicated branch, skipping PR creation";
      deployOk = true;
    }
  } else {
    deployOutput = testOk ? "skipped: 04-test 게이트에서 사람이 승인하지 않음" : "skipped: 04-test failed";
  }
  await appendStateLog(runnerDir, key, {
    stage: "05-deploy",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    ok: deployOk,
    sessionJsonlPath: null,
    note: deployOutput.slice(0, 2000),
  });
  console.log(`[pipeline:${key}] 05-deploy ${deployOk ? "ok" : "FAILED"}`);

  // Same rule as the 04 gate: the release manager declining is a decision about shipping, not a
  // reason to skip maintenance. Only ask when there is actually something to release.
  const releaseApproved = deployOk
    ? (
        await gate(
          "05-deploy",
          `${reviewNote}05 Deploy: PR 준비 완료.\n\n\`\`\`\n${deployOutput.slice(0, 1200)}\n\`\`\`\n\n프로덕션 게이트는 \`RELEASE_APPROVED=1\` 없이는 훅이 차단한다. 릴리스를 승인할지 판단해 달라.`,
        )
      ).approved
    : false;

  // ── 06 Maintain ─────────────────────────────────────────────────────────────
  await runMaintain(
    runnerDir,
    key,
    ticket,
    config,
    source,
    repoRoot,
    {
      pipelineOk: testOk && deployOk && testApproved && releaseApproved,
      e2eOk: e2eResult.ok,
      summary: [
        `04-test: ${testOk ? "ok" : "FAILED"} (unit ${unitResult.ok ? "ok" : "fail"}, e2e ${e2eResult.ok ? "ok" : "fail"}), 게이트 ${testApproved ? "승인" : "미승인"}`,
        `05-deploy: ${deployOk ? "ok" : "FAILED"}, 게이트 ${releaseApproved ? "승인" : "미승인"}`,
        "",
        "unit/e2e output (truncated):",
        (unitResult.output + "\n" + e2eResult.output).slice(0, 1500),
      ].join("\n"),
    },
    ev,
  );

  await gate("06-maintain", `06 Maintain 판정이 끝났다. 감지 결과와 후속 티켓 생성 여부를 확인하고 트리아지해 달라 (지금 고칠지, 일정에 넣을지, 기각할지).`);

  // The pipeline always finishes normally from here — unlike the 01/02/03 gates, nothing after
  // this point returns early, so "done" is unconditional regardless of how 06's gate resolved.
  await writeLive(runnerDir, key, { stage: "06-maintain", phase: "done", since: new Date().toISOString() });
  await ev.runFinished(key, "done");
}

interface MaintainInput {
  pipelineOk: boolean;
  e2eOk: boolean;
  summary: string;
}

/**
 * 06 Maintain. The tier verdict comes from `ops/detect.sh` — a deterministic script,
 * never the model — and only then does an agent get involved, at the authority the
 * tier allows: 2σ diagnoses read-only, 3σ may write an intent.md and open a ticket.
 */
async function runMaintain(
  runnerDir: string,
  key: string,
  ticket: Ticket,
  config: Config,
  source: TicketSource,
  repoRoot: string,
  input: MaintainInput,
  events: PipelineEvents,
): Promise<void> {
  const detectScript = join(repoRoot, config.detectScript);
  const metricValue = input.e2eOk ? 0 : 1;

  let tier: number | null = null;
  let detectOutput: string;
  if (existsSync(detectScript)) {
    const run = await runCommand("bash", [detectScript, "--metric", config.detectMetric, "--value", String(metricValue)], repoRoot);
    detectOutput = run.output;
    tier = parseTier(run.output);
  } else {
    detectOutput = `${config.detectScript} 없음 — 파이프라인 결과로 티어를 대체 판정한다.`;
  }
  // No detection script, or it printed nothing parseable: fall back to the pipeline
  // verdict so a missing ops/ directory can never silence maintenance entirely.
  if (tier === null) tier = input.pipelineOk ? 0 : 3;

  console.log(`[pipeline:${key}] 06-maintain detect: tier=${tier}\n${detectOutput.trim()}`);

  if (tier <= 1) {
    await appendStateLog(runnerDir, key, {
      stage: "06-maintain",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      ok: true,
      sessionJsonlPath: null,
      note: `tier=${tier} — 기록만 한다, 에이전트 미개입. ${detectOutput.trim().slice(0, 500)}`,
    });
    return;
  }

  if (tier === 2) {
    await runAndLog(
      runnerDir,
      key,
      "06-maintain-diagnose",
      `sdlc-maintain 스킬의 2σ 절차를 따르라. 지표 ${config.detectMetric} 가 2σ 구간에 있다. ` +
        `읽기 전용으로 원인만 진단하고 보고하라. 파일을 쓰거나 티켓을 만들지 마라.\n\n감지 출력:\n${detectOutput}\n\n${input.summary}`,
      repoRoot,
      events,
      config.pluginDir,
      ["Read", "Glob", "Grep", "Bash(git log *)", "Bash(git diff *)", "Skill"],
    );
    return;
  }

  // tier 3 — the agent may act, but only by writing an intent.md and opening a ticket.
  if (!shouldCreateFollowupTicket(ticket, config.autoTicketLabel, config.maxAutoTicketDepth)) {
    await source.comment(
      ticket.id,
      `AI-SDLC 파이프라인이 3σ 이탈을 감지했지만 자동 티켓 깊이 상한(${config.maxAutoTicketDepth})에 도달해 새 티켓을 만들지 않는다. 사람이 처리해야 한다.\n\n${input.summary}`,
    );
    await appendStateLog(runnerDir, key, {
      stage: "06-maintain",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      ok: false,
      sessionJsonlPath: null,
      note: "tier=3 이지만 깊이 상한 도달 — 후속 티켓 억제, 사람에게 에스컬레이션",
    });
    console.log(`[pipeline:${key}] 06-maintain: depth limit reached, not creating a follow-up ticket`);
    return;
  }

  const depth = extractDepth(ticket) + 1;
  const actResult = await runAndLog(
    runnerDir,
    key,
    "06-maintain-act",
    `sdlc-maintain 스킬의 3σ 절차를 따르라. 지표 ${config.detectMetric} 가 3σ 구간이다.\n\n` +
      `1. 원인을 진단한다.\n` +
      `2. 진단 결과를 01 Plan 형식의 새 intent 문서로 ${join(repoRoot, "docs", "intent")} 아래에 쓴다.\n` +
      `3. Linear MCP 로 새 이슈를 만든다. 라벨 "${config.autoTicketLabel}", 본문 첫 줄에 "sdlc-depth: ${depth}", ` +
      `원인 티켓 ${ticket.url} 링크, 그리고 아래 요약을 포함한다.\n` +
      `프로덕션에 직접 조치하지 마라 — PR 또는 사전 승인된 runbook 경유만 허용된다.\n\n` +
      `감지 출력:\n${detectOutput}\n\n${input.summary}`,
    repoRoot,
    events,
    config.pluginDir,
    ["Read", "Write", "Glob", "Grep", "Skill", "mcp__linear__*"],
  );
  // Closing the loop must not depend on the agent's MCP call succeeding. If the sdlc-maintain
  // session failed, the runner opens the follow-up ticket itself through the adapter — it holds
  // the API key anyway, and a 3σ breach that silently produces no ticket is the one outcome this
  // whole stage exists to prevent.
  // ponytail: `ok` only proves the session exited cleanly, not that it really called Linear.
  // Query the ticket back through the adapter if false negatives ever show up in practice.
  let note: string;
  if (actResult.ok) {
    note = `tier=3 — sdlc-maintain 이 intent 문서와 후속 Linear 티켓(depth ${depth})을 생성했다. 루프가 01 로 돌아간다.`;
  } else {
    const why = actResult.error ?? (actResult.timedOut ? "타임아웃" : `exit ${actResult.exitCode}`);
    try {
      const created = await source.createTicket({
        title: `[auto] fix: ${ticket.title}`,
        body: `AI-SDLC 파이프라인이 ${config.detectMetric} 3σ 이탈을 감지했다. 원인 티켓: ${ticket.url}\n\nsdlc-depth: ${depth}\n\n${detectOutput}\n\n${input.summary}`,
        labels: [config.autoTicketLabel],
      });
      note = `tier=3 — sdlc-maintain 세션 실패(${why}). 러너가 대신 후속 티켓 ${created.key} (${created.url}) 을 생성했다.`;
      console.log(`[pipeline:${key}] 06-maintain: agent stage failed, runner opened ${created.key} instead`);
      await events.followupCreated(key, { key: created.key, url: created.url });
    } catch (err) {
      note = `tier=3 — sdlc-maintain 세션 실패(${why}) 이후 러너의 티켓 생성도 실패했다: ${(err as Error).message}. 루프가 닫히지 않았다, 사람이 처리해야 한다.`;
      console.error(`[pipeline:${key}] 06-maintain: FAILED to open a follow-up ticket — the loop is open`);
    }
  }
  await appendStateLog(runnerDir, key, {
    stage: "06-maintain",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    ok: false,
    sessionJsonlPath: null,
    note,
  });
}
