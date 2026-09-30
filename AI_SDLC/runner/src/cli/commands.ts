import { readFileSync, existsSync, mkdirSync, chmodSync, copyFileSync } from "node:fs";
import { execFile as execFileCb, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import * as clack from "@clack/prompts";
import { parseArgs, type ParsedArgs } from "./args.ts";
import { createVerifier } from "./verify.ts";
import { runInit, runInitNonInteractive, type Prompter } from "./init.ts";
import { runDoctor, formatChecks, type DoctorDeps } from "./doctor.ts";
import { bundledPluginDir, manifestPath, defaultHome, repoLayout, findRepoRoot } from "../paths.ts";
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
  confirm: (o) => clack.confirm(o),
  note: (msg, title) => clack.note(msg, title),
  log: (msg) => clack.log.message(msg),
  isCancel: (v) => clack.isCancel(v),
};

/** Runs a command and normalizes both success and non-zero-exit failure into one shape. */
async function execFile(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
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

  copyIfMissing(join(templatesDir, "CLAUDE.md.template"), "CLAUDE.md");
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
      console.log(`브라우저를 열지 못했다 — 직접 열어라: ${url}`);
    }
  }
  return 0;
}

function resolveRepoAndHome(args: ParsedArgs): { repoRoot: string | null; home: string } {
  const home = args.home ?? defaultHome();
  const cwd = args.repo ? resolve(args.repo) : process.cwd();
  const repoRoot = findRepoRoot(cwd);
  return { repoRoot, home };
}

async function runInitCommand(args: ParsedArgs): Promise<number> {
  const home = args.home ?? defaultHome();
  const cwd = args.repo ? resolve(args.repo) : process.cwd();
  const repoRoot = findRepoRoot(cwd) ?? cwd;
  const verifier = createVerifier();

  if (args.yes) {
    const result = await runInitNonInteractive({
      repoRoot,
      home,
      verifier,
      installTemplates: installTemplatesReal,
      env: process.env,
      channel: args.channel,
      team: args.team,
    });
    if (!result.saved) {
      console.error("초기화 실패:");
      for (const e of result.errors) console.error(`  - ${e}`);
      return 1;
    }
    console.log("초기화 완료. `npx ai-sdlc-runner start` 로 러너를 시작한다.");
    return 0;
  }

  clack.intro("ai-sdlc-runner init");
  const result = await runInit({ prompter: clackPrompter, verifier, repoRoot, home, installTemplates: installTemplatesReal });
  if (!result.saved) {
    clack.cancel("설정을 저장하지 않았다.");
    return 1;
  }
  clack.outro("초기화 완료. `npx ai-sdlc-runner start` 로 러너를 시작한다.");
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

async function runStart(args: ParsedArgs): Promise<number> {
  const { repoRoot, home } = resolveRepoAndHome(args);
  if (!repoRoot) {
    console.error("설정을 찾을 수 없다. 먼저 `npx ai-sdlc-runner init` 을 실행한다.");
    return 1;
  }
  const layout = repoLayout(home, repoRoot);
  const fileConfig = await readUserConfig(layout.configPath);
  if (!fileConfig) {
    console.error("설정을 찾을 수 없다. 먼저 `npx ai-sdlc-runner init` 을 실행한다.");
    return 1;
  }
  const credentials = await readCredentials(layout.credentialsPath, (msg) => console.error(msg));

  if (!args.skipChecks) {
    const verifier = createVerifier();
    const checks = await runDoctor({ exec: execFile, verifier, repoRoot, config: fileConfig, credentials });
    console.log(formatChecks(checks));
    if (checks.some((c) => !c.ok && c.blocking)) {
      console.error("점검 실패 — 문제를 고치거나 --skip-checks 로 건너뛴다.");
      return 1;
    }
  }

  const config = loadConfig({ env: process.env, repo: repoRoot, home, credentials, fileConfig });
  startServer(config);
  return 0;
}

async function runConfigCommand(args: ParsedArgs): Promise<number> {
  const { repoRoot, home } = resolveRepoAndHome(args);
  if (!repoRoot) {
    console.log("설정 없음 — `npx ai-sdlc-runner init` 을 실행한다.");
    return 0;
  }
  const layout = repoLayout(home, repoRoot);
  const fileConfig = await readUserConfig(layout.configPath);
  if (!fileConfig) {
    console.log("설정 없음 — `npx ai-sdlc-runner init` 을 실행한다.");
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

export async function runCli(argv: string[]): Promise<number> {
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
