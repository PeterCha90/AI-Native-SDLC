import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDepth, parseTier, shouldCreateFollowupTicket } from "../src/pipeline.ts";
import type { Ticket } from "../src/adapters/types.ts";

function ticket(overrides: Partial<Ticket>): Ticket {
  return { id: "1", key: "ENG-1", title: "t", body: "", labels: [], url: "", ...overrides };
}

test("extractDepth defaults to 0 when there's no marker", () => {
  assert.equal(extractDepth({ body: "just a normal ticket" }), 0);
});

test("extractDepth reads the embedded sdlc-depth marker", () => {
  assert.equal(extractDepth({ body: "failure log\n\nsdlc-depth: 2\n" }), 2);
});

test("shouldCreateFollowupTicket: human tickets (no auto label) are never blocked", () => {
  const t = ticket({ labels: [], body: "sdlc-depth: 99" });
  assert.equal(shouldCreateFollowupTicket(t, "sdlc-auto", 3), true);
});

test("shouldCreateFollowupTicket: auto tickets below the depth limit may create another", () => {
  const t = ticket({ labels: ["sdlc-auto"], body: "sdlc-depth: 1" });
  assert.equal(shouldCreateFollowupTicket(t, "sdlc-auto", 3), true);
});

test("parseTier reads the tier the detection script printed", () => {
  assert.equal(parseTier("e2e_failure_rate 1.0 (3.3σ)\ntier=3 action=act\n"), 3);
  assert.equal(parseTier("tier=0 action=none"), 0);
});

test("parseTier returns null when the script printed nothing usable, so the caller can fall back", () => {
  assert.equal(parseTier(""), null);
  assert.equal(parseTier("bash: ops/detect.sh: No such file or directory"), null);
});

test("shouldCreateFollowupTicket: auto tickets at or past the depth limit are blocked", () => {
  const atLimit = ticket({ labels: ["sdlc-auto"], body: "sdlc-depth: 3" });
  assert.equal(shouldCreateFollowupTicket(atLimit, "sdlc-auto", 3), false);

  const pastLimit = ticket({ labels: ["sdlc-auto"], body: "sdlc-depth: 5" });
  assert.equal(shouldCreateFollowupTicket(pastLimit, "sdlc-auto", 3), false);
});
