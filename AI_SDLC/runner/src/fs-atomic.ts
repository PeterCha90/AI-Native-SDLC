import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Writes `data` as pretty-printed JSON to `path` via `<path>.tmp` + `rename`, the same pattern
 * `linear-watcher.ts` already used for its own state file — `rename` within the same directory is
 * atomic on the filesystems we run on (POSIX, NTFS), so a crash or a concurrent reader never
 * observes a half-written file. Shared by `slack/threads.ts` and `slack/interview.ts`, whose state
 * files are read-modify-written from Slack event handlers that can fire concurrently (a thread
 * reply racing a button press, for instance).
 */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, path);
}
