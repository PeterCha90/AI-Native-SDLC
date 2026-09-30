#!/usr/bin/env node
// Runs as part of `prepack` (after `npm run build`). Copies the sibling
// AI_SDLC/plugin/ folder into runner/plugin/ so it ships inside the npm
// package's `files` list, and makes dist/cli.js executable so the
// package's `bin` entries work once installed.
import { existsSync } from "node:fs";
import { cp, chmod, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const runnerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourcePluginDir = path.join(runnerDir, "..", "plugin");
const targetPluginDir = path.join(runnerDir, "plugin");
const cliPath = path.join(runnerDir, "dist", "cli.js");

// NOTE: this script runs as part of `npm pack --json` (via the `prepack`
// lifecycle script), and npm captures that command's stdout as the JSON
// result. Every message here MUST go to stderr — never console.log/stdout —
// or it corrupts the JSON that `npm pack --json` callers (e.g. smoke-pack.mjs)
// parse from stdout.
async function main() {
  if (!existsSync(sourcePluginDir)) {
    console.error(`prepare-package: plugin source not found at ${sourcePluginDir}`);
    process.exit(1);
  }

  await rm(targetPluginDir, { recursive: true, force: true });
  await cp(sourcePluginDir, targetPluginDir, { recursive: true });
  console.error(`prepare-package: copied ${sourcePluginDir} -> ${targetPluginDir}`);

  if (!existsSync(cliPath)) {
    console.error(`prepare-package: ${cliPath} not found — run \`npm run build\` first (src/cli.ts must exist and compile)`);
    process.exit(1);
  }
  await chmod(cliPath, 0o755);
  console.error(`prepare-package: chmod 755 ${cliPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
