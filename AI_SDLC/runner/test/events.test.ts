import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noopEvents, safeEvents, type PipelineEvents } from "../src/events.ts";
import { listActiveRuns, type LiveStatus, type RunMeta } from "../src/state.ts";
import { runPipeline } from "../src/pipeline.ts";
import { STAGES, type StageId } from "../src/gate.ts";
import type { Config } from "../src/config.ts";
import type { IssueComment, NewTicket, StateType, Ticket, TicketSource } from "../src/adapters/types.ts";

// ── safeEvents ────────────────────────────────────────────────────────────────

test("safeEvents: an inner handler that throws never rejects the call, and logs once", async () => {
  const logs: string[] = [];
  const inner: PipelineEvents = {
    ...noopEvents,
    stageStarted: async () => {
      throw new Error("notifier is down");
    },
  };
  const ev = safeEvents(inner, (m) => logs.push(m));

  await assert.doesNotReject(() => ev.stageStarted("K", "01-intent"));
  assert.equal(logs.length, 1, "the failure must be logged exactly once");
});

test("safeEvents: a handler that resolves normally is not logged", async () => {
  const logs: string[] = [];
  const calls: string[] = [];
  const inner: PipelineEvents = {
    ...noopEvents,
    runFinished: async (key, outcome) => {
      calls.push(`${key}:${outcome}`);
    },
  };
  const ev = safeEvents(inner, (m) => logs.push(m));

  await ev.runFinished("ENG-1", "done");
  assert.deepEqual(calls, ["ENG-1:done"]);
  assert.equal(logs.length, 0);
});

// ── listActiveRuns ───────────────────────────────────────────────────────────

function meta(key: string): RunMeta {
  const gateRoles = Object.fromEntries(STAGES.map((s) => [s, "Tester"])) as Record<StageId, string>;
  return {
    key,
    title: `title ${key}`,
    url: `http://x/${key}`,
    labels: [],
    depth: 0,
    autoApprove: false,
    startedAt: "2026-01-01T00:00:00.000Z",
    gateRoles,
  };
}

test("listActiveRuns: only running/waiting runs, tolerates a corrupt live.json, newest first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-state-"));

  await writeFile(join(dir, "A.meta.json"), JSON.stringify(meta("A")));
  const liveA: LiveStatus = { stage: "gate:01-plan", phase: "waiting", since: "2026-01-01T00:02:00.000Z" };
  await writeFile(join(dir, "A.live.json"), JSON.stringify(liveA));

  await writeFile(join(dir, "B.meta.json"), JSON.stringify(meta("B")));
  const liveB: LiveStatus = { stage: "06-maintain", phase: "done", since: "2026-01-01T00:05:00.000Z" };
  await writeFile(join(dir, "B.live.json"), JSON.stringify(liveB));

  await writeFile(join(dir, "C.meta.json"), JSON.stringify(meta("C")));
  await writeFile(join(dir, "C.live.json"), "{not valid json");

  const result = await listActiveRuns(dir);
  assert.deepEqual(result.map((r) => r.meta.key), ["A"]);
});

test("listActiveRuns: multiple active runs sort by live.since, most recent first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-state-"));

  await writeFile(join(dir, "OLD.meta.json"), JSON.stringify(meta("OLD")));
  await writeFile(
    join(dir, "OLD.live.json"),
    JSON.stringify({ stage: "01-intent", phase: "running", since: "2026-01-01T00:00:00.000Z" } satisfies LiveStatus),
  );

  await writeFile(join(dir, "NEW.meta.json"), JSON.stringify(meta("NEW")));
  await writeFile(
    join(dir, "NEW.live.json"),
    JSON.stringify({ stage: "gate:02-design", phase: "waiting", since: "2026-01-01T01:00:00.000Z" } satisfies LiveStatus),
  );

  const result = await listActiveRuns(dir);
  assert.deepEqual(result.map((r) => r.meta.key), ["NEW", "OLD"]);
});

test("listActiveRuns: a missing state dir returns an empty list rather than throwing", async () => {
  const result = await listActiveRuns(join(tmpdir(), "sdlc-state-does-not-exist-" + Date.now()));
  assert.deepEqual(result, []);
});

// ── pipeline event ordering (fake runner reused from pipeline-e2e.test.ts) ─────

const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe" });

/** Same stand-in for `claude -p` as pipeline-e2e.test.ts: writes whatever artifact path it finds in its own prompt. */
const CLAUDE_STUB = `#!/usr/bin/env python3
import os, re, sys, json
prompt = ""
argv = sys.argv[1:]
for i, a in enumerate(argv):
    if a == "-p" and i + 1 < len(argv):
        prompt = argv[i + 1]
for path in re.findall(r"/[\\w./-]+\\.(?:md|json)", prompt):
    if path.endswith(".gates.json"):
        stages = ["01-plan","02-design","03-build","04-test","05-deploy","06-maintain"]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({s: {"issueId": "uuid-" + s, "key": "GATE-" + s, "url": "http://x/" + s} for s in stages}, f)
    elif "/docs/" in path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.exists(path):
            open(path, "w").write("# stub artifact\\n\\n## 변경할 파일\\n- \`README.md\` (수정)\\n")
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
  const root = realpathSync(await mkdtemp(join(tmpdir(), "sdlc-events-repo-")));
  git(["init", "-q"], root);
  git(["config", "user.email", "t@t"], root);
  git(["config", "user.name", "t"], root);
  await writeFile(join(root, "README.md"), "demo\n");
  git(["add", "-A"], root);
  git(["commit", "-qm", "init"], root);
  return root;
}

function fakeSource(): TicketSource {
  return {
    name: "fake",
    verify: () => true,
    parse: () => null,
    createTicket: async (t: NewTicket): Promise<Ticket> => ({
      id: "new-id",
      key: "ENG-99",
      title: t.title,
      body: t.body,
      labels: t.labels ?? [],
      url: "http://x/ENG-99",
    }),
    comment: async () => {},
    createSubIssue: async () => {
      throw new Error("not used under autoApprove");
    },
    getStateType: async (): Promise<StateType> => "completed",
    listComments: async (): Promise<IssueComment[]> => [],
    setStateType: async () => {},
    listRecentIssues: async () => [],
    getTicket: async () => {
      throw new Error("not used under autoApprove");
    },
  };
}

function makeConfig(repoPath: string): Config {
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
    autoApprove: true,
    detectScript: "ops/detect.sh",
    detectMetric: "e2e_failure_rate",
    linear: { webhookSecret: "x", apiKey: "x", teamId: "x" },
    jira: { baseUrl: "", email: "", apiToken: "", projectKey: "", webhookSecret: "" },
    linearTrigger: "webhook",
    linearPollIntervalMs: 30_000,
    interviewMaxRounds: 5,
    reworkMaxAttempts: 3,
    slack: null,
  };
}

const TICKET: Ticket = {
  id: "t-1",
  key: "ENG-1",
  title: "이벤트 순서 테스트용 티켓",
  body: "이벤트가 올바른 순서로 발생하는지 확인한다",
  labels: [],
  url: "http://linear/ENG-1",
};

async function withStubs<T>(fn: () => Promise<T>): Promise<T> {
  const stubDir = await mkdtemp(join(tmpdir(), "sdlc-events-bin-"));
  await makeStubs(stubDir);
  const prevPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${prevPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = prevPath;
  }
}

/** Records every event call as "<name>:<key>:<stage-or-outcome>" in call order. */
function recordingEvents(): { events: PipelineEvents; calls: string[] } {
  const calls: string[] = [];
  const events: PipelineEvents = {
    runStarted: async (meta) => {
      calls.push(`runStarted:${meta.key}`);
    },
    stageStarted: async (key, stage) => {
      calls.push(`stageStarted:${stage}`);
    },
    stageFinished: async (key, stage) => {
      calls.push(`stageFinished:${stage}`);
    },
    gateWaiting: async (key, stage) => {
      calls.push(`gateWaiting:${stage}`);
    },
    gateResolved: async (key, stage) => {
      calls.push(`gateResolved:${stage}`);
    },
    followupCreated: async (key) => {
      calls.push(`followupCreated:${key}`);
    },
    runFinished: async (key, outcome) => {
      calls.push(`runFinished:${outcome}`);
    },
  };
  return { events, calls };
}

test("pipeline event order: starts with runStarted, ends with runFinished, each stageStarted immediately followed by its own stageFinished", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-events-runner-"));
  const { events, calls } = recordingEvents();

  await withStubs(() => runPipeline(TICKET, makeConfig(repo), fakeSource(), runnerDir, events));

  assert.ok(calls.length > 0, "at least some events must have fired");
  assert.equal(calls[0], "runStarted:ENG-1");
  assert.equal(calls[calls.length - 1], "runFinished:done");

  for (let i = 0; i < calls.length; i++) {
    if (!calls[i].startsWith("stageStarted:")) continue;
    const stage = calls[i].slice("stageStarted:".length);
    assert.equal(calls[i + 1], `stageFinished:${stage}`, `expected stageFinished:${stage} right after ${calls[i]}, got ${calls[i + 1]}`);
  }
});

/** Every method throws synchronously (well, rejects) — used to prove runPipeline wraps
 * whatever `events` it's given, rather than trusting the caller to have pre-wrapped it. */
function throwingEvents(): PipelineEvents {
  const boom = async (): Promise<void> => {
    throw new Error("notifier is down");
  };
  return {
    runStarted: boom,
    stageStarted: boom,
    stageFinished: boom,
    gateWaiting: boom,
    gateResolved: boom,
    followupCreated: boom,
    runFinished: boom,
  };
}

test("gated pipeline: still completes even when every events handler throws (runPipeline wraps events itself)", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-events-runner-"));
  const config: Config = { ...makeConfig(repo), autoApprove: false };

  // fakeSource().getStateType always reports "completed", so every gate is approved on the
  // first poll — this run exercises setupGates/gateWaiting/gateResolved, not just the
  // autoApprove short-circuit the other pipeline test takes.
  await withStubs(() => runPipeline(TICKET, config, fakeSource(), runnerDir, throwingEvents()));

  const live = JSON.parse(await readFile(join(runnerDir, ".state", `${TICKET.key}.live.json`), "utf8")) as { phase: string };
  assert.equal(live.phase, "done", "the run must reach normal completion despite every event handler throwing");

  const log = JSON.parse(await readFile(join(runnerDir, ".state", `${TICKET.key}.json`), "utf8")) as Array<{ stage: string; ok: boolean }>;
  const gate01 = log.find((e) => e.stage === "gate:01-plan");
  assert.equal(gate01?.ok, true, "the 01-plan gate must have been approved, not skipped, in this non-autoApprove run");
});

test("gated pipeline: gateWaiting for 01-plan fires before its gateResolved(approved=true)", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-events-runner-"));
  const config: Config = { ...makeConfig(repo), autoApprove: false };

  const calls: Array<{ name: string; stage?: string; approved?: boolean }> = [];
  const events: PipelineEvents = {
    ...noopEvents,
    gateWaiting: async (key, stage) => {
      calls.push({ name: "gateWaiting", stage });
    },
    gateResolved: async (key, stage, approved) => {
      calls.push({ name: "gateResolved", stage, approved });
    },
  };

  await withStubs(() => runPipeline(TICKET, config, fakeSource(), runnerDir, events));

  const waitingIdx = calls.findIndex((c) => c.name === "gateWaiting" && c.stage === "01-plan");
  const resolvedIdx = calls.findIndex((c) => c.name === "gateResolved" && c.stage === "01-plan" && c.approved === true);
  assert.notEqual(waitingIdx, -1, "gateWaiting for 01-plan must fire");
  assert.notEqual(resolvedIdx, -1, "gateResolved(01-plan, approved=true) must fire");
  assert.ok(waitingIdx < resolvedIdx, "gateWaiting must precede gateResolved for the same stage");
});
