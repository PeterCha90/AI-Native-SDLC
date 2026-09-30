import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli/args.ts";

test("parses init with repo and yes flag", () => {
  const result = parseArgs(["init", "--repo", "/x", "--yes"]);
  assert.deepEqual(result, { command: "init", repo: "/x", yes: true, open: false, skipChecks: false });
});

test("no args falls back to help", () => {
  const result = parseArgs([]);
  assert.deepEqual(result, { command: "help", yes: false, open: false, skipChecks: false });
});

test("unknown command falls back to help", () => {
  const result = parseArgs(["frobnicate"]);
  assert.equal(result.command, "help");
});

test("unknown option falls back to help", () => {
  const result = parseArgs(["start", "--bogus"]);
  assert.equal(result.command, "help");
});

test("--help flag alone is not a recognized command and falls back to help", () => {
  const result = parseArgs(["--help"]);
  assert.equal(result.command, "help");
});

test("parses start with skip-checks and repo", () => {
  const result = parseArgs(["start", "--skip-checks", "--repo", "/y"]);
  assert.equal(result.command, "start");
  assert.equal(result.skipChecks, true);
  assert.equal(result.repo, "/y");
});

test("parses manifest with open", () => {
  const result = parseArgs(["manifest", "--open"]);
  assert.equal(result.command, "manifest");
  assert.equal(result.open, true);
});

test("parses init non-interactive with channel and team", () => {
  const result = parseArgs(["init", "--yes", "--channel", "C0ABC123", "--team", "TEAM1"]);
  assert.equal(result.command, "init");
  assert.equal(result.yes, true);
  assert.equal(result.channel, "C0ABC123");
  assert.equal(result.team, "TEAM1");
});

test("parses home flag", () => {
  const result = parseArgs(["doctor", "--home", "/h"]);
  assert.equal(result.command, "doctor");
  assert.equal(result.home, "/h");
});

test("parses config command with no flags", () => {
  const result = parseArgs(["config"]);
  assert.deepEqual(result, { command: "config", yes: false, open: false, skipChecks: false });
});

test("explicit help command", () => {
  const result = parseArgs(["help"]);
  assert.equal(result.command, "help");
});
