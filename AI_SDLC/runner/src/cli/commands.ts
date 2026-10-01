import { readFileSync, existsSync, mkdirSync, chmodSync, copyFileSync } from "node:fs";
import { execFile as execFileCb, spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import * as clack from "@clack/prompts";
import { parseArgs, type ParsedArgs } from "./args.ts";
import { createVerifier, type Verifier } from "./verify.ts";
import { runInit, runInitNonInteractive, type Prompter } from "./init.ts";
import { runDoctor, formatChecks, type DoctorDeps } from "./doctor.ts";
import {
  bundledPluginDir,
  manifestPath,
  defaultHome,
  repoLayout,
  findRepoRoot,
  resolveProjectDir,
  resolveRealPath,
  walkUpTo,
} from "../paths.ts";
import { readCredentials, readUserConfig, maskToken, type Credentials } from "../user-config.ts";
import { loadConfig } from "../config.ts";
import { startServer } from "../index.ts";

const execFileAsync = promisify(execFileCb);

/** Adapts @clack/prompts' free functions to the injectable `Prompter` interface. */
const clackPrompter: Prompter = {
  text: (o) => clack.text(o),
  password: (o) => clack.password(o),
  // `clack.select`'s `Option<Value>` is a conditional type that only resolves once `Value` is a
  // concrete type; against our generic `Prompter.select<T>`, TS can't distribute it, so the call
  // is routed through `any` here — the concrete call sites in init.ts stay fully typed.
  select: (o) => (clack.select as any)(o),
  // Same `any` routing as `select` above — `clack.multiselect`'s `Option<Value>` can't
  // distribute against our generic `Prompter.multiselect<T>` either.
  multiselect: (o) => (clack.multiselect as any)(o),
  confirm: (o) => clack.confirm(o),
  note: (msg, title) => clack.note(msg, title),
  log: (msg) => clack.log.message(msg),
  isCancel: (v) => clack.isCancel(v),
};

/**
 * Like `execFile`, but pipes `input` to the child's stdin and closes it. Node's async `execFile`
 * (unlike `execFileSync`) has no `input` option, so this spawns directly — the same pattern as
 * `runEgoBrowserScript` in `../e2e.ts`, duplicated here so `doctor`'s ego-browser readiness check
 * can go through the injectable, testable `exec` dependency instead of a bare `spawn` call.
 */
function execFileWithInput(cmd: string, args: string[], input: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (err) => resolvePromise({ code: 127, stdout, stderr: stderr || (err as Error).message }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** Runs a command and normalizes both success and non-zero-exit failure into one shape. */
async function execFile(
  cmd: string,
  args: string[],
  opts?: { input?: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (opts?.input !== undefined) return execFileWithInput(cmd, args, opts.input);
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e.message ?? err) };
  }
}

function emptyCredentials(): Credentials {
  return {};
}

/**
 * Copies templates from `bundledPluginDir()/templates` into the target repo, skipping any file
 * that already exists there. Returns the repo-relative paths it actually installed.
 */
export async function installTemplatesReal(repoRoot: string): Promise<string[]> {
  const templatesDir = join(bundledPluginDir(), "templates");
  const installed: string[] = [];

  const copyIfMissing = (src: string, destRel: string, mode?: number): void => {
    const dest = join(repoRoot, destRel);
    if (existsSync(dest)) return;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    if (mode) chmodSync(dest, mode);
    installed.push(destRel);
  };

  copyIfMissing(join(templatesDir, "CLAUDE.md.template"), join(".claude", "CLAUDE.md"));
  copyIfMissing(join(templatesDir, "REVIEW.md"), "REVIEW.md");
  copyIfMissing(join(templatesDir, "ops", "bands.yaml"), "ops/bands.yaml");
  copyIfMissing(join(templatesDir, "ops", "detect.sh"), "ops/detect.sh", 0o755);

  return installed;
}

const HELP_TEXT = `ai-sdlc-runner — 로컬 AI-SDLC 러너

사용법:
  ai-sdlc-runner init [--repo <path>] [--home <dir>] [--yes] [--channel <id>] [--team <id>]
  ai-sdlc-runner start [--repo <path>] [--home <dir>] [--skip-checks]
  ai-sdlc-runner doctor [--repo <path>] [--home <dir>]
  ai-sdlc-runner manifest [--open]
  ai-sdlc-runner config [--repo <path>] [--home <dir>]
  ai-sdlc-runner help

전역 옵션:
  --repo <path>   대상 저장소 (기본: 현재 폴더)
  --home <dir>    설정 폴더 (기본: ~/.ai-sdlc, 또는 AI_SDLC_HOME)
`;

function runHelp(): number {
  console.log(HELP_TEXT);
  return 0;
}

function runManifest(args: ParsedArgs): number {
  console.log(readFileSync(manifestPath(), "utf8"));
  if (args.open) {
    const url = "https://api.slack.com/apps?new_app=1";
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    try {
      spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
    } catch {
      console.log(`브라우저를 열지 못했습니다 — 다음 주소를 직접 열어 주세요: ${url}`);
    }
  }
  return 0;
}

/**
 * Starting from the resolved target folder, walks UP to (and including) the git toplevel and
 * picks the first folder that already has a saved config — so `start`/`doctor`/`config` work from
 * any subfolder of an initialized project, not just the exact folder `init` was run from. Falls
 * back to the target itself (not the toplevel) when nothing is found, so the existing "설정을 찾을
 * 수 없다 … init" guidance still fires for an uninitialized folder.
 */
function resolveRepoAndHome(args: ParsedArgs): { repoRoot: string | null; home: string } {
  const home = args.home ?? defaultHome();
  const target = resolveProjectDir(args.repo);
  const toplevel = findRepoRoot(target);
  if (!toplevel) return { repoRoot: null, home };
  const toplevelReal = resolveRealPath(toplevel);
  for (const dir of walkUpTo(target, toplevelReal)) {
    if (existsSync(repoLayout(home, dir).configPath)) return { repoRoot: dir, home };
  }
  return { repoRoot: target, home };
}

/**
 * Interactive-init-only: when the target folder isn't the git toplevel, asks which one `repoPath`
 * should be — the current (sub)folder, labeled with its path relative to the toplevel, or the
 * repository top (`.`). Returns `null` on cancel. Skips the prompt entirely (returns `target`)
 * when the target already IS the toplevel — nothing to choose between.
 */
export async function chooseInitTarget(prompter: Prompter, target: string, toplevel: string): Promise<string | null> {
  if (target === toplevel) return target;
  const relTarget = relative(toplevel, target) || ".";
  const choice = await prompter.select<string>({
    message: "대상 폴더를 선택해 주세요",
    options: [
      { value: target, label: relTarget, hint: "현재 폴더" },
      { value: toplevel, label: ".", hint: "저장소 최상위" },
    ],
    initialValue: target,
  });
  if (prompter.isCancel(choice)) return null;
  return choice as string;
}

export async function runInitCommand(
  args: ParsedArgs,
  deps: { prompter?: Prompter; verifier?: Verifier } = {},
): Promise<number> {
  const home = args.home ?? defaultHome();
  const target = resolveProjectDir(args.repo);
  const toplevel = findRepoRoot(target);
  if (!toplevel) {
    console.error("git 저장소 안에서 실행해 주세요 — 러너가 티켓마다 worktree를 만듭니다.");
    return 1;
  }
  const toplevelReal = resolveRealPath(toplevel);
  const verifier = deps.verifier ?? createVerifier();

  if (args.yes) {
    const result = await runInitNonInteractive({
      repoRoot: target,
      home,
      verifier,
      installTemplates: installTemplatesReal,
      env: process.env,
      channel: args.channel,
      team: args.team,
    });
    if (!result.saved) {
      console.error("초기화에 실패했습니다:");
      for (const e of result.errors) console.error(`  - ${e}`);
      return 1;
    }
    console.log("초기화가 완료되었습니다. `npx ai-sdlc-runner start` 로 러너를 시작해 주세요.");
    return 0;
  }

  clack.intro("ai-sdlc-runner init");
  const prompter = deps.prompter ?? clackPrompter;
  const repoRoot = await chooseInitTarget(prompter, target, toplevelReal);
  if (repoRoot === null) {
    clack.cancel("설정을 저장하지 않았습니다.");
    return 1;
  }
  const result = await runInit({ prompter, verifier, repoRoot, home, installTemplates: installTemplatesReal });
  if (!result.saved) {
    clack.cancel("설정을 저장하지 않았습니다.");
    return 1;
  }
  clack.outro("초기화가 완료되었습니다. `npx ai-sdlc-runner start` 로 러너를 시작해 주세요.");
  return 0;
}

async function buildDoctorDeps(args: ParsedArgs): Promise<{ deps: DoctorDeps; repoRoot: string | null }> {
  const { repoRoot, home } = resolveRepoAndHome(args);
  const verifier = createVerifier();
  if (!repoRoot) {
    return { deps: { exec: execFile, verifier, repoRoot: null, config: null, credentials: emptyCredentials() }, repoRoot: null };
  }
  const layout = repoLayout(home, repoRoot);
  const config = await readUserConfig(layout.configPath);
  const credentials = await readCredentials(layout.credentialsPath, (msg) => console.error(msg));
  return { deps: { exec: execFile, verifier, repoRoot, config, credentials }, repoRoot };
}

async function runDoctorCommand(args: ParsedArgs): Promise<number> {
  const { deps } = await buildDoctorDeps(args);
  const checks = await runDoctor(deps);
  console.log(formatChecks(checks));
  return checks.some((c) => !c.ok && c.blocking) ? 1 : 0;
}

async function runStart(args: ParsedArgs): Promise<number | null> {
  const { repoRoot, home } = resolveRepoAndHome(args);
  if (!repoRoot) {
    console.error("설정을 찾을 수 없습니다. 먼저 `npx ai-sdlc-runner init` 을 실행해 주세요.");
    return 1;
  }
  const layout = repoLayout(home, repoRoot);
  const fileConfig = await readUserConfig(layout.configPath);
  if (!fileConfig) {
    console.error("설정을 찾을 수 없습니다. 먼저 `npx ai-sdlc-runner init` 을 실행해 주세요.");
    return 1;
  }
  const credentials = await readCredentials(layout.credentialsPath, (msg) => console.error(msg));

  if (!args.skipChecks) {
    const verifier = createVerifier();
    const checks = await runDoctor({ exec: execFile, verifier, repoRoot, config: fileConfig, credentials });
    console.log(formatChecks(checks));
    if (checks.some((c) => !c.ok && c.blocking)) {
      console.error("점검에 실패했습니다 — 문제를 해결하거나 --skip-checks 옵션으로 건너뛰어 주세요.");
      return 1;
    }
  }

  const config = loadConfig({ env: process.env, repo: repoRoot, home, credentials, fileConfig });
  startServer(config);
  // The HTTP server and Slack socket keep the event loop alive; returning a number here would make
  // the entry point process.exit() and kill the runner right after it started.
  return null;
}

async function runConfigCommand(args: ParsedArgs): Promise<number> {
  const { repoRoot, home } = resolveRepoAndHome(args);
  if (!repoRoot) {
    console.log("설정 없음 — `npx ai-sdlc-runner init` 을 실행해 주세요.");
    return 0;
  }
  const layout = repoLayout(home, repoRoot);
  const fileConfig = await readUserConfig(layout.configPath);
  if (!fileConfig) {
    console.log("설정 없음 — `npx ai-sdlc-runner init` 을 실행해 주세요.");
    return 0;
  }
  console.log(JSON.stringify(fileConfig, null, 2));
  const credentials = await readCredentials(layout.credentialsPath, (msg) => console.error(msg));
  console.log("토큰:");
  console.log(`  slackBotToken: ${maskToken(credentials.slackBotToken)}`);
  console.log(`  slackAppToken: ${maskToken(credentials.slackAppToken)}`);
  console.log(`  linearApiKey: ${maskToken(credentials.linearApiKey)}`);
  return 0;
}

/**
 * Exit code for the process, or `null` when the command started a long-running server
 * (`start`) and the process must stay alive — the entry point must not call process.exit then.
 */
export async function runCli(argv: string[]): Promise<number | null> {
  const args = parseArgs(argv);
  switch (args.command) {
    case "help":
      return runHelp();
    case "manifest":
      return runManifest(args);
    case "config":
      return runConfigCommand(args);
    case "init":
      return runInitCommand(args);
    case "doctor":
      return runDoctorCommand(args);
    case "start":
      return runStart(args);
    default:
      return runHelp();
  }
}
