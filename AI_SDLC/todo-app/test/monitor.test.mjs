// 모니터 판정 흐름을 실제 detect.sh 와 임시 로그 파일로 확인한다.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "todo-monitor-"));
process.env.ACCESS_LOG = join(dir, "access.jsonl");
process.env.MONITOR_STATE = join(dir, "state.json");
process.env.MONITOR_OUTBOX = join(dir, "outbox");

const { evaluate, createOutboxSink, createLinearSink, settings } = await import("../ops/monitor.mjs");
const { buildTriagePrompt, triageWithClaude, commentWithClaude, claudeSettings } = await import("../ops/claude-triage.mjs");

/** 클로드를 부르지 않는 기존(틀 티켓) 경로. */
const noClaude = { enabled: false };

const NOW = Date.parse("2026-10-01T03:00:00Z");

function writeLog(statuses, { ageMs = 10_000 } = {}) {
  const lines = statuses.map((status, i) =>
    JSON.stringify({
      ts: new Date(NOW - ageMs + i).toISOString(),
      method: status >= 500 ? "GET" : status >= 400 ? "POST" : "GET",
      path: "/api/todos",
      route: "/api/todos",
      status,
      ms: 1,
      ...(status >= 400 ? { error: status >= 500 ? "upstream DB timeout" : "title 이 비어 있다" } : {}),
    }),
  );
  writeFileSync(process.env.ACCESS_LOG, lines.join("\n") + "\n");
}

/** 호출을 기록만 하는 가짜 싱크. */
function fakeSink() {
  const calls = { create: [], comment: [] };
  return {
    name: "fake",
    calls,
    async create(t) {
      calls.create.push(t);
      return { id: `id-${calls.create.length}`, key: `ENG-${calls.create.length}`, url: `https://linear.app/x/ENG-${calls.create.length}` };
    },
    async comment(incident, body) {
      calls.comment.push({ incident, body });
    },
  };
}

const repeat = (status, n) => Array(n).fill(status);

beforeEach(() => {
  settings.minRequests = 10;
  settings.windowSec = 120;
});
afterEach(() => {
  rmSync(process.env.ACCESS_LOG, { force: true });
  rmSync(process.env.MONITOR_STATE, { force: true });
  rmSync(process.env.MONITOR_OUTBOX, { recursive: true, force: true });
});

test("표본이 최소 요청 수보다 적으면 판정하지 않는다", async () => {
  writeLog([500, 500, 200]);
  const sink = fakeSink();
  const state = await evaluate({ sink, triage: noClaude, now: NOW });
  assert.equal(sink.calls.create.length, 0);
  assert.equal(state.lastRun.results.api_5xx_rate.tier, null);
});

test("5xx 가 3σ 를 넘으면 sdlc-auto 티켓을 하나 열고, 계속돼도 중복으로 열지 않는다", async () => {
  writeLog([...repeat(200, 14), ...repeat(500, 6)]); // 30%
  const sink = fakeSink();

  const first = await evaluate({ sink, triage: noClaude, now: NOW });
  assert.equal(first.lastRun.results.api_5xx_rate.tier, 3);
  assert.equal(sink.calls.create.length, 1);
  const ticket = sink.calls.create[0];
  assert.match(ticket.title, /5xx 에러율 30\.0%/);
  assert.deepEqual(ticket.labels, ["sdlc-auto", "incident"]);
  assert.match(ticket.body, /sdlc-depth: 1/);
  assert.match(ticket.body, /upstream DB timeout/);
  assert.match(ticket.body, /tier=3 action=act/);
  assert.equal(first.incidents.api_5xx_rate.key, "ENG-1");

  const second = await evaluate({ sink, triage: noClaude, now: NOW + 15_000 });
  assert.equal(sink.calls.create.length, 1, "같은 사건으로 두 번째 티켓을 만들면 안 된다");
  assert.match(second.lastRun.results.api_5xx_rate.note, /이미 열린 사건 ENG-1/);
});

test("지표가 정상으로 돌아오면 회복 코멘트를 달고 사건을 닫는다", async () => {
  writeLog([...repeat(200, 14), ...repeat(500, 6)]);
  const sink = fakeSink();
  await evaluate({ sink, triage: noClaude, now: NOW });

  writeLog(repeat(200, 20));
  const state = await evaluate({ sink, triage: noClaude, now: NOW + 30_000 });
  assert.equal(sink.calls.comment.length, 1);
  assert.equal(sink.calls.comment[0].incident.key, "ENG-1");
  assert.match(sink.calls.comment[0].body, /회복/);
  assert.equal(state.incidents.api_5xx_rate, undefined);
  assert.equal(state.history[0].key, "ENG-1");
});

test("4xx 폭증도 별도 지표로 티켓을 연다", async () => {
  writeLog([...repeat(200, 15), ...repeat(400, 5)]); // 25%
  const sink = fakeSink();
  const state = await evaluate({ sink, triage: noClaude, now: NOW });
  assert.equal(state.lastRun.results.api_4xx_rate.tier, 3);
  assert.equal(state.lastRun.results.api_5xx_rate.tier, 0);
  assert.equal(sink.calls.create.length, 1);
  assert.match(sink.calls.create[0].title, /4xx 에러율 25\.0%/);
});

test("2σ 구간은 진단 대상으로만 표시하고 티켓을 만들지 않는다", async () => {
  writeLog([...repeat(200, 48), ...repeat(500, 2)]); // 4% = 2σ
  const sink = fakeSink();
  const state = await evaluate({ sink, triage: noClaude, now: NOW });
  assert.equal(state.lastRun.results.api_5xx_rate.tier, 2);
  assert.equal(sink.calls.create.length, 0);
});

test("창 밖의 오래된 에러는 세지 않는다", async () => {
  writeLog([...repeat(200, 14), ...repeat(500, 6)], { ageMs: 10 * 60_000 });
  const sink = fakeSink();
  const state = await evaluate({ sink, triage: noClaude, now: NOW });
  assert.equal(state.lastRun.total, 0);
  assert.equal(sink.calls.create.length, 0);
});

test("드라이런 싱크는 outbox 에 티켓 초안을 쓰고 회복 코멘트를 덧붙인다", async () => {
  writeLog([...repeat(200, 14), ...repeat(500, 6)]);
  const sink = createOutboxSink(process.env.MONITOR_OUTBOX);
  await evaluate({ sink, triage: noClaude, now: NOW });
  writeLog(repeat(200, 20));
  await evaluate({ sink, triage: noClaude, now: NOW + 30_000 });

  const files = readdirSync(process.env.MONITOR_OUTBOX);
  assert.equal(files.length, 1);
  const md = readFileSync(join(process.env.MONITOR_OUTBOX, files[0]), "utf8");
  assert.match(md, /^# \[장애\] 5xx 에러율/);
  assert.match(md, /라벨: sdlc-auto, incident/);
  assert.match(md, /회복/);
});

test("Linear 싱크는 없는 라벨을 만들고 팀·라벨을 붙여 이슈를 연다", async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const { query, variables } = JSON.parse(raw);
    requests.push({ auth: req.headers.authorization, query, variables });
    let data;
    if (query.includes("issueLabels")) data = { issueLabels: { nodes: [{ id: "L-auto", name: "sdlc-auto" }] } };
    else if (query.includes("issueLabelCreate")) data = { issueLabelCreate: { success: true, issueLabel: { id: "L-incident" } } };
    else if (query.includes("issueCreate")) data = { issueCreate: { success: true, issue: { id: "I-1", identifier: "FAS-42", url: "https://linear.app/t/FAS-42" } } };
    else if (query.includes("commentCreate")) data = { commentCreate: { success: true } };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data }));
  });
  await new Promise((r) => server.listen(0, r));
  const endpoint = `http://localhost:${server.address().port}/graphql`;

  try {
    const sink = createLinearSink({ apiKey: "lin_api_test", teamId: "team-1", endpoint });
    const ticket = await sink.create({ title: "t", body: "b\n\nsdlc-depth: 1", labels: ["sdlc-auto", "incident"] });
    assert.deepEqual(ticket, { id: "I-1", key: "FAS-42", url: "https://linear.app/t/FAS-42" });
    await sink.comment(ticket, "회복");

    assert.ok(requests.every((r) => r.auth === "lin_api_test"));
    const create = requests.find((r) => r.query.includes("issueCreate"));
    assert.deepEqual(create.variables.input, { teamId: "team-1", title: "t", description: "b\n\nsdlc-depth: 1", labelIds: ["L-auto", "L-incident"] });
    const labelCreate = requests.find((r) => r.query.includes("issueLabelCreate"));
    assert.deepEqual(labelCreate.variables.input, { name: "incident", teamId: "team-1" });
    const comment = requests.find((r) => r.query.includes("commentCreate"));
    assert.equal(comment.variables.input.issueId, "I-1");
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// 3σ 에서 클로드에게 맡기는 경로
// ---------------------------------------------------------------------------

/** 클로드 세션을 흉내 낸다. run 의 결과를 테스트가 정한다. */
function fakeTriage(result, { useLinear = true } = {}) {
  const calls = { run: [], comment: [] };
  return {
    enabled: true,
    useLinear,
    teamId: "team-1",
    calls,
    async run(input) {
      calls.run.push(input);
      return result;
    },
    async comment(key, body) {
      calls.comment.push({ key, body });
      return { ok: true };
    },
  };
}

const claudeCreated = {
  ok: true,
  costUsd: 0.12,
  output: {
    action: "created",
    ticketKey: "FAS-7",
    ticketUrl: "https://linear.app/t/FAS-7",
    title: "[장애] GET /api/todos 500 — DB 커넥션 풀 고갈",
    rootCause: "chaos 모드가 DB 타임아웃 예외를 던진다",
    intentPath: "docs/intent/INC-x.md",
    ticketBody: "...",
  },
};

test("3σ 면 클로드에게 진단과 티켓을 맡기고, 모니터는 직접 티켓을 만들지 않는다", async () => {
  writeLog([...repeat(200, 14), ...repeat(500, 6)]);
  const sink = fakeSink();
  const triage = fakeTriage(claudeCreated);

  const state = await evaluate({ sink, triage, now: NOW });
  assert.equal(sink.calls.create.length, 0);
  assert.equal(triage.calls.run.length, 1);
  const input = triage.calls.run[0];
  assert.equal(input.metric, "api_5xx_rate");
  assert.equal(input.depth, 1);
  assert.equal(input.teamId, "team-1");
  assert.match(input.incidentId, /^INC-20261001T030000-api_5xx_rate$/);

  const incident = state.incidents.api_5xx_rate;
  assert.equal(incident.key, "FAS-7");
  assert.equal(incident.via, "claude");
  assert.equal(incident.rootCause, "chaos 모드가 DB 타임아웃 예외를 던진다");

  // 계속 3σ 여도 클로드를 다시 부르지 않는다.
  await evaluate({ sink, triage, now: NOW + 15_000 });
  assert.equal(triage.calls.run.length, 1);

  // 회복 코멘트도 클로드(MCP)로 단다. 모니터에는 Linear 키가 없다.
  writeLog(repeat(200, 20));
  await evaluate({ sink, triage, now: NOW + 30_000 });
  assert.equal(triage.calls.comment.length, 1);
  assert.equal(triage.calls.comment[0].key, "FAS-7");
  assert.equal(sink.calls.comment.length, 0);
});

test("클로드 세션이 실패하면 틀 티켓으로 대신 연다", async () => {
  writeLog([...repeat(200, 14), ...repeat(500, 6)]);
  const sink = fakeSink();
  const triage = fakeTriage({ ok: false, error: "timeout" });

  const state = await evaluate({ sink, triage, now: NOW });
  assert.equal(sink.calls.create.length, 1);
  assert.equal(state.incidents.api_5xx_rate.via, "fake");
  assert.equal(state.incidents.api_5xx_rate.key, "ENG-1");
});

test("드라이런이면 클로드가 쓴 제목·본문을 outbox 에 남긴다", async () => {
  writeLog([...repeat(200, 14), ...repeat(500, 6)]);
  const triage = fakeTriage(
    { ok: true, output: { ...claudeCreated.output, action: "drafted", ticketKey: "", ticketUrl: "", ticketBody: "진단 본문\n\nsdlc-depth: 1" } },
    { useLinear: false },
  );
  const state = await evaluate({ sink: fakeSink(), triage, now: NOW });
  assert.equal(state.incidents.api_5xx_rate.via, "dry-run");
  const [file] = readdirSync(process.env.MONITOR_OUTBOX);
  const md = readFileSync(join(process.env.MONITOR_OUTBOX, file), "utf8");
  assert.match(md, /DB 커넥션 풀 고갈/);
  assert.match(md, /진단 본문/);
});

test("프롬프트는 판정을 다시 하지 말라고 하고, Linear 모드에서만 티켓 생성을 지시한다", () => {
  const summary = { total: 20, rates: { api_5xx_rate: { count: 6, rate: 0.3 } }, topErrors: [{ status: 500, method: "GET", route: "/api/todos", error: "DB timeout", count: 6 }] };
  const base = { metric: "api_5xx_rate", rate: 0.3, summary, detectOutput: "tier=3 action=act", now: NOW, incidentId: "INC-1", depth: 1, labels: ["sdlc-auto", "incident"], teamId: "team-1" };

  const linear = buildTriagePrompt({ ...base, useLinear: true });
  assert.match(linear, /sdlc-maintain/);
  assert.match(linear, /장애 여부를 다시 판단하지 마라/);
  assert.match(linear, /500 GET \/api\/todos — DB timeout/);
  assert.match(linear, /docs\/intent\/INC-1\.md/);
  assert.match(linear, /팀 id team-1/);
  assert.match(linear, /"sdlc-auto", "incident"/);
  assert.match(linear, /sdlc-depth: 1/);

  const dry = buildTriagePrompt({ ...base, useLinear: false });
  assert.match(dry, /드라이런/);
  assert.doesNotMatch(dry, /새 이슈를 만든다/);
});

test("클로드는 읽기 도구와 docs/intent 쓰기, 허용된 Linear 도구만 받는다", async () => {
  // 받은 인자를 그대로 structured_output 으로 돌려주는 가짜 claude.
  const bin = join(dir, "fake-claude.mjs");
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nconsole.log(JSON.stringify({ is_error: false, total_cost_usd: 0.01, structured_output: { args: process.argv.slice(2), cwd: process.cwd() } }));\n`,
    { mode: 0o755 },
  );
  const prev = claudeSettings.bin;
  claudeSettings.bin = bin;
  try {
    const summary = { total: 20, rates: { api_5xx_rate: { count: 6, rate: 0.3 } }, topErrors: [] };
    const res = await triageWithClaude({ metric: "api_5xx_rate", rate: 0.3, summary, detectOutput: "", now: NOW, incidentId: "INC-1", depth: 1, labels: ["sdlc-auto"], teamId: "t", useLinear: true });
    assert.equal(res.ok, true);
    const args = res.output.args;
    const flag = (name) => args[args.indexOf(name) + 1];
    assert.equal(flag("--permission-mode"), "dontAsk");
    assert.equal(flag("--tools"), "Read Glob Grep Skill Write");
    const allowed = flag("--allowedTools").split(" ");
    assert.ok(allowed.includes("Edit(docs/intent/**)"));
    assert.ok(!allowed.includes("Write"), "Write 는 docs/intent 로만 제한돼야 한다");
    assert.ok(!allowed.some((t) => t.startsWith("Bash")));
    assert.ok(allowed.includes("mcp__linear__save_issue"));
    assert.ok(!allowed.some((t) => t.includes("delete")));
    assert.match(flag("--plugin-dir"), /AI_SDLC\/plugin$/);
    assert.match(res.output.cwd, /todo-app$/);

    const dry = await triageWithClaude({ metric: "api_5xx_rate", rate: 0.3, summary, detectOutput: "", now: NOW, incidentId: "INC-1", depth: 1, labels: [], teamId: "t", useLinear: false });
    const dryAllowed = dry.output.args[dry.output.args.indexOf("--allowedTools") + 1];
    assert.doesNotMatch(dryAllowed, /mcp__linear/, "드라이런은 Linear 도구를 받지 않는다");

    const c = await commentWithClaude("FAS-7", "회복");
    assert.equal(c.output.args[c.output.args.indexOf("--allowedTools") + 1], "mcp__linear__save_comment mcp__linear__get_issue");
  } finally {
    claudeSettings.bin = prev;
  }
});
