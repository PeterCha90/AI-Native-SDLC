import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/pipeline.ts";
import { STAGES, gateMapPath, type StageId } from "../src/gate.ts";
import type { Config } from "../src/config.ts";
import { bundledPluginDir } from "../src/paths.ts";
import type { IssueComment, NewTicket, StateType, Ticket, TicketSource } from "../src/adapters/types.ts";

/**
 * Runs the real `runPipeline` end to end against stubbed external binaries and a fake ticket
 * source. This is the closest thing to the live demo that needs no Linear credentials: it proves
 * the approval gates actually block and resume, that a rejection stops the run, and that a 3σ
 * breach really does produce a follow-up ticket.
 */

const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe" });

/**
 * A stand-in for `claude -p`. It scans its own prompt for absolute paths and creates them, which
 * is enough to mimic the only side effect the pipeline depends on: a stage writing its artifact.
 */
const CLAUDE_STUB = `#!/usr/bin/env python3
import os, re, sys, json
prompt = ""
argv = sys.argv[1:]
for i, a in enumerate(argv):
    if a == "-p" and i + 1 < len(argv):
        prompt = argv[i + 1]
if os.environ.get("STUB_CLAUDE_FAIL_ON") and os.environ["STUB_CLAUDE_FAIL_ON"] in prompt:
    sys.stderr.write("stub claude: deliberate failure\\n")
    sys.exit(3)
for path in re.findall(r"/[\\w./-]+\\.(?:md|json)", prompt):
    if "/docs/" in path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.exists(path):
            open(path, "w").write("# stub artifact\\n\\n## 변경할 파일\\n- \`README.md\` (수정)\\n")
print("stub claude done")
`;

const okStub = (name: string) => `#!/bin/sh\necho "${name} stub ok"\nexit 0\n`;

async function makeStubs(dir: string, egoExit: number): Promise<void> {
  await mkdir(dir, { recursive: true });
  const files: Array<[string, string]> = [
    ["claude", CLAUDE_STUB],
    ["gh", okStub("gh")],
    ["ego-browser", `#!/bin/sh\ncat >/dev/null\necho "ego stub"\nexit ${egoExit}\n`],
  ];
  for (const [name, body] of files) {
    const p = join(dir, name);
    await writeFile(p, body);
    await chmod(p, 0o755);
  }
}

async function makeRepo(): Promise<string> {
  const root = realpathSync(await mkdtemp(join(tmpdir(), "sdlc-e2e-")));
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
  polled: string[];
  /** Every `createSubIssue` call, in call order, with the stage parsed from its title and when it happened. */
  subIssuesCreated: Array<{ stage: string; at: string }>;
}

/** `states` maps a gate issueId to the verdict sequence it should report. */
function recordingSource(states: Record<string, StateType[]>): Recorder {
  const created: NewTicket[] = [];
  const comments: Array<{ id: string; body: string }> = [];
  const polled: string[] = [];
  const subIssuesCreated: Array<{ stage: string; at: string }> = [];
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
    // Gates are created lazily, one at a time, through the adapter — never by an agent session.
    createSubIssue: async (_parentId, t) => {
      const stage = t.title.match(/\[gate\]\s+(\S+)/)?.[1] ?? "unknown";
      subIssuesCreated.push({ stage, at: new Date().toISOString() });
      return { id: `uuid-${stage}`, key: `GATE-${stage}`, title: t.title, body: t.body, labels: t.labels ?? [], url: `http://x/${stage}` };
    },
    getStateType: async (id) => {
      polled.push(id);
      const seq = states[id] ?? ["completed"];
      const i = cursor[id] ?? 0;
      cursor[id] = i + 1;
      return seq[Math.min(i, seq.length - 1)];
    },
    listComments: async (): Promise<IssueComment[]> => [
      { body: "영향 범위가 틀렸다", author: "po", createdAt: "2026-01-01T00:00:00Z" },
    ],
    setStateType: async () => {
      throw new Error("unused");
    },
    listRecentIssues: async () => {
      throw new Error("unused");
    },
    getTicket: async () => {
      throw new Error("unused");
    },
  };
  return { source, created, comments, polled, subIssuesCreated };
}

function makeConfig(repoPath: string, runnerDir: string): Config {
  return {
    ticketSource: "linear",
    repoPath,
    baseDir: runnerDir,
    pluginDir: bundledPluginDir(),
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
    catchUpHours: 24,
    slack: null,
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

async function withStubs<T>(egoExit: number, fn: () => Promise<T>): Promise<T> {
  const stubDir = await mkdtemp(join(tmpdir(), "sdlc-bin-"));
  await makeStubs(stubDir, egoExit);
  const prevPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${prevPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = prevPath;
    delete process.env.STUB_CLAUDE_FAIL_ON;
  }
}

async function stageLog(
  runnerDir: string,
  key: string,
): Promise<Array<{ stage: string; ok: boolean; note?: string; startedAt: string; endedAt: string }>> {
  return JSON.parse(await readFile(join(runnerDir, ".state", `${key}.json`), "utf8"));
}

test("all six gates approved: the pipeline runs every stage and writes its artifacts into one checkout", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const rec = recordingSource({});

  await withStubs(0, () => runPipeline(TICKET, makeConfig(repo, runnerDir), rec.source, runnerDir));

  const log = await stageLog(runnerDir, "ENG-1");
  const stages = log.map((e) => e.stage);
  assert.ok(!stages.includes("00-setup"), "there is no 00-setup stage any more — gates are created lazily by the adapter");
  for (const expected of ["01-intent", "02-spec", "03-plan", "03-build", "04-test", "05-deploy"]) {
    assert.ok(stages.includes(expected), `expected stage ${expected} to run, got ${stages.join(", ")}`);
  }
  // Every gate was consulted, and each recorded an approval.
  for (const s of STAGES) {
    const entry = log.find((e) => e.stage === `gate:${s}`);
    assert.ok(entry, `gate ${s} never ran`);
    assert.equal(entry.ok, true, `gate ${s} should have been approved`);
  }
  // Exactly one sub-issue per stage — never six up front.
  assert.deepEqual(rec.subIssuesCreated.map((c) => c.stage), [...STAGES], "createSubIssue must be called exactly once per stage, in stage order");

  // The whole point of the workDir fix: docs live in the same checkout the build stages ran in,
  // which is where the hooks look for them.
  const workDir = join(runnerDir, ".worktrees", "ENG-1");
  assert.ok(existsSync(join(workDir, "docs", "intent", "ENG-1.md")), "intent.md must be in the worktree");
  assert.ok(existsSync(join(workDir, "docs", "spec", "ENG-1.md")), "spec.md must be in the worktree");
  assert.ok(existsSync(join(workDir, "docs", "plan", "ENG-1.md")), "plan.md must be in the worktree");
});

test("the gate comment posted on Linear carries the full artifact content and only repo-relative paths, never the absolute worktree path", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const rec = recordingSource({});

  await withStubs(0, () => runPipeline(TICKET, makeConfig(repo, runnerDir), rec.source, runnerDir));

  const workDir = join(runnerDir, ".worktrees", "ENG-1");
  const planComment = rec.comments.find((c) => c.id === "uuid-01-plan");
  assert.ok(planComment, "expected a comment on the 01-plan gate sub-issue");
  // The stub writes this exact artifact body — the comment must carry it verbatim, not just a
  // pointer to the file.
  assert.match(planComment!.body, /변경할 파일/, "the full intent.md content must be in the Linear comment");
  assert.match(planComment!.body, /docs\/intent\/ENG-1\.md/, "the artifact path shown must be repo-relative");
  assert.ok(!planComment!.body.includes(workDir), "the absolute worktree path must never be shown to a human");
  assert.ok(!planComment!.body.includes(runnerDir), "no absolute runner-dir path either");

  for (const c of rec.comments) {
    assert.ok(!c.body.includes(workDir), `comment on ${c.id} must not leak the absolute worktree path`);
  }
});

test("gate sub-issues are created one at a time, in stage order, each only after the stage it gates has already finished running", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const rec = recordingSource({});

  await withStubs(0, () => runPipeline(TICKET, makeConfig(repo, runnerDir), rec.source, runnerDir));

  const log = await stageLog(runnerDir, "ENG-1");
  assert.equal(rec.subIssuesCreated.length, STAGES.length, "exactly six sub-issues, never more");
  assert.deepEqual(rec.subIssuesCreated.map((c) => c.stage), [...STAGES]);

  // Map each gate stage to the producing stage whose own log entry must already exist by the time
  // that gate's sub-issue is created (interleaving, not "all six up front").
  const producerOf: Record<string, string> = {
    "01-plan": "01-intent",
    "02-design": "02-spec",
    "03-build": "03-plan", // the 03-build gate approves the PLAN, before 03-build (code) itself runs
    "04-test": "04-test",
    "05-deploy": "05-deploy",
    "06-maintain": "06-maintain",
  };
  for (const created of rec.subIssuesCreated) {
    const producerStage = producerOf[created.stage];
    const producerEntry = log.find((e) => e.stage === producerStage);
    assert.ok(producerEntry, `expected a "${producerStage}" log entry before the "${created.stage}" gate card was created`);
    assert.ok(
      producerEntry.endedAt <= created.at,
      `"${producerStage}" must finish before its gate card ("${created.stage}") is created — ended ${producerEntry.endedAt}, created ${created.at}`,
    );
  }
  // And specifically: the 03-build gate card is created right after 03-plan, before 03-build (the
  // CODE stage) itself ever runs — the card gates entry into that stage, not a review of its output.
  const cardFor03At = rec.subIssuesCreated.find((c) => c.stage === "03-build")!.at;
  const build03Entry = log.find((e) => e.stage === "03-build");
  assert.ok(build03Entry, "03-build must still have run (after the gate approved)");
  assert.ok(cardFor03At <= build03Entry!.startedAt, "the 03-build gate card must be created before 03-build (the code stage) starts");
});

test("restart with a partial gates.json reuses existing entries and creates only the missing ones", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const rec = recordingSource({});

  await mkdir(join(runnerDir, ".state"), { recursive: true });
  // Only 01-plan and 02-design already have cards (as if the run was interrupted after 02) — the
  // rest must be created lazily as the run reaches them.
  const partialMap = {
    "01-plan": { issueId: "existing-01-plan", key: "PRE-01-plan", url: "http://pre/01-plan" },
    "02-design": { issueId: "existing-02-design", key: "PRE-02-design", url: "http://pre/02-design" },
  };
  await writeFile(gateMapPath(runnerDir, "ENG-1"), JSON.stringify(partialMap), "utf8");

  await withStubs(0, () => runPipeline(TICKET, makeConfig(repo, runnerDir), rec.source, runnerDir));

  // Only the four missing stages went through createSubIssue — the pre-existing two were reused.
  assert.deepEqual(
    rec.subIssuesCreated.map((c) => c.stage),
    ["03-build", "04-test", "05-deploy", "06-maintain"],
  );

  const mapAfter = JSON.parse(await readFile(gateMapPath(runnerDir, "ENG-1"), "utf8"));
  assert.equal(mapAfter["01-plan"].url, "http://pre/01-plan", "the pre-existing entry must be reused, not recreated");
  assert.equal(mapAfter["02-design"].url, "http://pre/02-design", "the pre-existing entry must be reused, not recreated");
  assert.equal(mapAfter["03-build"].url, "http://x/03-build", "the missing entry must have been created");
  assert.equal(Object.keys(mapAfter).length, STAGES.length, "the map must be complete by the end of a full run");

  // The run still completed using a mix of the reused and newly created issue ids.
  const log = await stageLog(runnerDir, "ENG-1");
  for (const s of STAGES) {
    const entry = log.find((e) => e.stage === `gate:${s}`);
    assert.ok(entry, `gate ${s} never ran`);
    assert.equal(entry.ok, true, `gate ${s} should have been approved`);
  }
});

test("createSubIssue failure aborts the run loudly instead of proceeding ungated", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const rec = recordingSource({});
  const failingSource: TicketSource = {
    ...rec.source,
    createSubIssue: async () => {
      throw new Error("Linear API unreachable");
    },
  };

  const events: { aborted: boolean } = { aborted: false };
  await withStubs(0, () =>
    runPipeline(TICKET, makeConfig(repo, runnerDir), failingSource, runnerDir, {
      runStarted: async () => {},
      stageStarted: async () => {},
      stageFinished: async () => {},
      gateWaiting: async () => {},
      gateResolved: async () => {},
      followupCreated: async () => {},
      runFinished: async (_key, outcome) => {
        if (outcome === "aborted") events.aborted = true;
      },
    }),
  );

  assert.equal(events.aborted, true, "runFinished(\"aborted\") must fire when a gate sub-issue can't be created");

  const log = await stageLog(runnerDir, "ENG-1");
  assert.ok(!log.some((e) => e.stage === "02-spec"), "no later stage may run once the first gate fails to open");

  const live = JSON.parse(await readFile(join(runnerDir, ".state", `${TICKET.key}.live.json`), "utf8")) as { phase: string };
  assert.equal(live.phase, "aborted");

  const abortComment = rec.comments.find((c) => c.id === TICKET.id && /게이트 하위 이슈 생성 실패/.test(c.body));
  assert.ok(abortComment, "a best-effort comment explaining the abort must be posted on the original ticket");
});

test("a rejected 02 Design gate stops the pipeline before any code is touched", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const rec = recordingSource({ "uuid-02-design": ["canceled"] });

  await withStubs(0, () => runPipeline(TICKET, makeConfig(repo, runnerDir), rec.source, runnerDir));

  const log = await stageLog(runnerDir, "ENG-1");
  const stages = log.map((e) => e.stage);
  assert.ok(stages.includes("02-spec"), "02 should have run");
  assert.ok(!stages.includes("03-plan"), "03 must not run after a rejected 02 gate");
  assert.ok(!stages.includes("03-build"), "no code stage may run after a rejection");

  const rejected = log.find((e) => e.stage === "gate:02-design");
  assert.equal(rejected?.ok, false);
  assert.match(rejected?.note ?? "", /영향 범위가 틀렸다/, "the human's comment becomes the recorded reason");
});

test("a 3σ breach closes the loop by opening a follow-up ticket even when the agent stage fails", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const rec = recordingSource({});

  // e2e fails -> pipeline not ok -> no detect.sh in this repo -> tier falls back to 3.
  // Then force the sdlc-maintain agent session itself to fail.
  await withStubs(1, async () => {
    process.env.STUB_CLAUDE_FAIL_ON = "sdlc-maintain";
    await runPipeline(TICKET, makeConfig(repo, runnerDir), rec.source, runnerDir);
  });

  assert.equal(rec.created.length, 1, "the runner must open the ticket the agent failed to create");
  const t = rec.created[0];
  assert.match(t.title, /\[auto\] fix:/);
  assert.deepEqual(t.labels, ["sdlc-auto"]);
  assert.match(t.body, /sdlc-depth: 1/, "depth must increment so the loop guard can see it");

  const log = await stageLog(runnerDir, "ENG-1");
  const maintain = log.find((e) => e.stage === "06-maintain");
  assert.match(maintain?.note ?? "", /러너가 대신 후속 티켓 ENG-99/);
});

test("an auto ticket at the depth limit escalates to a human instead of looping again", async () => {
  const repo = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const rec = recordingSource({});
  const deep: Ticket = { ...TICKET, labels: ["sdlc-auto"], body: "sdlc-depth: 3" };

  await withStubs(1, () => runPipeline(deep, makeConfig(repo, runnerDir), rec.source, runnerDir));

  assert.equal(rec.created.length, 0, "no ticket may be created past the depth limit");
  const escalation = rec.comments.find((c) => /깊이 상한/.test(c.body));
  assert.ok(escalation, "the causing ticket must get an escalation comment");
});
