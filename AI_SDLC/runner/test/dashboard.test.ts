import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { buildRun, loadRuns, stageColumn, type GateMapLite, type LiveStatus, type RunMeta, type StageLogEntry } from "../src/dashboard.ts";
import { STAGES, type StageId } from "../src/gate.ts";
import { createDashboardServer } from "../src/dashboard-server.ts";

function gateRoles(): Record<StageId, string> {
  return {
    "01-plan": "Product Owner",
    "02-design": "Product Owner",
    "03-build": "Engineer",
    "04-test": "Code Owner",
    "05-deploy": "Release Manager",
    "06-maintain": "Service Owner",
  };
}

function meta(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    key: "ENG-42",
    title: "빈 제목 할 일이 저장됨",
    url: "https://linear.app/x/issue/ENG-42",
    labels: [],
    depth: 0,
    autoApprove: false,
    startedAt: "2026-01-01T00:00:00.000Z",
    gateRoles: gateRoles(),
    ...overrides,
  };
}

function fullGateMap(): GateMapLite {
  const map = {} as GateMapLite;
  for (const s of STAGES) map[s] = { key: `GATE-${s}`, url: `http://x/${s}` };
  return map;
}

async function writeState(dir: string, key: string, files: { meta?: unknown; log?: unknown; gates?: unknown; live?: unknown }): Promise<void> {
  await mkdir(dir, { recursive: true });
  if (files.meta !== undefined) await writeFile(join(dir, `${key}.meta.json`), JSON.stringify(files.meta));
  if (files.log !== undefined) await writeFile(join(dir, `${key}.json`), JSON.stringify(files.log));
  if (files.gates !== undefined) await writeFile(join(dir, `${key}.gates.json`), JSON.stringify(files.gates));
  if (files.live !== undefined) await writeFile(join(dir, `${key}.live.json`), JSON.stringify(files.live));
}

test("stageColumn maps stage-log names and gate entries onto the right dashboard column", () => {
  assert.equal(stageColumn("00-setup"), "00");
  assert.equal(stageColumn("01-intent"), "01");
  assert.equal(stageColumn("02-spec"), "02");
  assert.equal(stageColumn("03-plan"), "03");
  assert.equal(stageColumn("03-build"), "03");
  assert.equal(stageColumn("04-test-loop"), "04");
  assert.equal(stageColumn("04-test"), "04");
  assert.equal(stageColumn("05-review"), "05");
  assert.equal(stageColumn("05-deploy"), "05");
  assert.equal(stageColumn("06-maintain"), "06");
  assert.equal(stageColumn("06-maintain-diagnose"), "06");
  assert.equal(stageColumn("06-maintain-act"), "06");
  assert.equal(stageColumn("gate:01-plan"), "01");
  assert.equal(stageColumn("gate:06-maintain"), "06");
  assert.equal(stageColumn("nonsense"), null);
});

test("buildRun: completed stages become 완료 steps and approved gates become 승인 chips", () => {
  const log: StageLogEntry[] = [
    { stage: "01-intent", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:01:00Z", ok: true, sessionJsonlPath: "/x/a.jsonl" },
    { stage: "gate:01-plan", startedAt: "2026-01-01T00:02:00Z", endedAt: "2026-01-01T00:02:00Z", ok: true, sessionJsonlPath: null, note: "Product Owner 승인" },
  ];
  const run = buildRun("ENG-42", meta(), log, fullGateMap(), null);

  const col01 = run.columns.find((c) => c.id === "01")!;
  assert.equal(col01.steps.length, 1);
  assert.equal(col01.steps[0].status, "완료");
  assert.equal(col01.steps[0].durationMs, 60_000);
  assert.equal(col01.gate?.verdict, "승인");
  assert.equal(col01.gate?.role, "Product Owner");
  assert.equal(col01.gate?.url, "http://x/01-plan");
});

test("buildRun: a rejected gate becomes 반려 and carries the rejection reason", () => {
  const log: StageLogEntry[] = [
    { stage: "02-spec", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:01:00Z", ok: true, sessionJsonlPath: null },
    { stage: "gate:02-design", startedAt: "2026-01-01T00:02:00Z", endedAt: "2026-01-01T00:02:00Z", ok: false, sessionJsonlPath: null, note: "중단: 영향 범위가 틀렸다" },
  ];
  const run = buildRun("ENG-42", meta(), log, fullGateMap(), null);
  const col02 = run.columns.find((c) => c.id === "02")!;
  assert.equal(col02.gate?.verdict, "반려");
  assert.match(col02.gate?.note ?? "", /영향 범위가 틀렸다/);
});

test("buildRun: the live stage lights up its column as active and shows a running step", () => {
  const live: LiveStatus = { stage: "03-build", phase: "running", since: "2026-01-01T00:05:00Z" };
  const run = buildRun("ENG-42", meta(), [], fullGateMap(), live);
  const col03 = run.columns.find((c) => c.id === "03")!;
  assert.equal(col03.active, true);
  assert.equal(col03.steps.length, 1);
  assert.equal(col03.steps[0].status, "실행 중");
  const others = run.columns.filter((c) => c.id !== "03");
  assert.ok(others.every((c) => c.active === false));
});

test("buildRun: a waiting gate shows 승인 대기 with the role and gate url from live.json", () => {
  const live: LiveStatus = { stage: "gate:04-test", phase: "waiting", role: "Code Owner", gateUrl: "http://x/04-test", since: "2026-01-01T00:05:00Z" };
  const log: StageLogEntry[] = [{ stage: "04-test-loop", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:04:00Z", ok: true, sessionJsonlPath: null }];
  const run = buildRun("ENG-42", meta(), log, fullGateMap(), live);
  const col04 = run.columns.find((c) => c.id === "04")!;
  assert.equal(col04.gate?.verdict, "승인 대기");
  assert.equal(col04.gate?.role, "Code Owner");
  assert.equal(col04.active, true);
});

test("buildRun: autoApprove marks every column that has run as 자동 승인, with no gate log entries", () => {
  const log: StageLogEntry[] = [{ stage: "01-intent", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:01:00Z", ok: true, sessionJsonlPath: null }];
  const run = buildRun("ENG-1", meta({ key: "ENG-1", autoApprove: true }), log, null, null);
  const col01 = run.columns.find((c) => c.id === "01")!;
  assert.equal(col01.gate?.verdict, "자동 승인");
  const col02 = run.columns.find((c) => c.id === "02")!;
  assert.equal(col02.gate, null, "a column that never ran gets no gate chip, even under autoApprove");
});

test("buildRun: extracts the follow-up ticket the runner's fallback path created", () => {
  const log: StageLogEntry[] = [
    {
      stage: "06-maintain",
      startedAt: "2026-01-01T00:00:00Z",
      endedAt: "2026-01-01T00:00:00Z",
      ok: false,
      sessionJsonlPath: null,
      note: "tier=3 — sdlc-maintain 세션 실패(exit 3). 러너가 대신 후속 티켓 ENG-49 (http://x/ENG-49) 을 생성했다.",
    },
  ];
  const run = buildRun("ENG-42", meta({ depth: 0 }), log, null, null);
  assert.deepEqual(run.followup, { key: "ENG-49", url: "http://x/ENG-49", depth: 1 });
});

test("buildRun: extracts a parent-less follow-up depth from the agent-authored note when no key is known", () => {
  const log: StageLogEntry[] = [
    {
      stage: "06-maintain",
      startedAt: "2026-01-01T00:00:00Z",
      endedAt: "2026-01-01T00:00:00Z",
      ok: false,
      sessionJsonlPath: null,
      note: "tier=3 — sdlc-maintain 이 intent 문서와 후속 Linear 티켓(depth 2)을 생성했다. 루프가 01 로 돌아간다.",
    },
  ];
  const run = buildRun("ENG-42", meta(), log, null, null);
  // No key was ever reported by this path — the dashboard has nothing to link to, so no followup.
  assert.equal(run.followup, null);
});

test("loadRuns: reads every *.meta.json in the state dir, newest run first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-dash-"));
  await writeState(dir, "ENG-1", { meta: meta({ key: "ENG-1", startedAt: "2026-01-01T00:00:00Z" }) });
  await writeState(dir, "ENG-2", { meta: meta({ key: "ENG-2", startedAt: "2026-02-01T00:00:00Z" }) });

  const runs = await loadRuns(dir);
  assert.deepEqual(runs.map((r) => r.key), ["ENG-2", "ENG-1"]);
});

test("loadRuns: a run with no stage log, gate map or live status yet still renders (00-setup in flight)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-dash-"));
  await writeState(dir, "ENG-3", { meta: meta({ key: "ENG-3" }) });
  const runs = await loadRuns(dir);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].columns.length, 7);
});

test("loadRuns: tolerates a corrupt companion file instead of crashing the whole listing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-dash-"));
  await writeState(dir, "ENG-4", { meta: meta({ key: "ENG-4" }) });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ENG-4.json"), "{not json");
  await writeFile(join(dir, "ENG-4.gates.json"), "{not json either");
  await writeFile(join(dir, "ENG-4.live.json"), "");

  const runs = await loadRuns(dir);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].key, "ENG-4");
});

test("loadRuns: a corrupt meta.json for one run does not hide the others", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-dash-"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ENG-5.meta.json"), "{broken");
  await writeState(dir, "ENG-6", { meta: meta({ key: "ENG-6" }) });

  const runs = await loadRuns(dir);
  assert.deepEqual(runs.map((r) => r.key), ["ENG-6"]);
});

test("loadRuns: a missing state directory returns an empty list rather than throwing", async () => {
  const runs = await loadRuns(join(tmpdir(), "sdlc-dash-does-not-exist-" + Date.now()));
  assert.deepEqual(runs, []);
});

function listen(server: http.Server): Promise<number> {
  return new Promise((resolvePromise) => {
    server.listen(0, () => {
      const address = server.address();
      resolvePromise(typeof address === "object" && address ? address.port : 0);
    });
  });
}

test("dashboard HTTP server: GET / returns the page and GET /api/runs returns JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-dash-http-"));
  await writeState(dir, "ENG-7", { meta: meta({ key: "ENG-7" }) });

  const server = createDashboardServer(dir);
  const port = await listen(server);
  try {
    const indexRes = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(indexRes.status, 200);
    assert.match(indexRes.headers.get("content-type") ?? "", /text\/html/);
    const html = await indexRes.text();
    assert.match(html, /AI-SDLC/);

    const apiRes = await fetch(`http://127.0.0.1:${port}/api/runs`);
    assert.equal(apiRes.status, 200);
    assert.match(apiRes.headers.get("content-type") ?? "", /application\/json/);
    const body = (await apiRes.json()) as Array<{ key: string }>;
    assert.deepEqual(body.map((r) => r.key), ["ENG-7"]);
  } finally {
    server.close();
  }
});
