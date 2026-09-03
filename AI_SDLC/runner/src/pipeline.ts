import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Config } from "./config.ts";
import type { Ticket, TicketSource } from "./adapters/types.ts";
import { runStage, type StageResult } from "./claude.ts";
import { runE2E } from "./e2e.ts";

const DEPTH_MARKER = /sdlc-depth:\s*(\d+)/i;

/** Reads the `sdlc-depth: N` marker embedded in an auto-generated ticket's body. Absent = depth 0 (a human-created ticket). */
export function extractDepth(ticket: Pick<Ticket, "body">): number {
  const match = ticket.body.match(DEPTH_MARKER);
  return match ? Number(match[1]) : 0;
}

/**
 * The loop-closing guard: only create a follow-up ticket from a ticket that
 * carries the auto label, and only while we're below the configured depth.
 * A human-authored ticket (no auto label) never counts against the depth.
 */
export function shouldCreateFollowupTicket(ticket: Ticket, autoTicketLabel: string, maxAutoTicketDepth: number): boolean {
  if (!ticket.labels.includes(autoTicketLabel)) return true;
  return extractDepth(ticket) < maxAutoTicketDepth;
}

interface StageLogEntry {
  stage: string;
  startedAt: string;
  endedAt: string;
  ok: boolean;
  sessionJsonlPath: string | null;
  note?: string;
}

async function appendStateLog(runnerDir: string, key: string, entry: StageLogEntry): Promise<void> {
  const stateDir = join(runnerDir, ".state");
  await mkdir(stateDir, { recursive: true });
  const statePath = join(stateDir, `${key}.json`);
  let log: StageLogEntry[] = [];
  if (existsSync(statePath)) {
    try {
      log = JSON.parse(await readFile(statePath, "utf8"));
    } catch {
      log = [];
    }
  }
  log.push(entry);
  await writeFile(statePath, JSON.stringify(log, null, 2));
}

async function runAndLog(
  runnerDir: string,
  key: string,
  stage: string,
  prompt: string,
  cwd: string,
  allowedTools?: string[],
): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  console.log(`[pipeline:${key}] ${stage} starting`);
  const result = await runStage({ prompt, cwd, allowedTools });
  await appendStateLog(runnerDir, key, {
    stage,
    startedAt,
    endedAt: new Date().toISOString(),
    ok: result.ok,
    sessionJsonlPath: result.sessionJsonlPath,
    note: result.error,
  });
  console.log(
    `[pipeline:${key}] ${stage} ${result.ok ? "ok" : "FAILED"}${result.sessionJsonlPath ? ` — zoe ${result.sessionJsonlPath} --follow` : ""}`,
  );
  return result;
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd });
    let output = "";
    child.stdout?.on("data", (c: Buffer) => (output += c.toString("utf8")));
    child.stderr?.on("data", (c: Buffer) => (output += c.toString("utf8")));
    child.on("error", (err) => resolvePromise({ ok: false, output: `${cmd} spawn error: ${err.message}` }));
    child.on("close", (code) => resolvePromise({ ok: code === 0, output }));
  });
}

async function detectTestCommand(repoDir: string): Promise<[string, string[]] | null> {
  const pkgPath = join(repoDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      if (pkg.scripts?.test) return ["npm", ["test", "--silent"]];
    } catch {
      // fall through to other detectors
    }
  }
  if (existsSync(join(repoDir, "pytest.ini")) || existsSync(join(repoDir, "pyproject.toml"))) {
    return ["pytest", ["-q"]];
  }
  return null;
}

export async function runPipeline(ticket: Ticket, config: Config, source: TicketSource, runnerDir: string): Promise<void> {
  const key = ticket.key || ticket.id;
  const repoRoot = config.repoPath;
  const docsIntent = join(repoRoot, "docs", "intent", `${key}.md`);
  const docsSpec = join(repoRoot, "docs", "spec", `${key}.md`);
  const docsPlan = join(repoRoot, "docs", "plan", `${key}.md`);
  await mkdir(join(repoRoot, "docs", "intent"), { recursive: true });
  await mkdir(join(repoRoot, "docs", "spec"), { recursive: true });
  await mkdir(join(repoRoot, "docs", "plan"), { recursive: true });

  // 01 intent
  await runAndLog(
    runnerDir,
    key,
    "01-intent",
    `Read the following ticket and write a clear, machine-actionable intent document to ${docsIntent}. ` +
      `Ticket: ${ticket.title}\n\n${ticket.body}\n\nSource: ${ticket.url}`,
    repoRoot,
    ["Read", "Write"],
  );

  // 02 spec
  await runAndLog(
    runnerDir,
    key,
    "02-spec",
    `Read ${docsIntent} and write a technical spec to ${docsSpec}.`,
    repoRoot,
    ["Read", "Write"],
  );

  // 03 build (optionally in a worktree)
  let buildDir = repoRoot;
  let branch: string | null = null;
  if (config.useWorktree) {
    branch = `sdlc/${key}`;
    buildDir = resolve(runnerDir, ".worktrees", key);
    await mkdir(resolve(runnerDir, ".worktrees"), { recursive: true });
    if (!existsSync(buildDir)) {
      await runCommand("git", ["worktree", "add", "-b", branch, buildDir], repoRoot);
    }
  }
  await runAndLog(
    runnerDir,
    key,
    "03-build",
    `Read ${docsSpec} (spec) and implement it. Write your plan to ${docsPlan} before editing code.`,
    buildDir,
    ["Read", "Write", "Edit", "Bash"],
  );

  // 04 test
  const testCmd = await detectTestCommand(buildDir);
  const unitResult = testCmd ? await runCommand(testCmd[0], testCmd[1], buildDir) : { ok: true, output: "no test command detected, skipped" };
  const e2eResult = await runE2E(config.e2eDriver, config.demoAppUrl).catch((err: Error) => ({ ok: false, output: err.message }));
  const testOk = unitResult.ok && e2eResult.ok;
  await appendStateLog(runnerDir, key, {
    stage: "04-test",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    ok: testOk,
    sessionJsonlPath: null,
    note: `unit: ${unitResult.ok ? "ok" : "fail"}; e2e: ${e2eResult.ok ? "ok" : "fail"}`,
  });
  console.log(`[pipeline:${key}] 04-test ${testOk ? "ok" : "FAILED"}`);

  // 05 deploy — PR only, no production gate
  let deployOk = false;
  let deployOutput = "";
  if (testOk && branch) {
    const pr = await runCommand("gh", ["pr", "create", "--fill", "--head", branch], buildDir);
    deployOk = pr.ok;
    deployOutput = pr.output;
  } else if (testOk) {
    deployOutput = "useWorktree=false: no dedicated branch, skipping PR creation";
    deployOk = true;
  } else {
    deployOutput = "skipped: 04-test failed";
  }
  await appendStateLog(runnerDir, key, {
    stage: "05-deploy",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    ok: deployOk,
    sessionJsonlPath: null,
    note: deployOutput.slice(0, 2000),
  });
  console.log(`[pipeline:${key}] 05-deploy ${deployOk ? "ok" : "FAILED"}`);

  // 06 maintain — judge, and close the loop on failure
  const pipelineOk = testOk && deployOk;
  if (!pipelineOk) {
    const summary = [
      `04-test: ${testOk ? "ok" : "FAILED"} (unit ${unitResult.ok ? "ok" : "fail"}, e2e ${e2eResult.ok ? "ok" : "fail"})`,
      `05-deploy: ${deployOk ? "ok" : "FAILED"}`,
      "",
      "unit/e2e output (truncated):",
      (unitResult.output + "\n" + e2eResult.output).slice(0, 1500),
    ].join("\n");

    if (shouldCreateFollowupTicket(ticket, config.autoTicketLabel, config.maxAutoTicketDepth)) {
      const depth = extractDepth(ticket) + 1;
      const newTicket = await source.createTicket({
        title: `[auto] fix: ${ticket.title}`,
        body: `Automated failure from the AI-SDLC pipeline on ${ticket.url}.\n\nsdlc-depth: ${depth}\n\n${summary}`,
        labels: [config.autoTicketLabel],
      });
      await appendStateLog(runnerDir, key, {
        stage: "06-maintain",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        ok: false,
        sessionJsonlPath: null,
        note: `created follow-up ticket ${newTicket.key} (${newTicket.url})`,
      });
      console.log(`[pipeline:${key}] 06-maintain: pipeline failed, opened follow-up ticket ${newTicket.key}`);
    } else {
      await source.comment(ticket.id, `AI-SDLC pipeline failed but the auto-ticket depth limit (${config.maxAutoTicketDepth}) was reached; not opening another ticket.\n\n${summary}`);
      await appendStateLog(runnerDir, key, {
        stage: "06-maintain",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        ok: false,
        sessionJsonlPath: null,
        note: "loop depth limit reached, follow-up ticket suppressed",
      });
      console.log(`[pipeline:${key}] 06-maintain: depth limit reached, not creating a follow-up ticket`);
    }
  } else {
    await appendStateLog(runnerDir, key, {
      stage: "06-maintain",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      ok: true,
      sessionJsonlPath: null,
      note: "pipeline succeeded",
    });
    console.log(`[pipeline:${key}] 06-maintain: pipeline succeeded`);
  }
}
