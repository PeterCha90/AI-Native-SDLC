import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { awaitApproval, classifyState, parseGateMap, readGateMap, STAGES, type GateRef } from "../src/gate.ts";
import type { IssueComment, StateType, TicketSource } from "../src/adapters/types.ts";

const GATE: GateRef = { issueId: "uuid-1", key: "ENG-43", url: "https://linear.app/x/issue/ENG-43" };

function fullGateMapJson(): string {
  const map: Record<string, unknown> = {};
  for (const stage of STAGES) map[stage] = { issueId: `uuid-${stage}`, key: stage, url: "" };
  return JSON.stringify(map);
}

/** A TicketSource that only implements what the gate actually calls. */
function fakeSource(states: StateType[], comments: IssueComment[] = []): TicketSource & { commented: string[] } {
  const commented: string[] = [];
  let i = 0;
  return {
    commented,
    name: "fake",
    verify: () => true,
    parse: () => null,
    createTicket: async () => {
      throw new Error("unused");
    },
    comment: async (_id, body) => {
      commented.push(body);
    },
    createSubIssue: async () => {
      throw new Error("unused");
    },
    getStateType: async () => states[Math.min(i++, states.length - 1)],
    listComments: async () => comments,
  };
}

const noSleep = async () => {};
const noLog = () => {};

test("classifyState maps Linear workflow state types onto gate verdicts", () => {
  assert.equal(classifyState("completed"), "approved");
  assert.equal(classifyState("canceled"), "rejected");
  for (const pending of ["triage", "backlog", "unstarted", "started"] as StateType[]) {
    assert.equal(classifyState(pending), "pending");
  }
});

test("parseGateMap accepts a complete map and normalises missing key/url", () => {
  const map = parseGateMap(fullGateMapJson());
  assert.equal(map["01-plan"].issueId, "uuid-01-plan");
  assert.equal(Object.keys(map).length, STAGES.length);
});

test("parseGateMap rejects a map that is missing a stage", () => {
  const partial = JSON.stringify({ "01-plan": { issueId: "a" } });
  assert.throws(() => parseGateMap(partial), /missing an entry for stage "02-design"/);
});

test("parseGateMap rejects an entry with no issueId", () => {
  const bad = JSON.parse(fullGateMapJson());
  bad["04-test"] = { key: "ENG-46" };
  assert.throws(() => parseGateMap(JSON.stringify(bad)), /"04-test" has no issueId/);
});

test("parseGateMap rejects malformed JSON rather than returning an empty map", () => {
  assert.throws(() => parseGateMap("{nope"), /not valid JSON/);
});

test("readGateMap refuses to run ungated when 00-setup produced no map", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-gate-"));
  await assert.rejects(readGateMap(dir, "ENG-1"), /Refusing to run the pipeline ungated/);
});

test("readGateMap loads the map 00-setup wrote", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-gate-"));
  await mkdir(join(dir, ".state"), { recursive: true });
  await writeFile(join(dir, ".state", "ENG-1.gates.json"), fullGateMapJson());
  const map = await readGateMap(dir, "ENG-1");
  assert.equal(map["06-maintain"].issueId, "uuid-06-maintain");
});

test("awaitApproval waits through pending states and returns approved on Done", async () => {
  const source = fakeSource(["unstarted", "started", "completed"]);
  const result = await awaitApproval({
    source,
    gate: GATE,
    stage: "01-plan",
    role: "Product Owner",
    summary: "intent.md 준비됨",
    pollIntervalMs: 1,
    timeoutMs: 1000,
    autoApprove: false,
    sleep: noSleep,
    log: noLog,
  });
  assert.equal(result.approved, true);
  assert.equal(result.autoApproved, false);
  assert.deepEqual(source.commented, ["intent.md 준비됨"]);
});

test("awaitApproval returns rejected with the latest comment as the reason", async () => {
  const source = fakeSource(["canceled"], [
    { body: "첫 코멘트", author: "a", createdAt: "1" },
    { body: "영향 범위가 틀렸다", author: "b", createdAt: "2" },
  ]);
  const result = await awaitApproval({
    source,
    gate: GATE,
    stage: "02-design",
    role: "Product Owner",
    summary: "spec.md 준비됨",
    pollIntervalMs: 1,
    timeoutMs: 1000,
    autoApprove: false,
    sleep: noSleep,
    log: noLog,
  });
  assert.equal(result.approved, false);
  assert.equal(result.reason, "영향 범위가 틀렸다");
});

test("awaitApproval times out rather than blocking forever", async () => {
  const source = fakeSource(["started"]);
  const result = await awaitApproval({
    source,
    gate: GATE,
    stage: "05-deploy",
    role: "Release Manager",
    summary: "PR 준비됨",
    pollIntervalMs: 1,
    timeoutMs: 5,
    autoApprove: false,
    sleep: noSleep,
    log: noLog,
  });
  assert.equal(result.approved, false);
  assert.match(result.reason ?? "", /초과/);
});

test("awaitApproval keeps polling when the state lookup throws, instead of reading it as a rejection", async () => {
  let calls = 0;
  const source = fakeSource(["completed"]);
  const flaky: TicketSource = {
    ...source,
    getStateType: async () => {
      calls += 1;
      if (calls < 3) throw new Error("network blip");
      return "completed";
    },
  };
  const result = await awaitApproval({
    source: flaky,
    gate: GATE,
    stage: "04-test",
    role: "Code Owner",
    summary: "테스트 결과",
    pollIntervalMs: 1,
    timeoutMs: 1000,
    autoApprove: false,
    sleep: noSleep,
    log: noLog,
  });
  assert.equal(result.approved, true);
  assert.equal(calls, 3);
});

test("awaitApproval under SDLC_AUTO_APPROVE never touches the ticket source", async () => {
  const source = fakeSource(["canceled"]);
  const result = await awaitApproval({
    source,
    gate: GATE,
    stage: "03-build",
    role: "Engineer",
    summary: "plan.md 준비됨",
    pollIntervalMs: 1,
    timeoutMs: 1000,
    autoApprove: true,
    sleep: noSleep,
    log: noLog,
  });
  assert.equal(result.approved, true);
  assert.equal(result.autoApproved, true);
  assert.deepEqual(source.commented, []);
});
