import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GateMapLite, LiveStatus, RunMeta, StageLogEntry } from "../src/dashboard.ts";
import type { StageId } from "../src/gate.ts";

/**
 * Writes realistic `.state/*` fixtures for two runs, so the dashboard can be previewed without a
 * Linear webhook or API key:
 *
 *   ENG-42  human ticket, 01–05 all approved, 04 Test's e2e check actually failed (the human
 *           approved shipping anyway), and 06 Maintain's 3σ detection opened the follow-up ENG-49.
 *   ENG-49  the auto ticket ENG-42's 06 Maintain created (depth 1, labeled sdlc-auto), currently
 *           sitting at the 01 Plan gate waiting on the Product Owner.
 *
 * Usage: `node --experimental-strip-types scripts/seed-demo-state.ts [targetDir]`
 * (targetDir defaults to `.state-demo`, resolved relative to the current directory).
 */

const RUNNER_DIR = fileURLToPath(new URL("..", import.meta.url));

const GATE_ROLES: Record<StageId, string> = {
  "01-plan": "Product Owner",
  "02-design": "Product Owner",
  "03-build": "Engineer",
  "04-test": "Code Owner",
  "05-deploy": "Release Manager",
  "06-maintain": "Service Owner",
};

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function gateMapFor(key: string, base: number): GateMapLite {
  const map = {} as GateMapLite;
  const stages: StageId[] = ["01-plan", "02-design", "03-build", "04-test", "05-deploy", "06-maintain"];
  stages.forEach((stage, i) => {
    map[stage] = { key: `${key}-G${base + i}`, url: `https://linear.app/demo/issue/${key}-G${base + i}` };
  });
  return map;
}

async function writeRunState(
  dir: string,
  key: string,
  meta: RunMeta,
  log: StageLogEntry[],
  gates: GateMapLite | null,
  live: LiveStatus,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${key}.meta.json`), JSON.stringify(meta, null, 2));
  await writeFile(join(dir, `${key}.json`), JSON.stringify(log, null, 2));
  if (gates) await writeFile(join(dir, `${key}.gates.json`), JSON.stringify(gates, null, 2));
  await writeFile(join(dir, `${key}.live.json`), JSON.stringify(live, null, 2));
}

async function seedEng42(dir: string): Promise<void> {
  const url = "https://linear.app/demo/issue/ENG-42";
  const meta: RunMeta = {
    key: "ENG-42",
    title: "체크아웃 시 쿠폰 코드가 중복 적용됨",
    url,
    labels: [],
    depth: 0,
    autoApprove: false,
    startedAt: iso(90),
    gateRoles: GATE_ROLES,
  };

  const log: StageLogEntry[] = [
    { stage: "00-setup", startedAt: iso(90), endedAt: iso(89), ok: true, sessionJsonlPath: "/Users/demo/.claude/projects/-demo/00-setup.jsonl" },
    { stage: "01-intent", startedAt: iso(89), endedAt: iso(85), ok: true, sessionJsonlPath: "/Users/demo/.claude/projects/-demo/01-intent.jsonl" },
    { stage: "gate:01-plan", startedAt: iso(83), endedAt: iso(83), ok: true, sessionJsonlPath: null, note: "Product Owner 승인" },
    { stage: "02-spec", startedAt: iso(83), endedAt: iso(78), ok: true, sessionJsonlPath: "/Users/demo/.claude/projects/-demo/02-spec.jsonl" },
    { stage: "gate:02-design", startedAt: iso(75), endedAt: iso(75), ok: true, sessionJsonlPath: null, note: "Product Owner 승인" },
    { stage: "03-plan", startedAt: iso(75), endedAt: iso(70), ok: true, sessionJsonlPath: "/Users/demo/.claude/projects/-demo/03-plan.jsonl" },
    { stage: "gate:03-build", startedAt: iso(68), endedAt: iso(68), ok: true, sessionJsonlPath: null, note: "Engineer 승인" },
    { stage: "03-build", startedAt: iso(68), endedAt: iso(52), ok: true, sessionJsonlPath: "/Users/demo/.claude/projects/-demo/03-build.jsonl" },
    { stage: "04-test-loop", startedAt: iso(52), endedAt: iso(40), ok: true, sessionJsonlPath: "/Users/demo/.claude/projects/-demo/04-test-loop.jsonl" },
    { stage: "04-test", startedAt: iso(40), endedAt: iso(38), ok: false, sessionJsonlPath: null, note: "unit: ok; e2e: fail" },
    {
      stage: "gate:04-test",
      startedAt: iso(35),
      endedAt: iso(35),
      ok: true,
      sessionJsonlPath: null,
      note: "Code Owner 승인 — e2e 실패는 알려진 이슈로 별도 추적, 이번 변경과 무관하다고 판단해 통과시킴",
    },
    { stage: "05-review", startedAt: iso(35), endedAt: iso(28), ok: true, sessionJsonlPath: "/Users/demo/.claude/projects/-demo/05-review.jsonl" },
    { stage: "05-deploy", startedAt: iso(28), endedAt: iso(26), ok: true, sessionJsonlPath: null, note: "gh pr create --fill --head sdlc/ENG-42" },
    { stage: "gate:05-deploy", startedAt: iso(24), endedAt: iso(24), ok: true, sessionJsonlPath: null, note: "Release Manager 승인" },
    {
      stage: "06-maintain",
      startedAt: iso(20),
      endedAt: iso(18),
      ok: false,
      sessionJsonlPath: null,
      note: "tier=3 — sdlc-maintain 세션 실패(exit 1). 러너가 대신 후속 티켓 ENG-49 (https://linear.app/demo/issue/ENG-49) 을 생성했다.",
    },
    { stage: "gate:06-maintain", startedAt: iso(15), endedAt: iso(15), ok: true, sessionJsonlPath: null, note: "Service Owner 승인 — 후속 티켓 트리아지 완료" },
  ];

  const live: LiveStatus = { stage: "06-maintain", phase: "done", since: iso(15) };

  await writeRunState(dir, "ENG-42", meta, log, gateMapFor("ENG-42", 1), live);
}

async function seedEng49(dir: string): Promise<void> {
  const parentUrl = "https://linear.app/demo/issue/ENG-42";
  const gates = gateMapFor("ENG-49", 1);
  const meta: RunMeta = {
    key: "ENG-49",
    title: "[auto] fix: 체크아웃 시 쿠폰 코드가 중복 적용됨",
    url: "https://linear.app/demo/issue/ENG-49",
    labels: ["sdlc-auto"],
    depth: 1,
    parentUrl,
    autoApprove: false,
    startedAt: iso(14),
    gateRoles: GATE_ROLES,
  };

  const log: StageLogEntry[] = [
    { stage: "00-setup", startedAt: iso(14), endedAt: iso(13), ok: true, sessionJsonlPath: "/Users/demo/.claude/projects/-demo/eng49-00-setup.jsonl" },
    { stage: "01-intent", startedAt: iso(13), endedAt: iso(9), ok: true, sessionJsonlPath: "/Users/demo/.claude/projects/-demo/eng49-01-intent.jsonl" },
  ];

  // Still waiting — no gate:01-plan entry yet, only the live snapshot below.
  const live: LiveStatus = {
    stage: "gate:01-plan",
    phase: "waiting",
    role: "Product Owner",
    gateUrl: gates["01-plan"].url,
    since: iso(9),
  };

  await writeRunState(dir, "ENG-49", meta, log, gates, live);
}

async function main(): Promise<void> {
  const arg = process.argv[2] ?? ".state-demo";
  const dir = resolve(RUNNER_DIR, arg);
  await seedEng42(dir);
  await seedEng49(dir);
  console.log(`[seed-demo-state] wrote fixtures for ENG-42 and ENG-49 into ${dir}`);
}

main().catch((err) => {
  console.error("[seed-demo-state] failed:", err);
  process.exit(1);
});
