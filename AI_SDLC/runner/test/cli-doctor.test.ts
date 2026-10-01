import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor, formatChecks, type Check, type DoctorDeps } from "../src/cli/doctor.ts";
import type { Verifier } from "../src/cli/verify.ts";

async function tmpRepo(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "ai-sdlc-doctor-test-"));
}

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
  return async (
    cmd: string,
    args: string[],
    _opts?: { input?: string },
  ): Promise<{ code: number; stdout: string; stderr: string }> => {
    const key = `${cmd} ${args.join(" ")}`;
    for (const [k, v] of Object.entries(overrides)) {
      if (key.startsWith(k)) return v;
    }
    if (cmd === "claude" && args[0] === "--version") return { code: 0, stdout: "1.0.0", stderr: "" };
    if (cmd === "claude" && args[0] === "auth") return { code: 0, stdout: "logged in", stderr: "" };
    if (cmd === "claude" && args[0] === "mcp")
      return {
        code: 0,
        stdout: "linear: https://mcp.linear.app/mcp (HTTP) - ✔ Connected\ngithub: https://api.githubcopilot.com/mcp (HTTP) - ✔ Connected",
        stderr: "",
      };
    if (cmd === "git") return { code: 0, stdout: "true", stderr: "" };
    if (cmd === "ego-browser") return { code: 0, stdout: "", stderr: "ok" };
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

test("missing linear entirely in mcp list is a blocking failure", async () => {
  const exec = greenExec({
    "claude mcp": { code: 0, stdout: "github: https://api.githubcopilot.com/mcp (HTTP) - ✔ Connected", stderr: "" },
  });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "Linear MCP 연결");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, true);
  // `claude mcp list`만 보고는 다른 폴더의 local/project 범위 서버를 알 수 없다는 점과, 정확한
  // 추가 명령을 detail/fix에 남긴다.
  assert.match(check!.detail, /현재 폴더에서 보이는 서버만/);
  assert.match(check!.fix ?? "", /claude mcp add --scope user --transport http linear https:\/\/mcp\.linear\.app\/mcp/);
  assert.match(check!.fix ?? "", /\/mcp/);
});

test("linear connected (✔ Connected) is not blocking", async () => {
  const exec = greenExec({
    "claude mcp": { code: 0, stdout: "linear: https://mcp.linear.app/mcp (HTTP) - ✔ Connected", stderr: "" },
  });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "Linear MCP 연결");
  assert.ok(check);
  assert.equal(check!.ok, true);
  assert.equal(check!.blocking, false);
});

test("linear failed to connect (✗ Failed to connect) is blocking", async () => {
  const exec = greenExec({
    "claude mcp": { code: 0, stdout: "linear: https://mcp.linear.app/mcp (HTTP) - ✗ Failed to connect", stderr: "" },
  });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "Linear MCP 연결");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, true);
});

test("linear needs authentication (⚠ Needs authentication) is blocking with an auth fix hint", async () => {
  const exec = greenExec({
    "claude mcp": { code: 0, stdout: "linear: https://mcp.linear.app/mcp (HTTP) - ⚠ Needs authentication", stderr: "" },
  });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "Linear MCP 연결");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, true);
  assert.match(check!.fix ?? "", /mcp/i);
});

test("a linear line for another server (e.g. 'my-linear-clone') doesn't false-positive as unrelated", async () => {
  // Sanity: the matcher keys off the server NAME (before ':'), not any substring of the line.
  const exec = greenExec({
    "claude mcp": {
      code: 0,
      stdout: "docs: https://example.com/mcp (HTTP) - ✔ Connected — linear issues supported",
      stderr: "",
    },
  });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "Linear MCP 연결");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, true);
});

test("ego-browser ready (cliLog(\"ok\") echoes back without onboarding) is ✅", async () => {
  const exec = greenExec({ "ego-browser nodejs": { code: 0, stdout: "", stderr: "ok" } });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "ego-browser 준비");
  assert.ok(check);
  assert.equal(check!.ok, true);
  assert.equal(check!.blocking, false);
});

test("ego-browser still in onboarding is a non-blocking warning with a hint", async () => {
  const exec = greenExec({
    "ego-browser nodejs": { code: 0, stdout: "", stderr: "please complete the onboarding process first" },
  });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "ego-browser 준비");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, false);
  assert.match(check!.detail, /온보딩/);
  assert.match(check!.fix ?? "", /온보딩/);
});

test("ego-browser missing binary is a non-blocking warning with an install hint", async () => {
  const exec = greenExec({ "ego-browser nodejs": { code: 127, stdout: "", stderr: "command not found" } });
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot: null, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "ego-browser 준비");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, false);
  assert.match(check!.detail, /찾을 수 없습니다/);
  assert.match(check!.fix ?? "", /설치해 주세요/);
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

test("저장소 템플릿 check finds .claude/CLAUDE.md, not a root CLAUDE.md", async () => {
  const repoRoot = await tmpRepo();
  await mkdir(join(repoRoot, ".claude"), { recursive: true });
  await writeFile(join(repoRoot, ".claude", "CLAUDE.md"), "# CLAUDE.md\n", "utf8");
  await writeFile(join(repoRoot, "REVIEW.md"), "# REVIEW.md\n", "utf8");
  await mkdir(join(repoRoot, "ops"), { recursive: true });
  await writeFile(join(repoRoot, "ops", "bands.yaml"), "bands: []\n", "utf8");
  await writeFile(join(repoRoot, "ops", "detect.sh"), "#!/bin/sh\n", "utf8");

  const exec = greenExec();
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "저장소 템플릿");
  assert.ok(check);
  assert.equal(check!.ok, true);
  assert.equal(check!.blocking, false);
  assert.match(check!.detail, /모두 있습니다/);
});

test("저장소 템플릿 check is a non-blocking warning when .claude/CLAUDE.md is missing, even if a root CLAUDE.md exists", async () => {
  const repoRoot = await tmpRepo();
  await writeFile(join(repoRoot, "CLAUDE.md"), "# team CLAUDE.md\n", "utf8");

  const exec = greenExec();
  const checks = await runDoctor({ exec, verifier: fakeVerifier(), repoRoot, config: null, credentials: creds() });
  const check = checks.find((c) => c.name === "저장소 템플릿");
  assert.ok(check);
  assert.equal(check!.ok, false);
  assert.equal(check!.blocking, false);
  assert.match(check!.detail, /\.claude\/CLAUDE\.md/);
  assert.match(check!.fix ?? "", /init|sdlc-init/);
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
