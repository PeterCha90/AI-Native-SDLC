import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs, type RunStageOptions } from "../src/claude.ts";

const baseOpts: RunStageOptions = {
  prompt: "do the thing",
  cwd: "/tmp/repo",
};

test("buildClaudeArgs: without resumeSessionId, includes --session-id and not --resume", () => {
  const args = buildClaudeArgs(baseOpts, "generated-session-id");
  assert.ok(args.includes("--session-id"));
  assert.equal(args[args.indexOf("--session-id") + 1], "generated-session-id");
  assert.ok(!args.includes("--resume"));
});

test("buildClaudeArgs: with resumeSessionId, includes --resume <id> and not --session-id", () => {
  const args = buildClaudeArgs({ ...baseOpts, resumeSessionId: "resume-this-id" }, "generated-session-id");
  assert.ok(args.includes("--resume"));
  assert.equal(args[args.indexOf("--resume") + 1], "resume-this-id");
  assert.ok(!args.includes("--session-id"));
});

test("buildClaudeArgs: still includes the prompt and permission-mode regardless of resume", () => {
  const args = buildClaudeArgs({ ...baseOpts, resumeSessionId: "resume-this-id" }, "generated-session-id");
  assert.ok(args.includes("-p"));
  assert.equal(args[args.indexOf("-p") + 1], "do the thing");
  assert.ok(args.includes("--permission-mode"));
});
