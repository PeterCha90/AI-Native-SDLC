import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

/**
 * The runner package's own root directory — the one that contains `package.json`. Works whether
 * this module is running from `src/paths.ts` (dev, `--experimental-strip-types`) or from the
 * built `dist/paths.js` (npm package): both sit one directory below the package root, so the
 * parent of this file's own directory is always it. Nothing here depends on `RUNNER_DIR`/
 * `PLUGIN_DIR`-style constants computed elsewhere — every other path helper is built on this one.
 */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * The plugin directory bundled alongside the runner. Packaged (`npm pack`/`npm publish`) layouts
 * copy `plugin/` in next to `dist/` (see `AI_SDLC/README.md` §6), so `<packageRoot>/plugin` is
 * checked first; the dev/monorepo layout keeps `AI_SDLC/plugin` as a sibling of `AI_SDLC/runner`,
 * so `<packageRoot>/../plugin` is the fallback — this is also today's dev value.
 */
export function bundledPluginDir(): string {
  const bundled = join(packageRoot(), "plugin");
  if (existsSync(bundled)) return bundled;
  return resolve(packageRoot(), "..", "plugin");
}

/** The Slack app manifest template shipped with the package. */
export function manifestPath(): string {
  return join(packageRoot(), "slack", "manifest.yaml");
}

/** `AI_SDLC_HOME` env override, else `~/.ai-sdlc` — the root every per-repo user config lives under. */
export function defaultHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.AI_SDLC_HOME ?? join(homedir(), ".ai-sdlc");
}

/**
 * A stable, filesystem-safe identifier for a repo: its basename plus the first 10 hex characters
 * of the sha256 of its resolved absolute path — so two repos that happen to share a basename
 * (`my-app` cloned twice) never collide, and the same repo always maps to the same key regardless
 * of cwd or trailing slashes.
 */
export function repoKey(repoRoot: string): string {
  const abs = resolve(repoRoot);
  const hash = createHash("sha256").update(abs).digest("hex").slice(0, 10);
  return `${basename(abs)}-${hash}`;
}

export interface RepoLayout {
  dir: string;
  configPath: string;
  credentialsPath: string;
}

/** Per-repo user layout under `<home>/repos/<repoKey>/` — `.state`/`.worktrees` (see config.ts) live under `dir` too. */
export function repoLayout(home: string, repoRoot: string): RepoLayout {
  const dir = join(home, "repos", repoKey(repoRoot));
  return {
    dir,
    configPath: join(dir, "config.json"),
    credentialsPath: join(dir, "credentials.json"),
  };
}

/** `git rev-parse --show-toplevel` from `cwd`, or `null` if `cwd` is not inside a git repo. */
export function findRepoRoot(cwd: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.trim() || null;
}
