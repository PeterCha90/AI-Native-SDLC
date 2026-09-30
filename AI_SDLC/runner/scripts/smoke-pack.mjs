#!/usr/bin/env node
// Packs ai-sdlc-runner with `npm pack`, installs the tarball into a scratch
// project, and runs the published CLI from there the way an end user would
// via `npx ai-sdlc-runner`. Confirms the plugin and Slack manifest shipped
// inside the installed package, and that the CLI's basic commands behave.
//
// Until src/cli.ts exists (it's being added in a separate task), this exits
// with code 2 and a message instead of failing the whole run.
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
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

// `npm pack --json` is supposed to print a single JSON array to stdout, but
// npm (and any lifecycle script it runs, e.g. our own prepack step) can still
// leak stray stdout lines ahead of it depending on npm version/config. Be
// tolerant: find the outermost `[ ... ]` in the captured stdout and parse
// just that, instead of assuming the whole string is clean JSON.
function parsePackJson(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`could not find a JSON array in \`npm pack --json\` output:\n${stdout}`);
  }
  const jsonSlice = stdout.slice(start, end + 1);
  try {
    return JSON.parse(jsonSlice);
  } catch (err) {
    throw new Error(`failed to parse \`npm pack --json\` output as JSON: ${err.message}\n--- raw stdout ---\n${stdout}`);
  }
}

async function main() {
  if (!existsSync(cliSourcePath)) {
    console.log("smoke-pack: cli 없음 (src/cli.ts not found yet) — skipping smoke test");
    process.exit(2);
  }

  let scratchDir;

  try {
    scratchDir = await mkdtemp(path.join(tmpdir(), "ai-sdlc-runner-smoke-"));
    console.log(`smoke-pack: scratch dir ${scratchDir}`);

    console.log("smoke-pack: npm pack --json (packing into scratch dir, not the runner folder)");
    const packStdout = run("npm", ["pack", "--json", "--pack-destination", scratchDir], {
      cwd: runnerDir,
    });
    const [packResult] = parsePackJson(packStdout);
    const tarballPath = path.join(scratchDir, packResult.filename);
    if (!existsSync(tarballPath)) {
      throw new Error(`expected tarball at ${tarballPath} but it was not found`);
    }
    console.log(`smoke-pack: packed ${tarballPath} (${packResult.size} bytes)`);

    const installDir = path.join(scratchDir, "install");
    await mkdir(installDir, { recursive: true });
    console.log(`smoke-pack: installing into ${installDir}`);
    run("npm", ["init", "-y"], { cwd: installDir });
    run("npm", ["install", tarballPath], { cwd: installDir });

    console.log("smoke-pack: npx ai-sdlc-runner --help");
    const helpOutput = run("npx", ["ai-sdlc-runner", "--help"], { cwd: installDir });
    if (!/사용법|usage/i.test(helpOutput)) {
      throw new Error(`--help output did not look like usage text:\n${helpOutput}`);
    }

    console.log("smoke-pack: npx ai-sdlc-runner manifest");
    run("npx", ["ai-sdlc-runner", "manifest"], { cwd: installDir });

    const installedPkgDir = path.join(installDir, "node_modules", "ai-sdlc-runner");
    const installedPluginSkill = path.join(installedPkgDir, "plugin", "skills", "sdlc-intent", "SKILL.md");
    const installedManifest = path.join(installedPkgDir, "slack", "manifest.yaml");
    const installedClaudeTemplate = path.join(installedPkgDir, "plugin", "templates", "CLAUDE.md.template");

    for (const p of [installedPluginSkill, installedManifest, installedClaudeTemplate]) {
      if (!existsSync(p)) {
        throw new Error(`expected file missing from installed package: ${p}`);
      }
    }
    // Touch the files so a failure to read them (permissions, etc.) also fails the smoke test.
    await readFile(installedPluginSkill, "utf8");
    await readFile(installedManifest, "utf8");
    await readFile(installedClaudeTemplate, "utf8");
    console.log(
      "smoke-pack: OK — plugin/skills/sdlc-intent/SKILL.md, plugin/templates/CLAUDE.md.template, slack/manifest.yaml present",
    );

    // Spec §8: `config` with no init'd repo should tell the user to run
    // `init` rather than crashing. Use a throwaway git repo (so
    // findRepoRoot() succeeds) and a fresh AI_SDLC_HOME (so no config could
    // possibly already exist there).
    const fixtureGitRepo = path.join(scratchDir, "fixture-repo");
    const fixtureHome = path.join(scratchDir, "fixture-home");
    await mkdir(fixtureGitRepo, { recursive: true });
    await mkdir(fixtureHome, { recursive: true });
    run("git", ["init", "-q"], { cwd: fixtureGitRepo });

    console.log("smoke-pack: npx ai-sdlc-runner config --repo <uninitialized git repo> (AI_SDLC_HOME=<fresh dir>)");
    let configOutput;
    let configExitCode = 0;
    try {
      configOutput = run("npx", ["ai-sdlc-runner", "config", "--repo", fixtureGitRepo], {
        cwd: installDir,
        env: { ...process.env, AI_SDLC_HOME: fixtureHome },
      });
    } catch (err) {
      // execFileSync throws on non-zero exit; capture what it saw.
      configExitCode = typeof err.status === "number" ? err.status : 1;
      configOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    // As implemented today, `config` on a repo with no init'd config prints
    // guidance and exits 0 (only `start` exits 1 for this case) — assert on
    // the actual, current CLI behavior rather than an assumed exit code.
    if (configExitCode !== 0) {
      throw new Error(`expected \`config\` on an uninitialized repo to exit 0, got ${configExitCode}:\n${configOutput}`);
    }
    if (!/init/i.test(configOutput)) {
      throw new Error(`expected \`config\` on an uninitialized repo to mention "init":\n${configOutput}`);
    }
    console.log("smoke-pack: OK — `config` on an uninitialized repo exits 0 and points at `init`");
  } finally {
    if (scratchDir) {
      await rm(scratchDir, { recursive: true, force: true });
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
