import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
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
  resolveRealPath,
  resolveProjectDir,
  walkUpTo,
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

test("bundledPluginDir(root) prefers the dev checkout's ../plugin (has .claude-plugin/plugin.json), even when <root>/plugin also exists", async () => {
  const parent = await mkdtemp(join(tmpdir(), "sdlc-bundled-dev-"));
  const root = join(parent, "runner");
  // A frozen copy left behind by a prior prepack/smoke:pack run — must lose to the live dev plugin.
  await mkdir(join(root, "plugin"), { recursive: true });
  await mkdir(join(parent, "plugin", ".claude-plugin"), { recursive: true });
  await writeFile(join(parent, "plugin", ".claude-plugin", "plugin.json"), "{}", "utf8");

  assert.equal(bundledPluginDir(root), join(parent, "plugin"));
});

test("bundledPluginDir(root) falls back to <root>/plugin (installed package) when there is no dev checkout marker", async () => {
  const parent = await mkdtemp(join(tmpdir(), "sdlc-bundled-pkg-"));
  const root = join(parent, "pkg-root");
  await mkdir(join(root, "plugin"), { recursive: true });

  assert.equal(bundledPluginDir(root), join(root, "plugin"));
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

test("resolveRealPath() resolves symlinks and falls back to a plain absolute path when the target doesn't exist", async () => {
  const base = await mkdtemp(join(tmpdir(), "sdlc-paths-realpath-"));
  assert.equal(resolveRealPath(base), realpathSync(base));
  assert.equal(resolveRealPath(join(base, "does-not-exist")), join(base, "does-not-exist"));
});

test("resolveProjectDir() resolves --repo against cwd, else returns cwd itself, both as real paths", async () => {
  const base = await mkdtemp(join(tmpdir(), "sdlc-paths-projectdir-"));
  await mkdir(join(base, "apps", "web"), { recursive: true });

  assert.equal(resolveProjectDir(undefined, base), realpathSync(base));
  assert.equal(resolveProjectDir("apps/web", base), realpathSync(join(base, "apps", "web")));
  assert.equal(resolveProjectDir(join(base, "apps", "web")), realpathSync(join(base, "apps", "web")));
});

test("walkUpTo() lists every directory from start up to and including stop, nearest first", () => {
  assert.deepEqual(walkUpTo("/r/apps/web/src", "/r"), ["/r/apps/web/src", "/r/apps/web", "/r/apps", "/r"]);
  assert.deepEqual(walkUpTo("/r", "/r"), ["/r"]);
});

test("walkUpTo() stops at the filesystem root instead of looping forever if stop is never reached", () => {
  const dirs = walkUpTo("/a/b/c", "/not/an/ancestor");
  assert.equal(dirs[0], "/a/b/c");
  assert.equal(dirs[dirs.length - 1], "/");
});
