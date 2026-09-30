#!/usr/bin/env node
import { runCli } from "./cli/commands.ts";

try {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`오류: ${message}`);
  if (process.env.AI_SDLC_DEBUG === "1" && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
