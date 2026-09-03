import { spawn } from "node:child_process";
import type { E2EDriverKind } from "./config.ts";

export interface E2EResult {
  ok: boolean;
  output: string;
}

function runEgoBrowserScript(script: string, timeoutMs: number): Promise<{ exitCode: number | null; combined: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("ego-browser", ["nodejs"]);
    let combined = "";
    // cliLog() writes to stderr, not stdout — capture both and merge, matching `2>&1`.
    child.stdout.on("data", (chunk: Buffer) => (combined += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (combined += chunk.toString("utf8")));

    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    timer.unref?.();

    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: null, combined: `ego-browser spawn error: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, combined });
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

/** `printf 'cliLog("ok")\n' | ego-browser nodejs 2>&1` should print "ok" if the CLI has completed onboarding. */
export async function checkEgoLiteReady(): Promise<boolean> {
  const { combined } = await runEgoBrowserScript('cliLog("ok")\n', 15_000);
  return combined.includes("ok") && !combined.includes("onboarding");
}

async function runEgoLite(url: string, timeoutSec: number): Promise<E2EResult> {
  const script = `
const task = await useOrCreateTaskSpace('e2e review')
await openOrReuseTab('${url}', { wait: true, timeout: ${timeoutSec} })
cliLog(await snapshotText())
`;
  const { exitCode, combined } = await runEgoBrowserScript(script, (timeoutSec + 15) * 1000);
  const ok = exitCode === 0 && !combined.includes("onboarding process");
  return { ok, output: combined };
}

/** `aside repl` requires a TTY, which a headless pipeline stage doesn't have. Left unimplemented on purpose. */
async function runAside(_url: string, _timeoutSec: number): Promise<E2EResult> {
  throw new Error(
    "not implemented: `aside repl` requires an interactive TTY and cannot run headless. " +
      "Wire a non-interactive Aside invocation here if/when one exists.",
  );
}

export async function runE2E(driver: E2EDriverKind, url: string, timeoutSec = 20): Promise<E2EResult> {
  if (driver === "ego-lite") return runEgoLite(url, timeoutSec);
  return runAside(url, timeoutSec);
}
