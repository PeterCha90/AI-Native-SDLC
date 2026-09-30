import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/pipeline.ts";
import { STAGES, type StageId } from "../src/gate.ts";
import type { Config } from "../src/config.ts";
import type { IssueComment, NewTicket, StateType, Ticket, TicketSource } from "../src/adapters/types.ts";
import type { InterviewChannel, InterviewOutcome } from "../src/interview.ts";

/**
 * Exercises the 01 Plan interview loop and the 01/02/03 gate-rejection rework loop added on top
 * of runPipeline. Reuses the fake-runner-via-PATH approach from pipeline-e2e.test.ts, but with a
 * custom `claude` stub that (a) can script intent.md's content across successive invocations so
 * `parseOpenQuestions` sees a controlled question count each round, and (b) logs every
 * invocation's argv so a test can confirm `--resume <id>` was passed the right session id.
 */

const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe" });

/**
 * Stand-in for `claude -p`. Differences from the pipeline-e2e stub:
 *  - logs {argv, prompt} for every invocation to STUB_LOG (one JSON object per line), so tests can
 *    inspect exactly what was passed (in particular, whether `--resume <sessionId>` shows up).
 *  - scripts docs/intent/<key>.md's content from an ordered queue at STUB_INTENT_PLAN (a JSON file
 *    holding a string array); each invocation that would write that path consumes the next queued
 *    string, holding on the last one once the queue is exhausted.
 *  - still honors STUB_CLAUDE_FAIL_ON (substring of the prompt) to simulate a failed session, and
 *    still bootstraps docs/*.gates.json for 00-setup and generic docs/spec, docs/plan content.
 */
const CLAUDE_STUB = `#!/usr/bin/env python3
import os, re, sys, json
argv = sys.argv[1:]
prompt = ""
for i, a in enumerate(argv):
    if a == "-p" and i + 1 < len(argv):
        prompt = argv[i + 1]

log_path = os.environ.get("STUB_LOG")
if log_path:
    with open(log_path, "a") as f:
        f.write(json.dumps({"argv": argv, "prompt": prompt}) + "\\n")

if os.environ.get("STUB_CLAUDE_FAIL_ON") and os.environ["STUB_CLAUDE_FAIL_ON"] in prompt:
    sys.stderr.write("stub claude: deliberate failure\\n")
    sys.exit(3)

for path in re.findall(r"/[\\w./-]+\\.(?:md|json)", prompt):
    if path.endswith(".gates.json"):
        stages = ["01-plan","02-design","03-build","04-test","05-deploy","06-maintain"]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({s: {"issueId": "uuid-" + s, "key": "GATE-" + s, "url": "http://x/" + s} for s in stages}, f)
        continue
    if "/docs/intent/" in path:
        plan_path = os.environ.get("STUB_INTENT_PLAN")
        content = "# stub intent\\n\\n## 미해결 질문\\n없음\\n"
        if plan_path and os.path.exists(plan_path):
            with open(plan_path) as f:
                plan = json.load(f)
            idx_path = plan_path + ".idx"
            idx = 0
            if os.path.exists(idx_path):
                idx = int(open(idx_path).read() or "0")
            if plan:
                content = plan[min(idx, len(plan) - 1)]
            open(idx_path, "w").write(str(idx + 1))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
    elif "/docs/" in path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.exists(path):
            with open(path, "w") as f:
                f.write("# stub artifact\\n\\n## 변경할 파일\\n- \`README.md\` (수정)\\n")
print("stub claude done")
`;

const okStub = (name: string) => `#!/bin/sh\necho "${name} stub ok"\nexit 0\n`;

async function makeStubs(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const files: Array<[string, string]> = [
    ["claude", CLAUDE_STUB],
    ["gh", okStub("gh")],
    ["ego-browser", `#!/bin/sh\ncat >/dev/null\necho "ego stub"\nexit 0\n`],
  ];
  for (const [name, body] of files) {
    const p = join(dir, name);
    await writeFile(p, body);
    await chmod(p, 0o755);
  }
}

async function makeRepo(): Promise<string> {
  const root = realpathSync(await mkdtemp(join(tmpdir(), "sdlc-interview-repo-")));
  git(["init", "-q"], root);
  git(["config", "user.email", "t@t"], root);
  git(["config", "user.name", "t"], root);
  await writeFile(join(root, "README.md"), "demo\n");
  git(["add", "-A"], root);
  git(["commit", "-qm", "init"], root);
  return root;
}

interface Recorder {
  source: TicketSource;
  created: NewTicket[];
  comments: Array<{ id: string; body: string }>;
  stateChanges: Array<{ id: string; type: string }>;
}

/** `states` maps a gate issueId to the verdict sequence it should report (clamped to the last entry once exhausted). */
function recordingSource(states: Record<string, StateType[]>): Recorder {
  const created: NewTicket[] = [];
  const comments: Array<{ id: string; body: string }> = [];
  const stateChanges: Array<{ id: string; type: string }> = [];
  const cursor: Record<string, number> = {};
  const source: TicketSource = {
    name: "fake",
    verify: () => true,
    parse: () => null,
    createTicket: async (t) => {
      created.push(t);
      return { id: "new-id", key: "ENG-99", title: t.title, body: t.body, labels: t.labels ?? [], url: "http://x/ENG-99" };
    },
    comment: async (id, body) => {
      comments.push({ id, body });
    },
    createSubIssue: async () => {
      throw new Error("00-setup creates sub-issues through the agent, not the adapter");
    },
    getStateType: async (id) => {
      const seq = states[id] ?? ["completed"];
      const i = cursor[id] ?? 0;
      cursor[id] = i + 1;
      return seq[Math.min(i, seq.length - 1)];
    },
    listComments: async (): Promise<IssueComment[]> => [
      { body: "반려 사유: 재검토 필요", author: "po", createdAt: "2026-01-01T00:00:00Z" },
    ],
    setStateType: async (id, type) => {
      stateChanges.push({ id, type });
    },
    listRecentIssues: async () => {
      throw new Error("unused");
    },
    getTicket: async () => {
      throw new Error("unused");
    },
  };
  return { source, created, comments, stateChanges };
}

function makeConfig(repoPath: string, overrides: Partial<Config> = {}): Config {
  return {
    ticketSource: "linear",
    repoPath,
    port: 3939,
    e2eDriver: "ego-lite",
    demoAppUrl: "http://localhost:5173",
    useWorktree: true,
    autoTicketLabel: "sdlc-auto",
    maxAutoTicketDepth: 3,
    gateRoles: Object.fromEntries(STAGES.map((s) => [s, "Tester"])) as Record<StageId, string>,
    gatePollIntervalMs: 1,
    gateTimeoutMs: 5000,
    autoApprove: false,
    detectScript: "ops/detect.sh",
    detectMetric: "e2e_failure_rate",
    linear: { webhookSecret: "x", apiKey: "x", teamId: "x" },
    jira: { baseUrl: "", email: "", apiToken: "", projectKey: "", webhookSecret: "" },
    linearTrigger: "webhook",
    linearPollIntervalMs: 30_000,
    interviewMaxRounds: 5,
    reworkMaxAttempts: 3,
    slack: null,
    ...overrides,
  };
}

const TICKET: Ticket = {
  id: "t-1",
  key: "ENG-1",
  title: "빈 제목 할 일이 저장됨",
  body: "POST /todos 가 빈 title 을 저장한다",
  labels: [],
  url: "http://linear/ENG-1",
};

interface StubEnv {
  stubDir: string;
  logPath: string;
  intentPlanPath: string;
}

async function withStubs<T>(intentPlan: string[], fn: (env: StubEnv) => Promise<T>): Promise<T> {
  const stubDir = await mkdtemp(join(tmpdir(), "sdlc-interview-bin-"));
  await makeStubs(stubDir);
  const workRoot = await mkdtemp(join(tmpdir(), "sdlc-interview-work-"));
  const logPath = join(workRoot, "claude-calls.jsonl");
  const intentPlanPath = join(workRoot, "intent-plan.json");
  await writeFile(intentPlanPath, JSON.stringify(intentPlan));

  const prevPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${prevPath}`;
  process.env.STUB_LOG = logPath;
  process.env.STUB_INTENT_PLAN = intentPlanPath;
  try {
    return await fn({ stubDir, logPath, intentPlanPath });
  } finally {
    process.env.PATH = prevPath;
    delete process.env.STUB_LOG;
    delete process.env.STUB_INTENT_PLAN;
    delete process.env.STUB_CLAUDE_FAIL_ON;
  }
}

async function readLog(logPath: string): Promise<Array<{ argv: string[]; prompt: string }>> {
  const raw = await readFile(logPath, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function sessionIdOf(entry: { argv: string[] }): string | undefined {
  const i = entry.argv.indexOf("--session-id");
  return i === -1 ? undefined : entry.argv[i + 1];
}

function resumeIdOf(entry: { argv: string[] }): string | undefined {
  const i = entry.argv.indexOf("--resume");
  return i === -1 ? undefined : entry.argv[i + 1];
}

async function stageLog(runnerDir: string, key: string): Promise<Array<{ stage: string; ok: boolean; note?: string }>> {
  return JSON.parse(await readFile(join(runnerDir, ".state", `${key}.json`), "utf8"));
}

const TWO_QUESTIONS = "# stub intent\n\n## 미해결 질문\n1. 마감일은 언제인가?\n2. 담당자는 누구인가?\n";
const NO_QUESTIONS = "# stub intent\n\n## 미해결 질문\n없음\n";

/** Always answers with two fixed answers, once, then records how many times it was asked. */
function answerOnceChannel(): { channel: InterviewChannel; calls: Array<{ round: number; maxRounds: number; questions: string[] }> } {
  const calls: Array<{ round: number; maxRounds: number; questions: string[] }> = [];
  let asked = false;
  const channel: InterviewChannel = {
    async ask(_key, questions, round, maxRounds): Promise<InterviewOutcome> {
      calls.push({ round, maxRounds, questions });
      if (!asked) {
        asked = true;
        return { kind: "answers", answers: [{ user: "po", text: "다음 주 금요일" }, { user: "po", text: "김철수" }] };
      }
      return { kind: "proceed" };
    },
  };
  return { channel, calls };
}

/** Always answers with new (non-empty) answers, every round — used to hit the interviewMaxRounds cap. */
function alwaysAnswerChannel(): { channel: InterviewChannel; calls: number[] } {
  const calls: number[] = [];
  const channel: InterviewChannel = {
    async ask(_key, _questions, round): Promise<InterviewOutcome> {
      calls.push(round);
      return { kind: "answers", answers: [{ user: "po", text: `답 ${round}` }] };
    },
  };
  return { channel, calls };
}

function proceedImmediatelyChannel(): { channel: InterviewChannel; calls: number } {
  let calls = 0;
  const channel: InterviewChannel = {
    async ask(): Promise<InterviewOutcome> {
      calls++;
      return { kind: "proceed" };
    },
  };
  return { channel, get calls() { return calls; } };
}

// ── 01 interview loop ───────────────────────────────────────────────────────

test("interview: two questions answered resumes the same 01-intent session, then a 0-question parse proceeds to the 01-plan gate", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-interview-runner-"));
  const rec = recordingSource({});
  const { channel, calls } = answerOnceChannel();

  await withStubs([TWO_QUESTIONS, NO_QUESTIONS], async (env) => {
    await runPipeline(TICKET, makeConfig(repo), rec.source, runnerDir, undefined, channel);

    assert.equal(calls.length, 1, "interview.ask must be called exactly once (second parse has 0 questions)");
    assert.equal(calls[0].round, 1);
    assert.deepEqual(calls[0].questions, ["마감일은 언제인가?", "담당자는 누구인가?"]);

    const log = await readLog(env.logPath);
    const intentCalls = log.filter((e) => e.prompt.includes("sdlc-intent 스킬을 사용해"));
    assert.equal(intentCalls.length, 1, "initial 01-intent must run exactly once");
    const reviseCalls = log.filter((e) => e.prompt.includes("다음 답을 반영해"));
    assert.equal(reviseCalls.length, 1, "exactly one revise run after the single answered round");

    const firstSessionId = sessionIdOf(intentCalls[0]);
    assert.ok(firstSessionId, "the initial 01-intent call must carry --session-id");
    const reviseResumeId = resumeIdOf(reviseCalls[0]);
    assert.equal(reviseResumeId, firstSessionId, "the revise run must resume the exact session the initial 01-intent run used");

    assert.match(reviseCalls[0].prompt, /다음 답을 반영해/);
    assert.match(reviseCalls[0].prompt, /다음 주 금요일/);
    assert.match(reviseCalls[0].prompt, /김철수/);
  });

  const stages = await stageLog(runnerDir, "ENG-1");
  assert.ok(stages.find((s) => s.stage === "gate:01-plan"), "must have reached the 01-plan gate");
});

test("interview: the original ticket gets exactly one Q&A comment for the single answered round", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-interview-runner-"));
  const rec = recordingSource({});
  const { channel } = answerOnceChannel();

  await withStubs([TWO_QUESTIONS, NO_QUESTIONS], () => runPipeline(TICKET, makeConfig(repo), rec.source, runnerDir, undefined, channel));

  const ticketComments = rec.comments.filter((c) => c.id === TICKET.id);
  assert.equal(ticketComments.length, 1, "exactly one Q&A comment on the original ticket");
  assert.match(ticketComments[0].body, /다음 주 금요일/);
  assert.match(ticketComments[0].body, /김철수/);
});

test("interview: interviewMaxRounds caps asking at 5 rounds even when questions never run out", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-interview-runner-"));
  const rec = recordingSource({});
  const { channel, calls } = alwaysAnswerChannel();

  // Every queued content still has open questions, including after the 5th revise — the plan
  // clamps to its last entry once exhausted, and that last entry still has two open questions.
  await withStubs([TWO_QUESTIONS, TWO_QUESTIONS, TWO_QUESTIONS, TWO_QUESTIONS, TWO_QUESTIONS, TWO_QUESTIONS], () =>
    runPipeline(TICKET, makeConfig(repo), rec.source, runnerDir, undefined, channel),
  );

  assert.equal(calls.length, 5, "interview.ask must be called exactly 5 times (interviewMaxRounds), never a 6th");
  assert.deepEqual(calls, [1, 2, 3, 4, 5]);
});

test("interview: a 'proceed' outcome stops the loop without running a revise stage", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-interview-runner-"));
  const rec = recordingSource({});
  const proceedChannel = proceedImmediatelyChannel();

  await withStubs([TWO_QUESTIONS], async (env) => {
    await runPipeline(TICKET, makeConfig(repo), rec.source, runnerDir, undefined, proceedChannel.channel);
    assert.equal(proceedChannel.calls, 1, "asked exactly once before proceeding");
    const log = await readLog(env.logPath);
    const reviseCalls = log.filter((e) => e.prompt.includes("다음 답을 반영해"));
    assert.equal(reviseCalls.length, 0, "proceed must never trigger a revise run");
  });
});

// ── 01/02/03 rework loop ────────────────────────────────────────────────────

test("rework: a single 01-plan rejection reopens the gate as 'unstarted' with a 1/3 comment, reruns the interview, then a later approval lets 02 proceed", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-interview-runner-"));
  const rec = recordingSource({ "uuid-01-plan": ["canceled", "completed"] });
  const proceedChannel = proceedImmediatelyChannel();

  await withStubs([NO_QUESTIONS, NO_QUESTIONS], () => runPipeline(TICKET, makeConfig(repo), rec.source, runnerDir, undefined, proceedChannel.channel));

  const log = await stageLog(runnerDir, "ENG-1");
  assert.ok(log.find((e) => e.stage === "01-plan-rework"), "a rework stage for 01-plan must have run");
  assert.ok(log.find((e) => e.stage === "02-spec"), "02 must have run after the rework was approved");

  const unstartedCall = rec.stateChanges.find((c) => c.id === "uuid-01-plan" && c.type === "unstarted");
  assert.ok(unstartedCall, "the gate card must be moved back to unstarted for rework");

  const reworkComment = rec.comments.find((c) => c.id === "uuid-01-plan" && /재작업 1\/3/.test(c.body));
  assert.ok(reworkComment, "a '재작업 1/3' comment must be posted on the gate issue");
});

test("rework: 01-plan rejected through all reworkMaxAttempts aborts the pipeline", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-interview-runner-"));
  const rec = recordingSource({ "uuid-01-plan": ["canceled"] }); // clamped: every poll reports canceled
  const proceedChannel = proceedImmediatelyChannel();

  await withStubs([NO_QUESTIONS], () => runPipeline(TICKET, makeConfig(repo), rec.source, runnerDir, undefined, proceedChannel.channel));

  const log = await stageLog(runnerDir, "ENG-1");
  const reworkRuns = log.filter((e) => e.stage === "01-plan-rework");
  assert.equal(reworkRuns.length, 3, "exactly reworkMaxAttempts (3) rework attempts, then abort");
  assert.ok(!log.find((e) => e.stage === "02-spec"), "02 must never run once the pipeline aborts");

  const live = JSON.parse(await readFile(join(runnerDir, ".state", `${TICKET.key}.live.json`), "utf8")) as { phase: string };
  assert.equal(live.phase, "aborted");

  const reworkComments = rec.comments.filter((c) => c.id === "uuid-01-plan" && /재작업 \d\/3/.test(c.body));
  assert.equal(reworkComments.length, 3);
  assert.ok(reworkComments.some((c) => c.body.includes("재작업 3/3")));
});

test("rework: a rejected 04-test gate does not trigger any rework stage and still lets the run finish", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-interview-runner-"));
  const rec = recordingSource({ "uuid-04-test": ["canceled"] });
  const proceedChannel = proceedImmediatelyChannel();

  await withStubs([NO_QUESTIONS], () => runPipeline(TICKET, makeConfig(repo), rec.source, runnerDir, undefined, proceedChannel.channel));

  const log = await stageLog(runnerDir, "ENG-1");
  assert.ok(!log.find((e) => e.stage === "04-test-rework"), "04 rejections must never trigger a rework run");
  const gate04 = log.find((e) => e.stage === "gate:04-test");
  assert.equal(gate04?.ok, false);

  const live = JSON.parse(await readFile(join(runnerDir, ".state", `${TICKET.key}.live.json`), "utf8")) as { phase: string };
  assert.equal(live.phase, "done", "the pipeline still finishes normally after a 04-test rejection (no abort, no rework)");
});

// ── resume-failure fallback ──────────────────────────────────────────────────

test("resume failure: a failed revise run (ok:false, sessionJsonlPath:null) retries once in a fresh session", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-interview-runner-"));
  const rec = recordingSource({});
  const { channel } = answerOnceChannel();

  await withStubs([TWO_QUESTIONS, NO_QUESTIONS], async (env) => {
    process.env.STUB_CLAUDE_FAIL_ON = "다음 답을 반영해";
    await runPipeline(TICKET, makeConfig(repo), rec.source, runnerDir, undefined, channel);

    const log = await readLog(env.logPath);
    const reviseCalls = log.filter((e) => e.prompt.includes("다음 답을 반영해"));
    assert.equal(reviseCalls.length, 2, "one failed resume attempt plus one fresh-session retry");
    assert.ok(resumeIdOf(reviseCalls[0]), "the first attempt must have tried to resume");
    assert.ok(!resumeIdOf(reviseCalls[1]), "the fallback retry must be a fresh session, not a resume");
    assert.match(reviseCalls[1].prompt, /기존 산출물 전문/, "the fallback prompt embeds the existing artifact in full");
  });

  const stages = await stageLog(runnerDir, "ENG-1");
  assert.ok(stages.find((s) => s.stage === "gate:01-plan"), "the pipeline must still have reached the 01-plan gate despite the resume failure");
});
