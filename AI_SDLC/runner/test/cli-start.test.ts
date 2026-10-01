import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { repoLayout } from "../src/paths.ts";
import { writeCredentials, writeUserConfig } from "../src/user-config.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

// Regression: `start` used to return 0 right after startServer(), and the entry point then
// called process.exit(0) — the runner died milliseconds after printing its checks.
test("start keeps the process alive after the server is listening", async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), "cli-start-repo-")));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const home = await mkdtemp(join(tmpdir(), "cli-start-home-"));
  const port = 40000 + Math.floor(Math.random() * 20000);

  const layout = repoLayout(home, repo);
  await writeUserConfig(layout.configPath, {
    ticketSource: "linear",
    repoPath: repo,
    linearTeamId: "team-1",
    linearTrigger: "webhook",
    port,
  });
  await writeCredentials(layout.credentialsPath, { linearApiKey: "lin_api_test", linearWebhookSecret: "secret" });

  const env = { ...process.env };
  for (const k of ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "LINEAR_API_KEY", "LINEAR_WEBHOOK_SECRET", "SDLC_CONFIG_PATH", "PORT"]) {
    delete env[k];
  }
  const child = spawn(process.execPath, ["--experimental-strip-types", CLI, "start", "--skip-checks", "--repo", repo, "--home", home], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (c: Buffer) => (output += c.toString()));
  child.stderr.on("data", (c: Buffer) => (output += c.toString()));
  let exited: number | null | undefined;
  child.on("exit", (code) => (exited = code));

  try {
    const deadline = Date.now() + 15000;
    while (!output.includes("listening on") && exited === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(output.includes(`listening on :${port}`), `server never started:\n${output}`);

    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(exited, undefined, `runner exited (code ${exited}) after starting:\n${output}`);

    const res = await fetch(`http://localhost:${port}/health`);
    assert.equal(res.status, 200);
  } finally {
    child.kill();
  }
});
