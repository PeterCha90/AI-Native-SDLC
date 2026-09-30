import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit, runInitNonInteractive, type Prompter, type InitDeps } from "../src/cli/init.ts";
import type { Verifier } from "../src/cli/verify.ts";
import { repoLayout } from "../src/paths.ts";

async function tmpDirs(): Promise<{ repoRoot: string; home: string }> {
  const base = await mkdtemp(join(tmpdir(), "ai-sdlc-init-test-"));
  return { repoRoot: join(base, "repo"), home: join(base, "home") };
}

function fakeVerifier(overrides: Partial<Verifier> = {}): Verifier {
  return {
    slackBot: async () => ({ ok: true, team: "Acme", botName: "ai-sdlc", botUserId: "U1" }),
    slackApp: async () => ({ ok: true }),
    postTest: async () => ({ ok: true }),
    userGroups: async () => [{ id: "S1", handle: "eng", name: "Engineers" }],
    linear: async () => ({ ok: true, viewer: "Peter", teams: [{ id: "T1", key: "ENG", name: "Engineering" }] }),
    ...overrides,
  };
}

/** Scripted prompter: answers come off a queue in call order; `isCancel` checks for the CANCEL sentinel. */
const CANCEL = Symbol("cancel");
function scriptedPrompter(answers: unknown[]): Prompter & { calls: string[] } {
  const queue = [...answers];
  const calls: string[] = [];
  const next = (label: string) => {
    calls.push(label);
    if (queue.length === 0) throw new Error(`scriptedPrompter ran out of answers at "${label}"`);
    return queue.shift();
  };
  return {
    calls,
    text: async (o) => next(`text:${o.message}`) as string | symbol,
    password: async (o) => next(`password:${o.message}`) as string | symbol,
    select: async (o) => next(`select:${o.message}`) as any,
    confirm: async (o) => next(`confirm:${o.message}`) as boolean | symbol,
    note: () => {},
    log: () => {},
    isCancel: (v) => v === CANCEL,
  };
}

function baseInitDeps(overrides: Partial<InitDeps> & { repoRoot: string; home: string }): InitDeps {
  return {
    prompter: scriptedPrompter([]),
    verifier: fakeVerifier(),
    installTemplates: async () => [],
    ...overrides,
  };
}

test("runInit — full happy path saves credentials (600) and config", async () => {
  const { repoRoot, home } = await tmpDirs();
  const prompter = scriptedPrompter([
    "have", // slack app exists
    "xoxb-good", // bot token
    "xapp-good", // app token
    "lin_api_good", // linear key
    "T1", // team select
    "C0ABC123", // channel
    false, // restrict role groups? no
    "button", // start mode
    false, // install templates? no
  ]);
  const result = await runInit({ prompter, verifier: fakeVerifier(), repoRoot, home, installTemplates: async () => [] });

  assert.equal(result.saved, true);
  const layout = repoLayout(home, repoRoot);
  assert.deepEqual(result.layout, layout);

  const credRaw = JSON.parse(await readFile(layout.credentialsPath, "utf8"));
  assert.equal(credRaw.slackBotToken, "xoxb-good");
  assert.equal(credRaw.slackAppToken, "xapp-good");
  assert.equal(credRaw.linearApiKey, "lin_api_good");

  const credStat = await stat(layout.credentialsPath);
  assert.equal(credStat.mode & 0o777, 0o600);

  const configRaw = JSON.parse(await readFile(layout.configPath, "utf8"));
  assert.equal(configRaw.ticketSource, "linear");
  assert.equal(configRaw.repoPath, repoRoot);
  assert.equal(configRaw.linearTeamId, "T1");
  assert.equal(configRaw.linearTrigger, "poll");
  assert.equal(configRaw.slack.channelId, "C0ABC123");
  assert.equal(configRaw.slack.startMode, "button");
  assert.deepEqual(configRaw.slack.roleGroups, {});
});

test("runInit — wrong-prefix bot token re-asks then succeeds", async () => {
  const { repoRoot, home } = await tmpDirs();
  const prompter = scriptedPrompter([
    "have",
    "xapp-oops", // wrong prefix for bot token slot
    "xoxb-good", // retry, correct
    "xapp-good",
    "lin_api_good",
    "T1",
    "C0ABC123",
    false,
    "button",
    false,
  ]);
  const result = await runInit({ prompter, verifier: fakeVerifier(), repoRoot, home, installTemplates: async () => [] });
  assert.equal(result.saved, true);
  const layout = repoLayout(home, repoRoot);
  const credRaw = JSON.parse(await readFile(layout.credentialsPath, "utf8"));
  assert.equal(credRaw.slackBotToken, "xoxb-good");
});

test("runInit — not_in_channel retries after inviting the bot", async () => {
  const { repoRoot, home } = await tmpDirs();
  let postCalls = 0;
  const verifier = fakeVerifier({
    postTest: async () => {
      postCalls += 1;
      if (postCalls === 1) return { ok: false, error: "not_in_channel" };
      return { ok: true };
    },
  });
  const prompter = scriptedPrompter([
    "have",
    "xoxb-good",
    "xapp-good",
    "lin_api_good",
    "T1",
    "C0ABC123", // first channel attempt -> not_in_channel
    "C0ABC123", // retry after invite -> succeeds
    false,
    "button",
    false,
  ]);
  const result = await runInit({ prompter, verifier, repoRoot, home, installTemplates: async () => [] });
  assert.equal(result.saved, true);
  assert.equal(postCalls, 2);
});

test("runInit — cancelling mid-flow saves nothing", async () => {
  const { repoRoot, home } = await tmpDirs();
  const prompter = scriptedPrompter([
    "have",
    "xoxb-good",
    CANCEL, // cancel at app token step
  ]);
  const result = await runInit({ prompter, verifier: fakeVerifier(), repoRoot, home, installTemplates: async () => [] });
  assert.equal(result.saved, false);
  const layout = repoLayout(home, repoRoot);
  await assert.rejects(readFile(layout.credentialsPath, "utf8"));
  await assert.rejects(readFile(layout.configPath, "utf8"));
});

test("runInit — three failed attempts aborts without saving", async () => {
  const { repoRoot, home } = await tmpDirs();
  const verifier = fakeVerifier({ slackBot: async () => ({ ok: false, error: "invalid_auth" }) });
  const prompter = scriptedPrompter([
    "have",
    "xoxb-bad1",
    "xoxb-bad2",
    "xoxb-bad3",
  ]);
  const result = await runInit({ prompter, verifier, repoRoot, home, installTemplates: async () => [] });
  assert.equal(result.saved, false);
  const layout = repoLayout(home, repoRoot);
  await assert.rejects(readFile(layout.credentialsPath, "utf8"));
});

test("runInit — a network_error on the bot token step just retries like any other failure", async () => {
  const { repoRoot, home } = await tmpDirs();
  let attempts = 0;
  const verifier = fakeVerifier({
    slackBot: async (token) => {
      attempts += 1;
      if (attempts === 1) return { ok: false, error: "network_error" };
      return { ok: true, team: "Acme", botName: "ai-sdlc", botUserId: "U1" };
    },
  });
  const prompter = scriptedPrompter([
    "have",
    "xoxb-good", // 1st attempt -> network_error, re-asked
    "xoxb-good", // 2nd attempt -> succeeds
    "xapp-good",
    "lin_api_good",
    "T1",
    "C0ABC123",
    false,
    "button",
    false,
  ]);
  const result = await runInit({ prompter, verifier, repoRoot, home, installTemplates: async () => [] });
  assert.equal(result.saved, true);
  assert.equal(attempts, 2);
});

test("runInit — a Slack URL the parser can't extract a channel id from is rejected with a clear message, then retried", async () => {
  const { repoRoot, home } = await tmpDirs();
  const loggedMessages: string[] = [];
  const prompter = scriptedPrompter([
    "have",
    "xoxb-good",
    "xapp-good",
    "lin_api_good",
    "T1",
    "https://acme.slack.com/messages/general", // URL-like but unparseable -> rejected
    "C0ABC123", // retry with a valid id -> succeeds
    false,
    "button",
    false,
  ]);
  prompter.log = (msg: string) => loggedMessages.push(msg);
  const result = await runInit({ prompter, verifier: fakeVerifier(), repoRoot, home, installTemplates: async () => [] });
  assert.equal(result.saved, true);
  assert.ok(loggedMessages.some((m) => m.includes("링크에서 채널 ID를 찾지 못했다")));
  const layout = repoLayout(home, repoRoot);
  const configRaw = JSON.parse(await readFile(layout.configPath, "utf8"));
  assert.equal(configRaw.slack.channelId, "C0ABC123");
});

test("runInit — second run offers existing values as defaults and reuses stored tokens on empty password", async () => {
  const { repoRoot, home } = await tmpDirs();

  const firstPrompter = scriptedPrompter([
    "have",
    "xoxb-good",
    "xapp-good",
    "lin_api_good",
    "T1",
    "C0ABC123",
    false,
    "button",
    false,
  ]);
  const firstResult = await runInit({
    prompter: firstPrompter,
    verifier: fakeVerifier(),
    repoRoot,
    home,
    installTemplates: async () => [],
  });
  assert.equal(firstResult.saved, true);

  // Second run: every password answer is empty ("keep existing"); team/channel/start-mode answers
  // repeat the same values the defaults (initialValue) will show.
  const secondPrompter = scriptedPrompter(["have", "", "", "", "T1", "C0ABC123", false, "button", false]);
  const selectCalls: any[] = [];
  const textCalls: any[] = [];
  const passwordMessages: string[] = [];
  const originalSelect = secondPrompter.select.bind(secondPrompter);
  secondPrompter.select = (async (o: any) => {
    selectCalls.push(o);
    return originalSelect(o);
  }) as any;
  const originalText = secondPrompter.text.bind(secondPrompter);
  secondPrompter.text = (async (o: any) => {
    textCalls.push(o);
    return originalText(o);
  }) as any;
  const originalPassword = secondPrompter.password.bind(secondPrompter);
  secondPrompter.password = (async (o: any) => {
    passwordMessages.push(o.message);
    return originalPassword(o);
  }) as any;

  const secondResult = await runInit({
    prompter: secondPrompter,
    verifier: fakeVerifier(),
    repoRoot,
    home,
    installTemplates: async () => [],
  });
  assert.equal(secondResult.saved, true);

  // Every password prompt advertised "keep existing" since a value was already on file.
  assert.ok(passwordMessages.every((m) => m.includes("기존 값 유지")));

  // select()/text() calls were offered the existing values as defaults.
  const teamCall = selectCalls.find((c) => c.message === "Linear 팀을 선택한다");
  assert.equal(teamCall.initialValue, "T1");
  const channelCall = textCalls.find((c) => c.message === "Slack 채널 ID 또는 채널 링크");
  assert.equal(channelCall.initialValue, "C0ABC123");
  const startModeCall = selectCalls.find((c) => c.message === "새 티켓 알림 시 시작 방식");
  assert.equal(startModeCall.initialValue, "button");

  // Credentials on disk are unchanged (still the original tokens).
  const layout = repoLayout(home, repoRoot);
  const credRaw = JSON.parse(await readFile(layout.credentialsPath, "utf8"));
  assert.equal(credRaw.slackBotToken, "xoxb-good");
  assert.equal(credRaw.slackAppToken, "xapp-good");
  assert.equal(credRaw.linearApiKey, "lin_api_good");
});

test("runInitNonInteractive — env tokens plus flags save without prompting", async () => {
  const { repoRoot, home } = await tmpDirs();
  const result = await runInitNonInteractive({
    repoRoot,
    home,
    verifier: fakeVerifier(),
    installTemplates: async () => [],
    env: { SLACK_BOT_TOKEN: "xoxb-good", SLACK_APP_TOKEN: "xapp-good", LINEAR_API_KEY: "lin_api_good" },
    channel: "C0ABC123",
    team: "T1",
  });
  assert.deepEqual(result, { saved: true, errors: [] });
  const layout = repoLayout(home, repoRoot);
  const configRaw = JSON.parse(await readFile(layout.configPath, "utf8"));
  assert.equal(configRaw.linearTeamId, "T1");
  assert.equal(configRaw.slack.channelId, "C0ABC123");
});

test("runInitNonInteractive — --team matches by Linear team key, not just id", async () => {
  const { repoRoot, home } = await tmpDirs();
  const result = await runInitNonInteractive({
    repoRoot,
    home,
    verifier: fakeVerifier(),
    installTemplates: async () => [],
    env: { SLACK_BOT_TOKEN: "xoxb-good", SLACK_APP_TOKEN: "xapp-good", LINEAR_API_KEY: "lin_api_good" },
    channel: "C0ABC123",
    team: "ENG", // key, not id — fakeVerifier's team is { id: "T1", key: "ENG", name: "Engineering" }
  });
  assert.deepEqual(result, { saved: true, errors: [] });
  const layout = repoLayout(home, repoRoot);
  const configRaw = JSON.parse(await readFile(layout.configPath, "utf8"));
  assert.equal(configRaw.linearTeamId, "T1");
});

test("runInitNonInteractive — --team matches by exact Linear team name", async () => {
  const { repoRoot, home } = await tmpDirs();
  const result = await runInitNonInteractive({
    repoRoot,
    home,
    verifier: fakeVerifier(),
    installTemplates: async () => [],
    env: { SLACK_BOT_TOKEN: "xoxb-good", SLACK_APP_TOKEN: "xapp-good", LINEAR_API_KEY: "lin_api_good" },
    channel: "C0ABC123",
    team: "Engineering",
  });
  assert.deepEqual(result, { saved: true, errors: [] });
  const layout = repoLayout(home, repoRoot);
  const configRaw = JSON.parse(await readFile(layout.configPath, "utf8"));
  assert.equal(configRaw.linearTeamId, "T1");
});

test("runInitNonInteractive — an unknown --team is rejected, listing the available team keys, and saves nothing", async () => {
  const { repoRoot, home } = await tmpDirs();
  const verifier = fakeVerifier({
    linear: async () => ({
      ok: true,
      viewer: "Peter",
      teams: [
        { id: "T1", key: "ENG", name: "Engineering" },
        { id: "T2", key: "OPS", name: "Operations" },
      ],
    }),
  });
  const result = await runInitNonInteractive({
    repoRoot,
    home,
    verifier,
    installTemplates: async () => [],
    env: { SLACK_BOT_TOKEN: "xoxb-good", SLACK_APP_TOKEN: "xapp-good", LINEAR_API_KEY: "lin_api_good" },
    channel: "C0ABC123",
    team: "NOPE",
  });
  assert.equal(result.saved, false);
  assert.ok(result.errors.some((e) => e.includes("NOPE") && e.includes("ENG") && e.includes("OPS")));
  const layout = repoLayout(home, repoRoot);
  await assert.rejects(readFile(layout.configPath, "utf8"));
});

test("runInitNonInteractive — missing tokens reports errors and saves nothing", async () => {
  const { repoRoot, home } = await tmpDirs();
  const result = await runInitNonInteractive({
    repoRoot,
    home,
    verifier: fakeVerifier(),
    installTemplates: async () => [],
    env: {},
  });
  assert.equal(result.saved, false);
  assert.ok(result.errors.length > 0);
  const layout = repoLayout(home, repoRoot);
  await assert.rejects(readFile(layout.configPath, "utf8"));
});
