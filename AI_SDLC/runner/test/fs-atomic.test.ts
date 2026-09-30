import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "../src/fs-atomic.ts";

test("writeJsonAtomic: writes via <path>.tmp + rename, leaving no .tmp file behind, and creates missing parent dirs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-fs-atomic-"));
  const path = join(dir, "nested", "state.json");

  await writeJsonAtomic(path, { a: 1, b: "two" });

  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { a: 1, b: "two" });
  assert.equal(existsSync(`${path}.tmp`), false, "the .tmp file must be renamed away, not left behind");
});

test("writeJsonAtomic: a second write fully replaces the first (no partial merge)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-fs-atomic-"));
  const path = join(dir, "state.json");

  await writeJsonAtomic(path, { round: 1, answers: ["a"] });
  await writeJsonAtomic(path, { round: 2, answers: [] });

  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { round: 2, answers: [] });
});
