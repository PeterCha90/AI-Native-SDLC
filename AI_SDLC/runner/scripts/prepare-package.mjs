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

async function main() {
  if (!existsSync(sourcePluginDir)) {
    console.error(`prepare-package: plugin source not found at ${sourcePluginDir}`);
    process.exit(1);
  }

  await rm(targetPluginDir, { recursive: true, force: true });
  await cp(sourcePluginDir, targetPluginDir, { recursive: true });
  console.log(`prepare-package: copied ${sourcePluginDir} -> ${targetPluginDir}`);

  if (existsSync(cliPath)) {
    await chmod(cliPath, 0o755);
    console.log(`prepare-package: chmod 755 ${cliPath}`);
  } else {
    console.warn(`prepare-package: ${cliPath} not found yet, skipping chmod (build src/cli.ts first)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
