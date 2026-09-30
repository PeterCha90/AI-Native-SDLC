import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installTemplatesReal, runCli } from "../src/cli/commands.ts";

async function tmpRepo(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "ai-sdlc-commands-test-"));
}

// SDLC용 CLAUDE.md는 루트가 아니라 `.claude/CLAUDE.md`에 깔린다 — 대부분의 저장소는 루트에 팀의
// CLAUDE.md를 이미 갖고 있고, "이미 있는 파일은 덮어쓰지 않는다" 규칙 때문에 루트에 깔면 SDLC 규칙이
// 아예 들어가지 못한다. Claude Code는 `./CLAUDE.md`와 `./.claude/CLAUDE.md`를 둘 다 읽는다.
test("installTemplatesReal writes the CLAUDE.md template to .claude/CLAUDE.md, not the repo root", async () => {
  const repoRoot = await tmpRepo();
  const installed = await installTemplatesReal(repoRoot);

  assert.ok(installed.includes(join(".claude", "CLAUDE.md")), `expected .claude/CLAUDE.md in ${JSON.stringify(installed)}`);
  assert.ok(existsSync(join(repoRoot, ".claude", "CLAUDE.md")));
  assert.equal(existsSync(join(repoRoot, "CLAUDE.md")), false, "must never write a root CLAUDE.md");

  const content = await readFile(join(repoRoot, ".claude", "CLAUDE.md"), "utf8");
  assert.match(content, /CLAUDE\.md/);
});

test("installTemplatesReal never touches an existing root CLAUDE.md", async () => {
  const repoRoot = await tmpRepo();
  const rootClaudeMd = join(repoRoot, "CLAUDE.md");
  await writeFile(rootClaudeMd, "# team CLAUDE.md — do not touch\n", "utf8");

  const installed = await installTemplatesReal(repoRoot);

  assert.ok(installed.includes(join(".claude", "CLAUDE.md")));
  assert.equal(await readFile(rootClaudeMd, "utf8"), "# team CLAUDE.md — do not touch\n");
  assert.ok(existsSync(join(repoRoot, ".claude", "CLAUDE.md")), "the .claude/CLAUDE.md copy still lands");
});

test("installTemplatesReal skips .claude/CLAUDE.md when it already exists", async () => {
  const repoRoot = await tmpRepo();
  const dest = join(repoRoot, ".claude", "CLAUDE.md");
  await mkdir(join(repoRoot, ".claude"), { recursive: true });
  await writeFile(dest, "already here\n", "utf8");

  const installed = await installTemplatesReal(repoRoot);

  assert.equal(installed.includes(join(".claude", "CLAUDE.md")), false);
  assert.equal(await readFile(dest, "utf8"), "already here\n");
});

// `init` must refuse a non-git folder instead of silently falling back to cwd — the runner makes a
// worktree per ticket (spec §5 step 1), and `start`/`doctor`/`config` already refuse the same folder
// via `resolveRepoAndHome` returning null. Before this fix, `init --yes` would happily "succeed" in a
// non-git folder and then `start` would immediately fail with "run init first", which is confusing.
test("`init` refuses a non-git folder instead of falling back to cwd", async () => {
  const nonGitDir = await tmpRepo();
  const home = await tmpRepo();
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (msg?: unknown) => {
    logged.push(String(msg));
  };
  try {
    const code = await runCli(["init", "--yes", "--repo", nonGitDir, "--home", home]);
    assert.equal(code, 1);
    assert.ok(
      logged.some((line) => line.includes("git 저장소")),
      `expected a git-repo error message, got ${JSON.stringify(logged)}`,
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(existsSync(join(nonGitDir, ".claude")), false, "must not install templates outside a git repo");
});
