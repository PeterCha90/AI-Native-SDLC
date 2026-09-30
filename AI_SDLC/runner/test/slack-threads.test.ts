import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { threadPath, readThread, writeThread, type ThreadRecord } from "../src/slack/threads.ts";

async function tmpStateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sdlc-slack-threads-"));
}

test("threadPath places the record under <stateDir>/<key>.slack.json", () => {
  assert.equal(threadPath("/x/.state", "ENG-12"), "/x/.state/ENG-12.slack.json");
});

test("writeThread then readThread round-trips the same record", async () => {
  const dir = await tmpStateDir();
  const rec: ThreadRecord = {
    channel: "C1",
    threadTs: "1234.5678",
    ticketId: "uuid-12",
    stageTs: { "01-plan": "111.222" },
    gateTs: { "01-plan": "333.444" },
    gateResolvedBy: { "01-plan": "U1" },
  };
  await writeThread(dir, "ENG-12", rec);
  const read = await readThread(dir, "ENG-12");
  assert.deepEqual(read, rec);
});

test("readThread returns null for a missing key", async () => {
  const dir = await tmpStateDir();
  const read = await readThread(dir, "ENG-404");
  assert.equal(read, null);
});

test("readThread returns null for corrupted JSON", async () => {
  const dir = await tmpStateDir();
  await writeFile(threadPath(dir, "ENG-1"), "{ not json", "utf8");
  const read = await readThread(dir, "ENG-1");
  assert.equal(read, null);
});
