import { test } from "node:test";
import assert from "node:assert/strict";
import { runDoctor, formatChecks, type Check, type DoctorDeps } from "../src/cli/doctor.ts";
import type { Verifier } from "../src/cli/verify.ts";

function fakeVerifier(overrides: Partial<Verifier> = {}): Verifier {
  return {
    slackBot: async () => ({ ok: true, team: "Acme", botName: "bot", botUserId: "U1" }),
    slackApp: async () => ({ ok: true }),
    postTest: async () => ({ ok: true }),
    userGroups: async () => [],
    linear: async () => ({ ok: true, viewer: "v", teams: [] }),
    ...overrides,
  };
}

function creds(overrides: Partial<DoctorDeps["credentials"]> = {}): DoctorDeps["credentials"] {
  return { slackBotToken: "xoxb-a", slackAppToken: "xapp-a", linearApiKey: "lin_api_a", linearWebhookSecret: "", ...overrides };
}

function greenExec(overrides: Record<string, { code: number; stdout: string; stderr: string }> = {}) {
  return async (cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    const key = `${cmd} ${args.join(" ")}`;
    for (const [k, v] of Object.entries(overrides)) {
      if (key.startsWith(k)) return v;
    }
    if (cmd === "claude" && args[0] === "--version") return { code: 0, stdout: "1.0.0", stderr: "" };
    if (cmd === "claude" && args[0] === "auth") return { code: 0, stdout: "logged in", stderr: "" };
    if (cmd === "claude" && args[0] === "mcp") return { code: 0, stdout: "linear\ngithub", stderr: "" };
    if (cmd === "git") return { code: 0, stdout: "true", stderr: "" };
    if (cmd === "ego-lite") return { code: 0, stdout: "1.0.0", stderr: "" };
    return { code: 1, stdout: "", stderr: "unhandled" };
  };
}

test("claude not installed is a blocking failure", async () => {
  const exec = greenExec({ "claude --version": { code: 127, stdout: "", stderr: "command not found" } });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "Claude Code 설치");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, true);
});

test("claude not logged in is a blocking failure", async () => {
  const exec = greenExec({ "claude auth": { code: 1, stdout: "", stderr: "not logged in" } });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "Claude Code 로그인");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, true);
});

test("missing linear in mcp list is a blocking failure", async () => {
  const exec = greenExec({ "claude mcp": { code: 0, stdout: "github\nfilesystem", stderr: "" } });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "Linear MCP 연결");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, true);
});

test("ego-browser missing is a non-blocking warning", async () => {
  const exec = greenExec({ "ego-lite": { code: 127, stdout: "", stderr: "not found" } });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "ego-browser 준비");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, false);
});

test("invalid slack bot token is blocking only when slack is configured", async () => {
  const exec = greenExec();
  const verifier = fakeVerifier({ slackBot: async () => ({ ok: false, error: "invalid_auth" }) });

  const withSlack = await runDoctor({
    exec,
    verifier,
    repoRoot: null,
    config: { slack: { channelId: "C1" } } as any,
    credentials: creds(),
  });
  const withSlackCheck = withSlack.find((c) => c.name === "Slack 봇 토큰");
  assert.ok(withSlackCheck);
  assert.equal(withSlackCheck!.blocking, true);

  const withoutSlack = await runDoctor({ exec, verifier, repoRoot: null, config: null, credentials: creds() });
  const withoutSlackCheck = withoutSlack.find((c) => c.name === "Slack 봇 토큰");
  assert.ok(withoutSlackCheck);
  assert.equal(withoutSlackCheck!.blocking, false);
});

test("missing linear api key is always blocking", async () => {
  const exec = greenExec();
  const checks = await runDoctor({
    exec,
    verifier: fakeVerifier(),
    repoRoot: null,
    config: null,
    credentials: creds({ linearApiKey: "" }),
  });
  const check = checks.find((c) => c.name === "Linear API 키");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, true);
});

test("formatChecks renders a table with status marks", () => {
  const checks: Check[] = [
    { name: "A", ok: true, detail: "fine", blocking: false },
    { name: "B", ok: false, detail: "broken", blocking: true },
    { name: "C", ok: false, detail: "meh", blocking: false },
  ];
  const table = formatChecks(checks);
  assert.match(table, /✅ A/);
  assert.match(table, /❌ B/);
  assert.match(table, /⚠️ C/);
});

test("everything green produces no blocking failures", async () => {
  const exec = greenExec();
  const checks = await runDoctor({
    exec,
    verifier: fakeVerifier(),
    repoRoot: "/tmp",
    config: { slack: { channelId: "C1" } } as any,
    credentials: creds(),
  });
  assert.ok(!checks.some((c) => !c.ok && c.blocking));
});
