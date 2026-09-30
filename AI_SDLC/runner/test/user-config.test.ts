import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCredentials,
  writeCredentials,
  readUserConfig,
  writeUserConfig,
  maskToken,
} from "../src/user-config.ts";

test("writeCredentials() writes the file at mode 600 and its folder at mode 700", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-uc-"));
  const credsDir = join(dir, "repos", "my-app-abc");
  const path = join(credsDir, "credentials.json");

  await writeCredentials(path, { slackBotToken: "xoxb-1" });

  const fileMode = (await stat(path)).mode & 0o777;
  const dirMode = (await stat(credsDir)).mode & 0o777;
  assert.equal(fileMode, 0o600);
  assert.equal(dirMode, 0o700);
});

test("readCredentials() returns {} when the file does not exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-uc-"));
  const result = await readCredentials(join(dir, "nope.json"));
  assert.deepEqual(result, {});
});

test("readCredentials() round-trips what writeCredentials() wrote", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-uc-"));
  const path = join(dir, "credentials.json");
  await writeCredentials(path, { slackBotToken: "xoxb-1", linearApiKey: "lin_api_x" });
  const result = await readCredentials(path);
  assert.deepEqual(result, { slackBotToken: "xoxb-1", linearApiKey: "lin_api_x" });
});

test("readCredentials() warns once and fixes a too-open (644) file to 600", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-uc-"));
  const path = join(dir, "credentials.json");
  await writeFile(path, JSON.stringify({ slackBotToken: "xoxb-1" }), "utf8");
  await chmod(path, 0o644);

  const warnings: string[] = [];
  const result = await readCredentials(path, (m) => warnings.push(m));

  assert.deepEqual(result, { slackBotToken: "xoxb-1" });
  assert.equal(warnings.length, 1);
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("readCredentials() catches any group/other bit via a bitmask, not just modes numerically above 600 — 0o604", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-uc-"));
  const path = join(dir, "credentials.json");
  await writeFile(path, JSON.stringify({ slackBotToken: "xoxb-1" }), "utf8");
  await chmod(path, 0o604);

  const warnings: string[] = [];
  const result = await readCredentials(path, (m) => warnings.push(m));

  assert.deepEqual(result, { slackBotToken: "xoxb-1" });
  assert.equal(warnings.length, 1);
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("readCredentials() catches any group/other bit via a bitmask — 0o640", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-uc-"));
  const path = join(dir, "credentials.json");
  await writeFile(path, JSON.stringify({ slackBotToken: "xoxb-1" }), "utf8");
  await chmod(path, 0o640);

  const warnings: string[] = [];
  const result = await readCredentials(path, (m) => warnings.push(m));

  assert.deepEqual(result, { slackBotToken: "xoxb-1" });
  assert.equal(warnings.length, 1);
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("maskToken() shows the first 8 characters plus an ellipsis", () => {
  assert.equal(maskToken("xoxb-1234567890"), "xoxb-123…");
});

test("maskToken() handles undefined", () => {
  assert.equal(typeof maskToken(undefined), "string");
});

test("writeUserConfig()/readUserConfig() round-trip, and readUserConfig() returns null when missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-uc-"));
  const path = join(dir, "config.json");

  assert.equal(await readUserConfig(path), null);

  await writeUserConfig(path, { linearTeamId: "team-1", port: 4000 });
  const result = await readUserConfig(path);
  assert.deepEqual(result, { linearTeamId: "team-1", port: 4000 });
});
