import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RunStageOptions {
  /** The prompt handed to `claude -p`. */
  prompt: string;
  /** Working directory Claude Code runs in (also what selects the ~/.claude/projects/<slug> dir). */
  cwd: string;
  /** Tool names passed to --allowedTools, e.g. ["Read", "Write", "Bash(git *)"]. */
  allowedTools?: string[];
  /** Plugin loaded for this session only (--plugin-dir). Carries the sdlc-* skills, hooks and subagents. */
  pluginDir?: string;
  /** Default 20 minutes. The process is killed (SIGTERM, then SIGKILL) past this. */
  timeoutMs?: number;
  /** Default "bypassPermissions" — this runner is unattended, there's no one to answer prompts. */
  permissionMode?: string;
}

export interface StageResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** Absolute path to the JSONL session transcript, kept for debugging, or null if it was never found. */
  sessionJsonlPath: string | null;
  error?: string;
}

/** `/Users/x/y` -> `-Users-x-y`, matching Claude Code's ~/.claude/projects/<slug> naming. */
export function projectSlug(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

export function sessionsDirFor(cwd: string): string {
  return join(homedir(), ".claude", "projects", projectSlug(cwd));
}

/** Runs one pipeline stage as a headless `claude -p` session. Never throws — failures come back as ok:false. */
export async function runStage(opts: RunStageOptions): Promise<StageResult> {
  const sessionId = randomUUID();
  const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;
  const args = ["-p", opts.prompt, "--output-format", "stream-json", "--verbose", "--session-id", sessionId, "--permission-mode", opts.permissionMode ?? "bypassPermissions"];
  if (opts.allowedTools?.length) {
    args.push("--allowedTools", opts.allowedTools.join(" "));
  }
  // Loads the plugin for this session only, so a stage gets the sdlc-* skills, the
  // hook layer and the subagents without the repo having to install anything first.
  if (opts.pluginDir) {
    args.push("--plugin-dir", opts.pluginDir);
  }

  const result = await new Promise<StageResult>((resolvePromise) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn("claude", args, { cwd: opts.cwd });
    } catch (err) {
      resolvePromise({
        ok: false,
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        sessionJsonlPath: null,
        error: `failed to spawn claude: ${(err as Error).message}`,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    killTimer.unref?.();

    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolvePromise({
        ok: false,
        exitCode: null,
        timedOut,
        stdout,
        stderr,
        sessionJsonlPath: null,
        error: `claude process error: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      const sessionJsonlPath = join(sessionsDirFor(opts.cwd), `${sessionId}.jsonl`);
      resolvePromise({
        ok: !timedOut && code === 0,
        exitCode: code,
        timedOut,
        stdout,
        stderr,
        sessionJsonlPath: existsSync(sessionJsonlPath) ? sessionJsonlPath : null,
      });
    });
  });

  return result;
}
