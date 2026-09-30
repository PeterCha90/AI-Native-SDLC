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
  /** When set, resumes this existing session (`--resume <id>`) instead of starting a new one with `--session-id`. */
  resumeSessionId?: string;
}

export interface StageResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** Absolute path to the JSONL session transcript, kept for debugging, or null if it was never found. */
  sessionJsonlPath: string | null;
  /** The session ID this run used — `resumeSessionId` when resuming, otherwise the freshly generated one. */
  sessionId: string;
  error?: string;
}

/**
 * Pure arg-builder for `claude -p`, split out of `runStage` so the resume/new-session branching
 * can be tested without spawning a process. `sessionId` is the freshly generated ID to use for a
 * new session; it's ignored (in favor of `opts.resumeSessionId`) when resuming.
 */
export function buildClaudeArgs(opts: RunStageOptions, sessionId: string): string[] {
  const args = ["-p", opts.prompt, "--output-format", "stream-json", "--verbose"];
  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  } else {
    args.push("--session-id", sessionId);
  }
  args.push("--permission-mode", opts.permissionMode ?? "bypassPermissions");
  if (opts.allowedTools?.length) {
    args.push("--allowedTools", opts.allowedTools.join(" "));
  }
  // Loads the plugin for this session only, so a stage gets the sdlc-* skills, the
  // hook layer and the subagents without the repo having to install anything first.
  if (opts.pluginDir) {
    args.push("--plugin-dir", opts.pluginDir);
  }
  return args;
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
  const generatedSessionId = randomUUID();
  // The session ID this run actually uses: the resumed one when resuming, otherwise the freshly
  // generated one. Also what we look up the JSONL transcript by, since Claude Code keeps writing
  // a resumed session's transcript under its original session ID.
  const sessionId = opts.resumeSessionId ?? generatedSessionId;
  const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;
  const args = buildClaudeArgs(opts, generatedSessionId);

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
        sessionId,
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
        sessionId,
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
        sessionId,
      });
    });
  });

  return result;
}
