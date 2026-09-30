// 접근 로그(logs/access.jsonl)에서 최근 구간을 잘라 에러 비율을 계산한다.
// 서버의 관측 패널(/api/_ops/stats)과 모니터(ops/monitor.mjs)가 같은 계산을 쓰도록 한 곳에 둔다.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ACCESS_LOG = process.env.ACCESS_LOG ?? join(APP_ROOT, "logs", "access.jsonl");
export const MONITOR_STATE = process.env.MONITOR_STATE ?? join(APP_ROOT, "ops", ".monitor-state.json");

/** 모니터가 평가하는 지표. 이름은 ops/bands.yaml 의 metrics 키와 같아야 한다. */
export const METRICS = {
  api_5xx_rate: { label: "5xx", match: (status) => status >= 500 },
  api_4xx_rate: { label: "4xx", match: (status) => status >= 400 && status < 500 },
};

export function readLog(file = ACCESS_LOG) {
  if (!existsSync(file)) return [];
  const entries = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // 쓰는 도중에 읽힌 마지막 줄은 다음 주기에 다시 본다.
    }
  }
  return entries;
}

export function windowEntries(entries, windowMs, now = Date.now()) {
  const since = now - windowMs;
  return entries.filter((e) => Date.parse(e.ts) >= since);
}

/** 구간 안의 요청 수, 지표별 비율, 에러를 많이 낸 (상태, 경로, 메시지) 묶음을 돌려준다. */
export function summarize(entries) {
  const total = entries.length;
  const rates = {};
  for (const [name, m] of Object.entries(METRICS)) {
    const count = entries.filter((e) => m.match(e.status)).length;
    rates[name] = { count, rate: total ? count / total : 0 };
  }

  const groups = new Map();
  for (const e of entries) {
    if (e.status < 400) continue;
    const key = `${e.status} ${e.method} ${e.route} ${e.error ?? ""}`;
    const g = groups.get(key) ?? { status: e.status, method: e.method, route: e.route, error: e.error ?? "", count: 0, lastTs: e.ts };
    g.count += 1;
    g.lastTs = e.ts;
    groups.set(key, g);
  }
  const topErrors = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 5);

  return { total, rates, topErrors };
}

export function readState(file = MONITOR_STATE) {
  if (!existsSync(file)) return { incidents: {}, lastRun: null };
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { incidents: {}, lastRun: null };
  }
}
