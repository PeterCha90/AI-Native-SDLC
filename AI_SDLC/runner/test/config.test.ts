import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { repoLayout } from "../src/paths.ts";

async function writeFileConfig(body: object): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-config-"));
  const path = join(dir, "sdlc.config.json");
  await writeFile(path, JSON.stringify(body), "utf8");
  return path;
}

/** Thrown by the process.exit mock so a test can assert loadConfig aborted without killing the runner. */
class FakeExit extends Error {
  code: number | undefined;
  constructor(code: number | undefined) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

function baseEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    LINEAR_API_KEY: "key",
    LINEAR_WEBHOOK_SECRET: "secret",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

test("no Slack tokens: slack is null and linearTrigger defaults to webhook", async () => {
  const configPath = await writeFileConfig({ linearTeamId: "team-1" });
  const config = loadConfig(baseEnv({ SDLC_CONFIG_PATH: configPath }));
  assert.equal(config.slack, null);
  assert.equal(config.linearTrigger, "webhook");
});

test("webhook trigger without LINEAR_WEBHOOK_SECRET exits the process", async (t) => {
  const configPath = await writeFileConfig({ linearTeamId: "team-1" });
  const exitMock = t.mock.method(process, "exit", (code?: number) => {
    throw new FakeExit(code);
  });
  const env = baseEnv({ SDLC_CONFIG_PATH: configPath, LINEAR_WEBHOOK_SECRET: "" });
  assert.throws(() => loadConfig(env), FakeExit);
  assert.equal(exitMock.mock.calls.length, 1);
});

test("Slack bot+app tokens with a configured channelId: slack is populated and linearTrigger defaults to poll, no webhook secret required", async (t) => {
  const configPath = await writeFileConfig({
    linearTeamId: "team-1",
    slack: { channelId: "C0123456789", roleGroups: { "Product Owner": "S1" } },
  });
  const exitMock = t.mock.method(process, "exit", (code?: number) => {
    throw new FakeExit(code);
  });
  const env = baseEnv({
    SDLC_CONFIG_PATH: configPath,
    LINEAR_WEBHOOK_SECRET: "",
    SLACK_BOT_TOKEN: "xoxb-1",
    SLACK_APP_TOKEN: "xapp-1",
  });
  const config = loadConfig(env);
  assert.equal(exitMock.mock.calls.length, 0, "must not exit when linearTrigger defaults to poll");
  assert.equal(config.linearTrigger, "poll");
  assert.deepEqual(config.slack, {
    botToken: "xoxb-1",
    appToken: "xapp-1",
    channelId: "C0123456789",
    startMode: "button",
    roleGroups: { "Product Owner": "S1" },
    roleUsers: {},
  });
});

test("Slack roleUsers in file config is carried through to Config.slack.roleUsers", async () => {
  const configPath = await writeFileConfig({
    linearTeamId: "team-1",
    slack: { channelId: "C0123456789", roleUsers: { "Product Owner": ["U1", "U2"] } },
  });
  const env = baseEnv({
    SDLC_CONFIG_PATH: configPath,
    LINEAR_WEBHOOK_SECRET: "",
    SLACK_BOT_TOKEN: "xoxb-1",
    SLACK_APP_TOKEN: "xapp-1",
  });
  const config = loadConfig(env);
  assert.deepEqual(config.slack?.roleUsers, { "Product Owner": ["U1", "U2"] });
});

test("only one of SLACK_BOT_TOKEN/SLACK_APP_TOKEN set: slack stays null", async () => {
  const configPath = await writeFileConfig({
    linearTeamId: "team-1",
    slack: { channelId: "C0123456789" },
  });
  const env = baseEnv({ SDLC_CONFIG_PATH: configPath, SLACK_BOT_TOKEN: "xoxb-1" });
  const config = loadConfig(env);
  assert.equal(config.slack, null);
  assert.equal(config.linearTrigger, "webhook");
});

test("Slack tokens set but no slack.channelId in file config: slack stays null", async () => {
  const configPath = await writeFileConfig({ linearTeamId: "team-1" });
  const env = baseEnv({ SDLC_CONFIG_PATH: configPath, SLACK_BOT_TOKEN: "xoxb-1", SLACK_APP_TOKEN: "xapp-1" });
  const config = loadConfig(env);
  assert.equal(config.slack, null);
});

test("explicit linearTrigger: webhook still requires LINEAR_WEBHOOK_SECRET even with Slack on", async (t) => {
  const configPath = await writeFileConfig({
    linearTeamId: "team-1",
    linearTrigger: "webhook",
    slack: { channelId: "C0123456789" },
  });
  t.mock.method(process, "exit", (code?: number) => {
    throw new FakeExit(code);
  });
  const env = baseEnv({
    SDLC_CONFIG_PATH: configPath,
    LINEAR_WEBHOOK_SECRET: "",
    SLACK_BOT_TOKEN: "xoxb-1",
    SLACK_APP_TOKEN: "xapp-1",
  });
  assert.throws(() => loadConfig(env), FakeExit);
});

test("linearPollIntervalMs defaults to 30000 and is overridable", async () => {
  const configPath1 = await writeFileConfig({ linearTeamId: "team-1" });
  const config1 = loadConfig(baseEnv({ SDLC_CONFIG_PATH: configPath1 }));
  assert.equal(config1.linearPollIntervalMs, 30_000);

  const configPath2 = await writeFileConfig({ linearTeamId: "team-1", linearPollIntervalMs: 5000 });
  const config2 = loadConfig(baseEnv({ SDLC_CONFIG_PATH: configPath2 }));
  assert.equal(config2.linearPollIntervalMs, 5000);
});

test("interviewMaxRounds and reworkMaxAttempts default to 5 and 3", async () => {
  const configPath = await writeFileConfig({ linearTeamId: "team-1" });
  const config = loadConfig(baseEnv({ SDLC_CONFIG_PATH: configPath }));
  assert.equal(config.interviewMaxRounds, 5);
  assert.equal(config.reworkMaxAttempts, 3);
});

test("catchUpHours defaults to 24 and is overridable, including to 0 (disabled)", async () => {
  const configPath1 = await writeFileConfig({ linearTeamId: "team-1" });
  const config1 = loadConfig(baseEnv({ SDLC_CONFIG_PATH: configPath1 }));
  assert.equal(config1.catchUpHours, 24);

  const configPath2 = await writeFileConfig({ linearTeamId: "team-1", catchUpHours: 0 });
  const config2 = loadConfig(baseEnv({ SDLC_CONFIG_PATH: configPath2 }));
  assert.equal(config2.catchUpHours, 0);

  const configPath3 = await writeFileConfig({ linearTeamId: "team-1", catchUpHours: 48 });
  const config3 = loadConfig(baseEnv({ SDLC_CONFIG_PATH: configPath3 }));
  assert.equal(config3.catchUpHours, 48);
});

test("interviewMaxRounds and reworkMaxAttempts are overridable from the config file", async () => {
  const configPath = await writeFileConfig({ linearTeamId: "team-1", interviewMaxRounds: 8, reworkMaxAttempts: 1 });
  const config = loadConfig(baseEnv({ SDLC_CONFIG_PATH: configPath }));
  assert.equal(config.interviewMaxRounds, 8);
  assert.equal(config.reworkMaxAttempts, 1);
});

test("dev path (SDLC_CONFIG_PATH): baseDir is the runner package root, unchanged from today", async () => {
  const configPath = await writeFileConfig({ linearTeamId: "team-1" });
  const config = loadConfig(baseEnv({ SDLC_CONFIG_PATH: configPath }));
  // baseDir must be the runner folder (packageRoot()), not the tmp dir the config file lives in.
  assert.ok(config.baseDir.endsWith("runner"));
  assert.ok(config.pluginDir.endsWith("plugin"));
});

test("loadConfig(process.env-shaped object) keeps working exactly like before (back-compat call form)", async () => {
  const configPath = await writeFileConfig({ linearTeamId: "team-1" });
  const env = baseEnv({ SDLC_CONFIG_PATH: configPath }) as NodeJS.ProcessEnv;
  const config = loadConfig(env);
  assert.equal(config.linear.teamId, "team-1");
  assert.ok(config.baseDir.endsWith("runner"));
});

test("user path (opts.fileConfig, no SDLC_CONFIG_PATH): baseDir is repoLayout(home, repo).dir and repoPath is repo", async () => {
  const home = "/tmp/sdlc-home-test";
  const repo = "/tmp/sdlc-repo-test";
  const config = loadConfig({
    env: {} as NodeJS.ProcessEnv,
    home,
    repo,
    fileConfig: { linearTeamId: "team-1" },
    credentials: {
      linearApiKey: "lin_api_from_creds",
      linearWebhookSecret: "secret",
      slackBotToken: "xoxb-from-creds",
      slackAppToken: "xapp-from-creds",
    },
  });
  assert.equal(config.baseDir, repoLayout(home, repo).dir);
  assert.equal(config.repoPath, repo);
  assert.equal(config.linear.apiKey, "lin_api_from_creds");
});

test("user path: env credentials win over opts.credentials for the same key", async () => {
  const home = "/tmp/sdlc-home-test";
  const repo = "/tmp/sdlc-repo-test";
  const config = loadConfig({
    env: { LINEAR_API_KEY: "lin_api_from_env" } as NodeJS.ProcessEnv,
    home,
    repo,
    fileConfig: { linearTeamId: "team-1" },
    credentials: { linearApiKey: "lin_api_from_creds", linearWebhookSecret: "secret" },
  });
  assert.equal(config.linear.apiKey, "lin_api_from_env");
});
