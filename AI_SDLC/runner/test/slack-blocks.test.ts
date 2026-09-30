import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS,
  REJECT_MODAL,
  stageLabel,
  ticketNotice,
  stageLine,
  gateMessage,
  rejectModal,
  followupLine,
  runFinishedLine,
  type ActionValue,
} from "../src/slack/blocks.ts";

function findActionsBlock(blocks: unknown[]): any {
  return blocks.find((b: any) => b.type === "actions");
}

function findSectionBlocks(blocks: unknown[]): any[] {
  return blocks.filter((b: any) => b.type === "section");
}

const TICKET = {
  key: "ENG-12",
  title: "할 일 제목",
  url: "https://linear.app/x/issue/ENG-12",
  creator: "alice",
  labels: [] as string[],
  ticketId: "uuid-12",
};

test("stageLabel maps known stage/gate ids to column labels, falls back to original", () => {
  assert.equal(stageLabel("01-intent"), "01 Plan");
  assert.equal(stageLabel("03-build"), "03 Build");
  assert.equal(stageLabel("gate:04-test"), "04 Test");
  assert.equal(stageLabel("00-setup"), "00 Setup");
  assert.equal(stageLabel("02-spec"), "02 Design");
  assert.equal(stageLabel("04-test-loop"), "04 Test");
  assert.equal(stageLabel("05-review"), "05 Deploy");
  assert.equal(stageLabel("06-maintain-diagnose"), "06 Maintain");
  assert.equal(stageLabel("gate:06-maintain"), "06 Maintain");
  assert.equal(stageLabel("nonsense"), "nonsense");
});

test("ticketNotice state:new has start/ignore actions with parseable value", () => {
  const msg = ticketNotice(TICKET, { state: "new" });
  const actions = findActionsBlock(msg.blocks);
  assert.ok(actions, "expected an actions block");
  const actionIds = actions.elements.map((e: any) => e.action_id);
  assert.deepEqual(actionIds, [ACTIONS.start, ACTIONS.ignore]);
  for (const el of actions.elements) {
    const parsed: ActionValue = JSON.parse(el.value);
    assert.equal(parsed.key, TICKET.key);
    assert.equal(parsed.ticketId, TICKET.ticketId);
  }
});

test("ticketNotice state:started has no actions block", () => {
  const msg = ticketNotice(TICKET, { state: "started", by: "U123" });
  assert.equal(findActionsBlock(msg.blocks), undefined);
  assert.match(msg.text + JSON.stringify(msg.blocks), /U123/);
});

test("ticketNotice state:auto has no actions block", () => {
  const msg = ticketNotice(TICKET, { state: "auto" });
  assert.equal(findActionsBlock(msg.blocks), undefined);
});

test("ticketNotice state:ignored has no actions block", () => {
  const msg = ticketNotice(TICKET, { state: "ignored", by: "U999" });
  assert.equal(findActionsBlock(msg.blocks), undefined);
});

test("ticketNotice notes sdlc-auto origin when parentKey given", () => {
  const msg = ticketNotice({ ...TICKET, labels: ["sdlc-auto"] }, { state: "new", parentKey: "ENG-9" });
  assert.match(msg.text, /ENG-9/);
});

test("gateMessage waiting with roleGroupId mentions the subteam", () => {
  const msg = gateMessage({
    key: "ENG-12",
    ticketId: "uuid-12",
    stage: "01-plan",
    role: "Product Owner",
    roleGroupId: "S1",
    summary: "요약",
    gateUrl: "https://linear.app/x/issue/ENG-12-gate",
    state: "waiting",
  });
  assert.match(msg.text, /<!subteam\^S1>/);
  const actions = findActionsBlock(msg.blocks);
  assert.ok(actions);
  const actionIds = actions.elements.map((e: any) => e.action_id);
  assert.deepEqual(actionIds, [ACTIONS.approve, ACTIONS.reject]);
  for (const el of actions.elements) {
    const parsed: ActionValue = JSON.parse(el.value);
    assert.equal(parsed.stage, "01-plan");
  }
});

test("gateMessage waiting without roleGroupId falls back to role name", () => {
  const msg = gateMessage({
    key: "ENG-12",
    ticketId: "uuid-12",
    stage: "01-plan",
    role: "Product Owner",
    summary: "요약",
    gateUrl: "https://linear.app/x/issue/ENG-12-gate",
    state: "waiting",
  });
  assert.match(msg.text, /Product Owner/);
});

test("gateMessage truncates a very long summary to fit the section limit", () => {
  const longSummary = "x".repeat(3000);
  const msg = gateMessage({
    key: "ENG-12",
    ticketId: "uuid-12",
    stage: "04-test",
    role: "Engineer",
    summary: longSummary,
    gateUrl: "https://linear.app/x/issue/ENG-12-gate",
    state: "waiting",
  });
  const sections = findSectionBlocks(msg.blocks);
  const summarySection = sections.find((s: any) => s.text.text.startsWith("x"));
  assert.ok(summarySection, "expected a section containing the summary");
  assert.ok(summarySection.text.text.length <= 3000);
});

test("gateMessage approved shows who approved, or Linear when resolved there", () => {
  const byUser = gateMessage({
    key: "ENG-12",
    ticketId: "uuid-12",
    stage: "01-plan",
    role: "Engineer",
    summary: "s",
    gateUrl: "u",
    state: "approved",
    by: "U1",
  });
  assert.match(byUser.text, /<@U1>/);
  assert.match(byUser.text, /승인/);

  const byLinear = gateMessage({
    key: "ENG-12",
    ticketId: "uuid-12",
    stage: "01-plan",
    role: "Engineer",
    summary: "s",
    gateUrl: "u",
    state: "approved",
    by: "Linear",
  });
  assert.match(byLinear.text, /Linear/);
  assert.match(byLinear.text, /승인/);
});

test("ticketNotice escapes mrkdwn special characters in title and creator", () => {
  const msg = ticketNotice(
    {
      ...TICKET,
      title: "Fix A<B & C>D",
      creator: "<http://evil.example/|steal>",
    },
    { state: "new" },
  );
  assert.match(msg.text, /Fix A&lt;B &amp; C&gt;D/);
  assert.match(msg.text, /&lt;http:\/\/evil\.example\/\|steal&gt;/);
  // The forged link markup must not survive as raw Slack link syntax (our own
  // legitimate ticket link also starts with "<http", so check for the payload itself).
  assert.ok(!msg.text.includes("<http://evil"), "raw <http://evil from user input must not survive");
  // Our own generated ticket link must remain intact and unescaped.
  assert.match(msg.text, new RegExp(`<${TICKET.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|${TICKET.key}>`));
});

test("gateMessage escapes mrkdwn special characters in role and summary, and truncation still holds after escaping", () => {
  const withRole = gateMessage({
    key: "ENG-12",
    ticketId: "uuid-12",
    stage: "01-plan",
    role: "<http://evil.example/|Product Owner>",
    summary: "s",
    gateUrl: "u",
    state: "waiting",
  });
  assert.match(withRole.text, /&lt;http:\/\/evil\.example\/\|Product Owner&gt;/);
  assert.ok(!withRole.text.includes("<http://evil"));

  // A summary made entirely of escapable characters expands when escaped (each "<"
  // becomes "&lt;", 4x longer); the final section text must still be <= 3000.
  const escapableSummary = "<".repeat(3000);
  const msg = gateMessage({
    key: "ENG-12",
    ticketId: "uuid-12",
    stage: "04-test",
    role: "Engineer",
    summary: escapableSummary,
    gateUrl: "u",
    state: "waiting",
  });
  const sections = findSectionBlocks(msg.blocks);
  const summarySection = sections.find((s: any) => s.text.text.startsWith("&lt;"));
  assert.ok(summarySection, "expected an escaped summary section");
  assert.ok(summarySection.text.text.length <= 3000);
  assert.ok(!summarySection.text.text.includes("<"), "raw '<' from summary must not survive escaping");
});

test("gateMessage rejected with no reason renders a placeholder instead of a trailing space", () => {
  const msg = gateMessage({
    key: "ENG-12",
    ticketId: "uuid-12",
    stage: "01-plan",
    role: "Engineer",
    summary: "s",
    gateUrl: "u",
    state: "rejected",
  });
  assert.equal(msg.text, "⛔ 반려: (사유 없음)");
});

test("gateMessage rejected reason is escaped", () => {
  const msg = gateMessage({
    key: "ENG-12",
    ticketId: "uuid-12",
    stage: "01-plan",
    role: "Engineer",
    summary: "s",
    gateUrl: "u",
    state: "rejected",
    reason: "<script>&</script>",
  });
  assert.match(msg.text, /&lt;script&gt;&amp;&lt;\/script&gt;/);
  assert.ok(!msg.text.includes("<script"));
});

test("gateMessage rejected includes the reason", () => {
  const msg = gateMessage({
    key: "ENG-12",
    ticketId: "uuid-12",
    stage: "01-plan",
    role: "Engineer",
    summary: "s",
    gateUrl: "u",
    state: "rejected",
    reason: "타입 에러 있음",
  });
  assert.match(msg.text, /반려/);
  assert.match(msg.text, /타입 에러 있음/);
});

test("gateMessage resolved states have no action buttons", () => {
  for (const state of ["approved", "rejected", "timeout"] as const) {
    const msg = gateMessage({
      key: "ENG-12",
      ticketId: "uuid-12",
      stage: "01-plan",
      role: "Engineer",
      summary: "s",
      gateUrl: "u",
      state,
      by: "U1",
      reason: "r",
    });
    assert.equal(findActionsBlock(msg.blocks), undefined, `state ${state} should have no actions`);
  }
});

test("rejectModal uses REJECT_MODAL callback_id and embeds the action value", () => {
  const v: ActionValue = { key: "ENG-12", ticketId: "uuid-12", stage: "01-plan" };
  const modal: any = rejectModal(v);
  assert.equal(modal.callback_id, REJECT_MODAL);
  assert.deepEqual(JSON.parse(modal.private_metadata), v);
  const reasonBlock = modal.blocks.find((b: any) => b.block_id === "reason");
  assert.ok(reasonBlock, "expected a block_id:reason input block");
  assert.equal(reasonBlock.element.action_id, "reason");
});

test("followupLine references the followup ticket", () => {
  const msg = followupLine({ key: "ENG-20", url: "https://linear.app/x/issue/ENG-20" });
  assert.match(msg.text, /ENG-20/);
});

test("runFinishedLine differs for done vs aborted", () => {
  const done = runFinishedLine("done");
  const aborted = runFinishedLine("aborted");
  assert.notEqual(done.text, aborted.text);
});

test("stageLine reflects status and optional duration/note", () => {
  const running = stageLine("01-plan", "running");
  assert.match(running.text, /01 Plan/);
  const ok = stageLine("01-plan", "ok", 4 * 60_000);
  assert.match(ok.text, /완료/);
  const failed = stageLine("01-plan", "failed", undefined, "타입 에러");
  assert.match(failed.text, /타입 에러/);
});
