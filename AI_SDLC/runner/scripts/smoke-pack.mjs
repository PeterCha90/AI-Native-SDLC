#!/usr/bin/env node
// Packs ai-sdlc-runner with `npm pack`, installs the tarball into a scratch
// project, and runs the published CLI from there the way an end user would
// via `npx ai-sdlc-runner`. Confirms the plugin and Slack manifest shipped
// inside the installed package.
//
// Until src/cli.ts exists (it's being added in a separate task), this exits
// with code 2 and a message instead of failing the whole run.
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const runnerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliSourcePath = path.join(runnerDir, "src", "cli.ts");

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

async function main() {
  if (!existsSync(cliSourcePath)) {
    console.log("smoke-pack: cli 없음 (src/cli.ts not found yet) — skipping smoke test");
    process.exit(2);
  }

  let tarballPath;
  let scratchDir;

  try {
    console.log("smoke-pack: npm pack --json");
    const packJson = run("npm", ["pack", "--json", "--pack-destination", runnerDir], {
      cwd: runnerDir,
    });
    const [packResult] = JSON.parse(packJson);
    tarballPath = path.join(runnerDir, packResult.filename);
    if (!existsSync(tarballPath)) {
      throw new Error(`expected tarball at ${tarballPath} but it was not found`);
    }
    console.log(`smoke-pack: packed ${tarballPath} (${packResult.size} bytes)`);

    scratchDir = await mkdtemp(path.join(tmpdir(), "ai-sdlc-runner-smoke-"));
    console.log(`smoke-pack: installing into ${scratchDir}`);
    run("npm", ["init", "-y"], { cwd: scratchDir });
    run("npm", ["install", tarballPath], { cwd: scratchDir });

    console.log("smoke-pack: npx ai-sdlc-runner --help");
    run("npx", ["ai-sdlc-runner", "--help"], { cwd: scratchDir });

    console.log("smoke-pack: npx ai-sdlc-runner manifest");
    run("npx", ["ai-sdlc-runner", "manifest"], { cwd: scratchDir });

    const installedPluginSkill = path.join(
      scratchDir,
      "node_modules",
      "ai-sdlc-runner",
      "plugin",
      "skills",
      "sdlc-intent",
      "SKILL.md",
    );
    const installedManifest = path.join(
      scratchDir,
      "node_modules",
      "ai-sdlc-runner",
      "slack",
      "manifest.yaml",
    );

    for (const p of [installedPluginSkill, installedManifest]) {
      if (!existsSync(p)) {
        throw new Error(`expected file missing from installed package: ${p}`);
      }
    }
    // Touch the files so a failure to read them (permissions, etc.) also fails the smoke test.
    await readFile(installedPluginSkill, "utf8");
    await readFile(installedManifest, "utf8");

    console.log("smoke-pack: OK — plugin/skills/sdlc-intent/SKILL.md and slack/manifest.yaml present");
  } finally {
    if (scratchDir) {
      await rm(scratchDir, { recursive: true, force: true });
    }
    if (tarballPath && existsSync(tarballPath)) {
      await rm(tarballPath, { force: true });
    }
  }
}

main().catch((err) => {
  console.error("smoke-pack: FAILED");
  console.error(err.stdout ?? "");
  console.error(err.stderr ?? "");
  console.error(err.message ?? err);
  process.exit(1);
});
