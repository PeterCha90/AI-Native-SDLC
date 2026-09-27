import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareWorkDir } from "../src/pipeline.ts";

/**
 * These cover the bug class that made the hook layer silently inert: the documents and the code
 * have to end up in ONE directory, because plan-drift.sh and verify-before-done.sh resolve
 * `docs/plan/*.md` relative to the cwd each stage was spawned with.
 */

const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe" });

async function makeRepo(): Promise<string> {
  // realpath because macOS hands out /var/... symlinks for tmpdir, while `git rev-parse
  // --show-toplevel` reports the resolved /private/var/... path — comparing the two would fail.
  const root = realpathSync(await mkdtemp(join(tmpdir(), "sdlc-wd-")));
  git(["init", "-q"], root);
  git(["config", "user.email", "t@t"], root);
  git(["config", "user.name", "t"], root);
  await mkdir(join(root, "apps", "demo"), { recursive: true });
  await writeFile(join(root, "apps", "demo", "README.md"), "demo\n");
  git(["add", "-A"], root);
  git(["commit", "-qm", "init"], root);
  return root;
}

test("useWorktree=false leaves the work dir at repoPath and creates no branch", async () => {
  const root = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const { workDir, branch } = await prepareWorkDir(root, runnerDir, "ENG-1", false);
  assert.equal(workDir, root);
  assert.equal(branch, null);
});

test("a repoPath that is a subdirectory keeps that offset inside the worktree", async () => {
  const root = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const repoPath = join(root, "apps", "demo");

  const { workDir, branch } = await prepareWorkDir(repoPath, runnerDir, "ENG-2", true);

  assert.equal(branch, "sdlc/ENG-2");
  assert.equal(workDir, join(runnerDir, ".worktrees", "ENG-2", "apps", "demo"));
  assert.ok(existsSync(workDir), "the offset dir must actually exist in the worktree");
  // The real point: a doc written here is visible to a hook running with cwd = workDir.
  assert.ok(existsSync(join(workDir, "README.md")), "worktree must contain the project's files");
});

test("a repoPath that IS the toplevel gets the worktree root itself", async () => {
  const root = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  const { workDir } = await prepareWorkDir(root, runnerDir, "ENG-3", true);
  assert.equal(workDir, join(runnerDir, ".worktrees", "ENG-3"));
});

test("a non-git repoPath aborts instead of turning git's error text into a path", async () => {
  const notARepo = await mkdtemp(join(tmpdir(), "sdlc-notgit-"));
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  await assert.rejects(
    prepareWorkDir(notARepo, runnerDir, "ENG-4", true),
    /git rev-parse --show-toplevel failed/,
  );
});

test("a branch name already in use aborts rather than running in a stale directory", async () => {
  const root = await makeRepo();
  const runnerDir = await mkdtemp(join(tmpdir(), "sdlc-runner-"));
  git(["branch", "sdlc/ENG-5"], root); // collide with what prepareWorkDir will try to create
  await assert.rejects(prepareWorkDir(root, runnerDir, "ENG-5", true), /git worktree add/);
});
