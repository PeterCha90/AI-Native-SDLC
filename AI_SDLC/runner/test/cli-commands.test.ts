import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseInitTarget, installTemplatesReal, runCli, runInitCommand } from "../src/cli/commands.ts";
import { parseArgs } from "../src/cli/args.ts";
import type { Prompter } from "../src/cli/init.ts";
import type { Verifier } from "../src/cli/verify.ts";
import { repoLayout } from "../src/paths.ts";

async function tmpRepo(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "ai-sdlc-commands-test-"));
}

/** A fresh temp dir, `git init`'d so `findRepoRoot` resolves it as a toplevel. */
async function tmpGitRepo(): Promise<string> {
  const dir = await tmpRepo();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

const CANCEL = Symbol("cancel");
/** Scripted prompter: answers come off a queue in call order, no option validation. */
function scriptedPrompter(answers: unknown[]): Prompter {
  const queue = [...answers];
  const next = () => {
    if (queue.length === 0) throw new Error("scriptedPrompter ran out of answers");
    return queue.shift();
  };
  return {
    text: async () => next() as string | symbol,
    password: async () => next() as string | symbol,
    select: async () => next() as any,
    multiselect: async () => next() as any,
    confirm: async () => next() as boolean | symbol,
    note: () => {},
    log: () => {},
    isCancel: (v) => v === CANCEL,
  };
}

function fakeVerifier(): Verifier {
  return {
    slackBot: async () => ({ ok: true, team: "Acme", botName: "ai-sdlc", botUserId: "U1" }),
    slackApp: async () => ({ ok: true }),
    postTest: async () => ({ ok: true }),
    userGroups: async () => [],
    users: async () => [],
    linear: async () => ({ ok: true, viewer: "Peter", teams: [{ id: "T1", key: "ENG", name: "Engineering" }] }),
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

/** Writes a minimal valid config.json directly (bypassing `init`), as if that folder was already initialized. */
async function seedConfig(home: string, repoRoot: string): Promise<void> {
  const layout = repoLayout(home, repoRoot);
  await mkdir(layout.dir, { recursive: true });
  await writeFile(
    layout.configPath,
    JSON.stringify({
      ticketSource: "linear",
      repoPath: repoRoot,
      linearTeamId: "T1",
      linearTrigger: "poll",
      slack: { channelId: "C0ABC123", startMode: "button", roleGroups: {} },
    }),
    "utf8",
  );
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

// --- subfolder targeting -----------------------------------------------------------------

test("chooseInitTarget: target IS the toplevel — returns it without prompting", async () => {
  let promptedCalled = false;
  const prompter = scriptedPrompter([]);
  prompter.select = (async () => {
    promptedCalled = true;
    return "unused";
  }) as any;
  const result = await chooseInitTarget(prompter, "/repo", "/repo");
  assert.equal(result, "/repo");
  assert.equal(promptedCalled, false, "must not prompt when there is nothing to choose between");
});

test("chooseInitTarget: offers the current subfolder (default) and the repo top, and honors the choice", async () => {
  const selectCalls: any[] = [];
  const prompter = scriptedPrompter(["/repo"]); // choose the repo top
  prompter.select = (async (o: any) => {
    selectCalls.push(o);
    return "/repo";
  }) as any;

  const result = await chooseInitTarget(prompter, join("/repo", "apps", "web"), "/repo");

  assert.equal(result, "/repo");
  assert.equal(selectCalls.length, 1);
  assert.equal(selectCalls[0].message, "대상 폴더를 선택해 주세요");
  assert.deepEqual(
    selectCalls[0].options.map((o: any) => o.value),
    [join("/repo", "apps", "web"), "/repo"],
  );
  assert.equal(selectCalls[0].options[0].label, join("apps", "web"));
  assert.equal(selectCalls[0].options[1].label, ".");
  assert.equal(selectCalls[0].initialValue, join("/repo", "apps", "web"), "current folder is the default");
});

test("chooseInitTarget: cancelling the select returns null", async () => {
  const prompter = scriptedPrompter([CANCEL]);
  const result = await chooseInitTarget(prompter, join("/repo", "apps", "web"), "/repo");
  assert.equal(result, null);
});

test("`init --yes` from a subfolder (apps/web) saves config + installs templates there, not at the monorepo root", async (t) => {
  const root = await tmpGitRepo();
  const webDir = join(root, "apps", "web");
  await mkdir(webDir, { recursive: true });
  const home = await tmpRepo();

  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    const u = String(url);
    if (u.includes("auth.test")) return jsonResponse({ ok: true, team: "Acme", user: "ai-sdlc", user_id: "U1" });
    if (u.includes("apps.connections.open")) return jsonResponse({ ok: true });
    if (u.includes("chat.postMessage")) return jsonResponse({ ok: true });
    if (u.includes("api.linear.app")) {
      return jsonResponse({
        data: { viewer: { name: "Peter" }, teams: { nodes: [{ id: "T1", key: "ENG", name: "Engineering" }] } },
      });
    }
    throw new Error(`unexpected fetch: ${u}`);
  });

  process.env.SLACK_BOT_TOKEN = "xoxb-good";
  process.env.SLACK_APP_TOKEN = "xapp-good";
  process.env.LINEAR_API_KEY = "lin_api_good";
  try {
    const code = await runCli(["init", "--yes", "--repo", webDir, "--home", home, "--channel", "C0ABC123", "--team", "T1"]);
    assert.equal(code, 0);
  } finally {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
    delete process.env.LINEAR_API_KEY;
  }

  const expectedWebDir = realpathSync(webDir);
  const layout = repoLayout(home, expectedWebDir);
  const configRaw = JSON.parse(await readFile(layout.configPath, "utf8"));
  assert.equal(configRaw.repoPath, expectedWebDir);

  assert.ok(existsSync(join(webDir, ".claude", "CLAUDE.md")), "templates installed at apps/web");
  assert.equal(existsSync(join(root, ".claude", "CLAUDE.md")), false, "must not install templates at the monorepo root");
});

test("interactive `init` from a subfolder offers the target-folder select; choosing the repo top saves config at the root", async () => {
  const root = await tmpGitRepo();
  const webDir = join(root, "apps", "web");
  await mkdir(webDir, { recursive: true });
  const home = await tmpRepo();
  const toplevel = realpathSync(root);

  const prompter = scriptedPrompter([
    toplevel, // "대상 폴더를 선택해 주세요" -> choose the repo top
    "have",
    "xoxb-good",
    "xapp-good",
    "lin_api_good",
    "T1",
    "C0ABC123",
    false,
    "button",
    true,
  ]);

  const args = parseArgs(["init", "--repo", webDir, "--home", home]);
  const code = await runInitCommand(args, { prompter, verifier: fakeVerifier() });
  assert.equal(code, 0);

  const layout = repoLayout(home, toplevel);
  const configRaw = JSON.parse(await readFile(layout.configPath, "utf8"));
  assert.equal(configRaw.repoPath, toplevel);
  assert.ok(existsSync(join(root, ".claude", "CLAUDE.md")));
  assert.equal(existsSync(join(webDir, ".claude", "CLAUDE.md")), false);
});

test("interactive `init` from a subfolder: choosing the current folder (default) keeps repoPath as the subfolder", async () => {
  const root = await tmpGitRepo();
  const webDir = join(root, "apps", "web");
  await mkdir(webDir, { recursive: true });
  const home = await tmpRepo();
  const target = realpathSync(webDir);

  const prompter = scriptedPrompter([
    target, // "대상 폴더를 선택해 주세요" -> choose the current (sub)folder
    "have",
    "xoxb-good",
    "xapp-good",
    "lin_api_good",
    "T1",
    "C0ABC123",
    false,
    "button",
    true,
  ]);

  const args = parseArgs(["init", "--repo", webDir, "--home", home]);
  const code = await runInitCommand(args, { prompter, verifier: fakeVerifier() });
  assert.equal(code, 0);

  const layout = repoLayout(home, target);
  const configRaw = JSON.parse(await readFile(layout.configPath, "utf8"));
  assert.equal(configRaw.repoPath, target);
  assert.ok(existsSync(join(webDir, ".claude", "CLAUDE.md")));
  assert.equal(existsSync(join(root, ".claude", "CLAUDE.md")), false);
});

test("`--yes` (non-interactive) never prompts for a target folder — uses the target as-is even from a subfolder", async (t) => {
  const root = await tmpGitRepo();
  const webDir = join(root, "apps", "web");
  await mkdir(webDir, { recursive: true });
  const home = await tmpRepo();

  const args = parseArgs(["init", "--yes", "--repo", webDir, "--home", home, "--channel", "C0ABC123", "--team", "T1"]);
  let selectCalled = false;
  const prompter = scriptedPrompter([]);
  prompter.select = (async () => {
    selectCalled = true;
    return "unused";
  }) as any;

  process.env.SLACK_BOT_TOKEN = "xoxb-good";
  process.env.SLACK_APP_TOKEN = "xapp-good";
  process.env.LINEAR_API_KEY = "lin_api_good";
  try {
    const code = await runInitCommand(args, { prompter, verifier: fakeVerifier() });
    assert.equal(code, 0);
  } finally {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
    delete process.env.LINEAR_API_KEY;
  }
  assert.equal(selectCalled, false, "--yes must not prompt even though a prompter was supplied");

  const target = realpathSync(webDir);
  const layout = repoLayout(home, target);
  const configRaw = JSON.parse(await readFile(layout.configPath, "utf8"));
  assert.equal(configRaw.repoPath, target);
});

// --- walk-up config resolution (`start`/`doctor`/`config`, via resolveRepoAndHome) -------------

test("`config` run from a deeper subfolder (apps/web/src) finds the apps/web config via walk-up", async () => {
  const root = await tmpGitRepo();
  const webDir = join(root, "apps", "web");
  const webSrcDir = join(webDir, "src");
  await mkdir(webSrcDir, { recursive: true });
  const home = await tmpRepo();
  const webReal = realpathSync(webDir);
  await seedConfig(home, webReal);

  const originalLog = console.log;
  const logged: string[] = [];
  console.log = (msg?: unknown) => {
    logged.push(String(msg));
  };
  let code: number;
  try {
    code = await runCli(["config", "--repo", webSrcDir, "--home", home]);
  } finally {
    console.log = originalLog;
  }
  assert.equal(code, 0);
  assert.ok(
    logged.some((l) => l.includes(webReal)),
    `expected the apps/web repoPath in output, got ${JSON.stringify(logged)}`,
  );
});

test("`config` from an uninitialized sibling folder (apps/api) falls back to the target and prints init guidance", async () => {
  const root = await tmpGitRepo();
  const webDir = join(root, "apps", "web");
  const apiDir = join(root, "apps", "api");
  await mkdir(webDir, { recursive: true });
  await mkdir(apiDir, { recursive: true });
  const home = await tmpRepo();
  await seedConfig(home, realpathSync(webDir));

  const originalLog = console.log;
  const logged: string[] = [];
  console.log = (msg?: unknown) => {
    logged.push(String(msg));
  };
  let code: number;
  try {
    code = await runCli(["config", "--repo", apiDir, "--home", home]);
  } finally {
    console.log = originalLog;
  }
  assert.equal(code, 0);
  assert.ok(
    logged.some((l) => l.includes("설정 없음")),
    `expected init guidance, got ${JSON.stringify(logged)}`,
  );
});

test("`config` at the git toplevel behaves as before (unchanged)", async () => {
  const root = await tmpGitRepo();
  const home = await tmpRepo();
  const rootReal = realpathSync(root);
  await seedConfig(home, rootReal);

  const originalLog = console.log;
  const logged: string[] = [];
  console.log = (msg?: unknown) => {
    logged.push(String(msg));
  };
  let code: number;
  try {
    code = await runCli(["config", "--repo", root, "--home", home]);
  } finally {
    console.log = originalLog;
  }
  assert.equal(code, 0);
  assert.ok(logged.some((l) => l.includes(rootReal)));
});
