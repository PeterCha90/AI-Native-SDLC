import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import {
  packageRoot,
  bundledPluginDir,
  manifestPath,
  defaultHome,
  repoKey,
  repoLayout,
  findRepoRoot,
} from "../src/paths.ts";

test("packageRoot() resolves the runner package root (contains package.json)", () => {
  const root = packageRoot();
  assert.equal(existsSync(join(root, "package.json")), true);
});

test("bundledPluginDir() finds a plugin dir that actually exists", () => {
  const dir = bundledPluginDir();
  assert.equal(existsSync(dir), true);
  assert.equal(basename(dir), "plugin");
});

test("manifestPath() points at <packageRoot>/slack/manifest.yaml", () => {
  const p = manifestPath();
  assert.equal(p, join(packageRoot(), "slack", "manifest.yaml"));
  assert.equal(existsSync(p), true);
});

test("defaultHome() prefers AI_SDLC_HOME over ~/.ai-sdlc", () => {
  assert.equal(defaultHome({ AI_SDLC_HOME: "/tmp/custom-home" } as NodeJS.ProcessEnv), "/tmp/custom-home");
  assert.equal(defaultHome({} as NodeJS.ProcessEnv), join(homedir(), ".ai-sdlc"));
});

test("repoKey() is stable for the same path and differs across paths", () => {
  const a1 = repoKey("/Users/dev/code/my-app");
  const a2 = repoKey("/Users/dev/code/my-app");
  const b = repoKey("/Users/dev/code/other-app");
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.match(a1, /^my-app-[0-9a-f]{10}$/);
});

test("repoLayout() composes dir/configPath/credentialsPath under <home>/repos/<repoKey>", () => {
  const home = "/tmp/ai-sdlc-home";
  const layout = repoLayout(home, "/Users/dev/code/my-app");
  const key = repoKey("/Users/dev/code/my-app");
  assert.equal(layout.dir, join(home, "repos", key));
  assert.equal(layout.configPath, join(layout.dir, "config.json"));
  assert.equal(layout.credentialsPath, join(layout.dir, "credentials.json"));
});

test("findRepoRoot() returns the git toplevel for a real repo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-paths-git-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const root = findRepoRoot(dir);
  assert.ok(root);
  // macOS tmp paths can be symlinked (/tmp -> /private/tmp); compare basenames are consistent.
  assert.equal(basename(root as string), basename(dir));
});

test("findRepoRoot() returns null outside a git repo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-paths-nogit-"));
  assert.equal(findRepoRoot(dir), null);
});
