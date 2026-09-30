import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileConfig } from "./config.ts";
import { writeJsonAtomic } from "./fs-atomic.ts";

/** The three secrets `init` collects, kept out of `config.json` and out of git entirely. */
export interface Credentials {
  slackBotToken?: string;
  slackAppToken?: string;
  linearApiKey?: string;
  linearWebhookSecret?: string;
}

/**
 * Reads `credentials.json`. Missing file reads as `{}` (a fresh repo before `init`), never an
 * error. A file readable by group/other (looser than 600) is a real leak risk on a shared
 * machine — this warns once (via `log`, if given) and corrects the mode to 600 before returning,
 * the same "warn then fix" shape §7 of the design describes for a stale credentials file.
 */
export async function readCredentials(path: string, log?: (message: string) => void): Promise<Credentials> {
  if (!existsSync(path)) return {};

  const info = await stat(path);
  const mode = info.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    log?.(`[user-config] ${path} 권한이 600보다 넓다 (${mode.toString(8)}) — 600으로 고친다.`);
    await chmod(path, 0o600);
  }

  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw) as Credentials;
  } catch (err) {
    throw new Error(`failed to parse ${path}: ${(err as Error).message}`);
  }
}

/**
 * Writes `credentials.json` via tmp+rename (same atomicity as `writeJsonAtomic`), but — unlike
 * it — locks the file down to 600 and its parent folder to 700 on every write, since this is the
 * one file on disk holding raw Slack/Linear secrets (design §4/§7).
 */
export async function writeCredentials(path: string, credentials: Credentials): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);

  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(credentials, null, 2), { encoding: "utf8", mode: 0o600 });
  await chmod(tmpPath, 0o600);
  await rename(tmpPath, path);
}

/** Reads `config.json` (non-secret settings). `null` when it doesn't exist yet — never an error. */
export async function readUserConfig(path: string): Promise<FileConfig | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw) as FileConfig;
  } catch (err) {
    throw new Error(`failed to parse ${path}: ${(err as Error).message}`);
  }
}

/** Writes `config.json`. No secrets live here, so the plain `writeJsonAtomic` tmp+rename is enough. */
export async function writeUserConfig(path: string, config: FileConfig): Promise<void> {
  await writeJsonAtomic(path, config);
}

/** Shows enough of a token to recognise it without exposing it — used by the `config` command. */
export function maskToken(token: string | undefined): string {
  if (!token) return "(not set)";
  return token.length <= 8 ? token : `${token.slice(0, 8)}…`;
}
