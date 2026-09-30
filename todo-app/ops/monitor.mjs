// 에러 로그 모니터. 주기적으로 logs/access.jsonl 을 읽어 에러 비율을 판정하고,
// 3σ 를 넘으면 Linear 에 티켓을 연다.
//
//   npm run monitor            # 15초마다 계속 돈다 (시연용)
//   npm run monitor:once       # 한 번만 판정하고 끝난다 (cron / launchd 용)
//
// 판정은 모델이 하지 않는다. 비율을 계산해 ops/detect.sh 에 넘기면, 그 스크립트가
// bands.yaml 의 baseline/sigma 로 tier 를 정한다. 이 파일은 tier 에 따라 다음 행동만 고른다.
//   tier 0  정상. 열려 있던 사건이 있으면 "회복" 코멘트를 달고 닫는다.
//   tier 1  기록만 한다.
//   tier 2  진단 대상으로 표시한다. 티켓은 만들지 않는다.
//   tier 3  클로드를 불러 진단하고 티켓을 열게 한다(ops/claude-triage.mjs).
//           같은 지표의 사건이 이미 열려 있으면 다시 부르지 않는다.
//
// 티켓은 클로드가 Linear MCP 로 만든다. 그래서 모니터 자체에는 Linear API 키가 필요 없다.
//   MONITOR_DRY_RUN=1  클로드는 진단까지만 하고, 티켓은 Linear 대신 ops/outbox/*.md 에 쓴다.
//   MONITOR_CLAUDE=0   클로드를 부르지 않고 틀에 숫자만 채운 티켓을 쓴다(아래 대체 경로와 같다).
// 클로드 세션이 실패하면 틀 티켓으로 대신 연다. 이때는 LINEAR_API_KEY 가 있으면 Linear, 없으면 outbox 다.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv, promisify } from "node:util";
import { commentWithClaude, linearTeamId, triageWithClaude } from "./claude-triage.mjs";
import { APP_ROOT, METRICS, MONITOR_STATE, readLog, readState, summarize, windowEntries } from "./metrics.mjs";

const execFileP = promisify(execFile);

const DETECT_SCRIPT = join(APP_ROOT, "ops", "detect.sh");
const OUTBOX = process.env.MONITOR_OUTBOX ?? join(APP_ROOT, "ops", "outbox");

export const settings = {
  intervalSec: Number(process.env.MONITOR_INTERVAL_SEC ?? 15),
  windowSec: Number(process.env.MONITOR_WINDOW_SEC ?? 120),
  minRequests: Number(process.env.MONITOR_MIN_REQUESTS ?? 10),
  labels: (process.env.MONITOR_LABELS ?? "sdlc-auto,incident").split(",").map((s) => s.trim()).filter(Boolean),
  /** 모니터가 여는 티켓은 자동 생성 1단계다. AI-SDLC 러너가 여기서부터 depth 를 세어 상한에서 멈춘다. */
  depth: Number(process.env.MONITOR_SDLC_DEPTH ?? 1),
};

const pct = (r) => `${(r * 100).toFixed(1)}%`;
const clock = () => new Date().toTimeString().slice(0, 8);
const log = (msg) => console.log(`[monitor ${clock()}] ${msg}`);

export async function runDetect(metric, value) {
  let stdout;
  try {
    ({ stdout } = await execFileP("bash", [DETECT_SCRIPT, "--metric", metric, "--value", String(value)]));
  } catch (err) {
    // detect.sh 는 tier 2~3 이면 exit 1 로 끝난다. 판정 자체가 실패한 건 exit 2 다.
    if (err.code !== 1) throw new Error(`detect.sh 실패 (exit ${err.code}): ${err.stderr?.trim() || err.message}`);
    stdout = err.stdout;
  }
  const m = stdout.match(/tier=(\d)/);
  if (!m) throw new Error(`detect.sh 출력에서 tier 를 찾지 못했다:\n${stdout}`);
  return { tier: Number(m[1]), output: stdout.trim() };
}

export function buildTicket({ metric, rate, summary, detectOutput, now }) {
  const { label } = METRICS[metric];
  const { count } = summary.rates[metric];
  const top = summary.topErrors.filter((e) => METRICS[metric].match(e.status));
  const minutes = settings.windowSec / 60;

  const rows = top.length
    ? top.map((e) => `| ${e.count} | ${e.status} | \`${e.method} ${e.route}\` | ${e.error || "-"} |`).join("\n")
    : "| - | - | - | - |";

  const title = `[장애] ${label} 에러율 ${pct(rate)} — 최근 ${minutes}분, 3σ 이탈`;
  const body = [
    `## 무슨 일이 있었나`,
    ``,
    `최근 ${minutes}분 동안 TODO API 요청 ${summary.total}건 중 **${count}건(${pct(rate)})이 ${label}** 로 끝났다.`,
    `모니터가 에러 로그를 집계해 \`ops/detect.sh\` 로 판정했다. 모델은 판정에 관여하지 않았다.`,
    ``,
    `## 가장 많이 난 에러`,
    ``,
    `| 횟수 | 상태 | 요청 | 메시지 |`,
    `| --- | --- | --- | --- |`,
    rows,
    ``,
    `## 판정 원문`,
    ``,
    "```",
    detectOutput,
    "```",
    ``,
    `## 다음 단계`,
    ``,
    `- 원인을 찾아 01 Plan 형식의 intent 로 정리한다. 서버 로그는 \`todo-app/logs/access.jsonl\`.`,
    `- 지표가 정상으로 돌아오면 모니터가 이 티켓에 "회복" 코멘트를 단다.`,
    ``,
    `---`,
    `감지 시각: ${new Date(now).toISOString()} · 지표: \`${metric}\``,
    ``,
    `sdlc-depth: ${settings.depth}`,
  ].join("\n");

  return { title, body, labels: settings.labels };
}

// ---------------------------------------------------------------------------
// 티켓을 보내는 곳. Linear 이거나, 키가 없을 때의 드라이런 outbox.
// ---------------------------------------------------------------------------

export function createLinearSink({ apiKey, teamId, endpoint = "https://api.linear.app/graphql" }) {
  async function graphql(query, variables) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (!res.ok || json.errors?.length) {
      throw new Error(`Linear 요청 실패: ${json.errors?.map((e) => e.message).join("; ") ?? res.statusText}`);
    }
    return json.data;
  }

  // 라벨이 없으면 만든다. sdlc-auto 가 조용히 빠지면 러너가 사람이 만든 티켓으로 읽어
  // 깊이 제한을 건너뛴다 — 러너의 linear 어댑터와 같은 이유다.
  async function labelIds(names) {
    const data = await graphql(
      `query($teamId: ID!) { issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 250) { nodes { id name } } }`,
      { teamId },
    );
    const byName = new Map(data.issueLabels.nodes.map((l) => [l.name, l.id]));
    const ids = [];
    for (const name of names) {
      if (byName.has(name)) {
        ids.push(byName.get(name));
        continue;
      }
      const created = await graphql(
        `mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id } } }`,
        { input: { name, teamId } },
      );
      ids.push(created.issueLabelCreate.issueLabel.id);
    }
    return ids;
  }

  return {
    name: "linear",
    async create(t) {
      const data = await graphql(
        `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }`,
        { input: { teamId, title: t.title, description: t.body, labelIds: await labelIds(t.labels) } },
      );
      if (!data.issueCreate.success) throw new Error("Linear issueCreate 가 실패를 돌려줬다");
      const { id, identifier, url } = data.issueCreate.issue;
      return { id, key: identifier, url };
    },
    async comment(incident, body) {
      await graphql(`mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`, {
        input: { issueId: incident.id, body },
      });
    },
  };
}

export function createOutboxSink(dir = OUTBOX) {
  return {
    name: "dry-run",
    async create(t) {
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = join(dir, `${stamp}.md`);
      writeFileSync(file, `# ${t.title}\n\n라벨: ${t.labels.join(", ")}\n\n${t.body}\n`);
      return { id: file, key: `DRY-RUN ${stamp}`, url: file };
    },
    async comment(incident, body) {
      if (existsSync(incident.id)) appendFileSync(incident.id, `\n\n---\n**코멘트** ${new Date().toISOString()}\n\n${body}\n`);
    },
  };
}

/** 클로드가 실패했을 때 쓰는 틀 티켓의 목적지. Linear API 키가 있으면 Linear, 없으면 outbox. */
export function sinkFromEnv(env = process.env) {
  const apiKey = env.LINEAR_API_KEY ?? "";
  const teamId = linearTeamId(env);
  if (env.MONITOR_DRY_RUN === "1" || !apiKey || !teamId) return createOutboxSink();
  return createLinearSink({ apiKey, teamId, endpoint: env.LINEAR_API_URL });
}

export function triageFromEnv(env = process.env) {
  return {
    enabled: env.MONITOR_CLAUDE !== "0",
    useLinear: env.MONITOR_DRY_RUN !== "1",
    teamId: linearTeamId(env),
    run: triageWithClaude,
    comment: commentWithClaude,
  };
}

/** 패널과 시작 로그에 보여줄 "티켓이 어디로 가는가". */
function destination(sink, triage) {
  if (!triage.enabled) return sink.name === "linear" ? "Linear(틀 티켓)" : "outbox(틀 티켓)";
  return triage.useLinear ? "클로드 → Linear MCP" : "클로드 → outbox(드라이런)";
}

// ---------------------------------------------------------------------------
// 한 번의 판정
// ---------------------------------------------------------------------------

/** 콘솔의 "모니터 활동" 피드. 판정이 바뀔 때와 사건이 열리고 닫힐 때만 남긴다(15초마다 쌓이지 않게). */
function pushEvent(state, now, kind, text) {
  state.events ??= [];
  state.events.unshift({ at: new Date(now).toISOString(), kind, text });
  state.events = state.events.slice(0, 40);
}

async function openIncident({ metric, rate, summary, output, now, sink, triage, state, stateFile }) {
  const openedAt = new Date(now).toISOString();
  const base = { metric, openedAt, peakRate: rate };

  if (triage.enabled && triage.useLinear && !triage.teamId) {
    log("Linear 팀 id 를 모른다(LINEAR_TEAM_ID 또는 runner sdlc.config.json) — 클로드 대신 틀 티켓으로 연다");
  } else if (triage.enabled) {
    // 진단은 1~3분 걸린다. 그동안 패널이 "진단 중"을 보여주도록 먼저 기록해 둔다.
    state.incidents[metric] = { ...base, status: "triaging", key: "클로드 진단 중…" };
    pushEvent(state, now, "triage", `${metric} 3σ — 클로드가 로그와 코드를 읽기 시작했다`);
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    log(`${metric} 3σ — 클로드에게 진단과 티켓 작성을 맡긴다`);

    const incidentId = `INC-${openedAt.replace(/[-:]/g, "").slice(0, 15)}-${metric}`;
    const res = await triage.run({
      metric,
      rate,
      summary,
      detectOutput: output,
      now,
      incidentId,
      depth: settings.depth,
      labels: settings.labels,
      teamId: triage.teamId,
      useLinear: triage.useLinear,
    });

    if (res.ok) {
      const o = res.output;
      const extra = { rootCause: o.rootCause, intentPath: o.intentPath, costUsd: res.costUsd };
      if (o.action === "drafted") {
        const t = await createOutboxSink().create({ title: o.title, body: o.ticketBody, labels: settings.labels });
        return { ...base, ...t, ...extra, via: "dry-run", action: "drafted" };
      }
      if (o.ticketKey) return { ...base, id: o.ticketKey, key: o.ticketKey, url: o.ticketUrl, ...extra, via: "claude", action: o.action };
      log("클로드가 티켓 번호를 돌려주지 않았다 — 틀 티켓으로 대신 연다");
    } else {
      log(`클로드 세션 실패: ${res.error} — 틀 티켓으로 대신 연다`);
    }
  }

  const t = await sink.create(buildTicket({ metric, rate, summary, detectOutput: output, now }));
  return { ...base, ...t, via: sink.name, action: "created" };
}

async function closeIncident(open, body, { sink, triage }) {
  if (open.via === "claude") {
    const res = await triage.comment(open.key, body);
    if (!res.ok) log(`회복 코멘트 실패(${open.key}): ${res.error}`);
  } else if (open.via === "dry-run") {
    await createOutboxSink().comment(open, body);
  } else {
    await sink.comment(open, body);
  }
}

export async function evaluate({ sink, triage, now = Date.now(), stateFile = MONITOR_STATE } = {}) {
  const entries = windowEntries(readLog(), settings.windowSec * 1000, now);
  const summary = summarize(entries);
  const state = readState(stateFile);
  state.incidents ??= {};
  state.history ??= [];
  const results = {};

  for (const metric of Object.keys(METRICS)) {
    const { rate, count } = summary.rates[metric];
    const open = state.incidents[metric];

    if (summary.total < settings.minRequests) {
      results[metric] = { rate, count, tier: null, note: `표본 부족 (${summary.total}/${settings.minRequests}건)` };
      continue;
    }

    const { tier, output } = await runDetect(metric, Number(rate.toFixed(4)));
    const line = `${metric}=${pct(rate)} (${count}/${summary.total}건) tier=${tier}`;
    state.lastTier ??= {};
    if (state.lastTier[metric] !== tier) {
      pushEvent(state, now, `tier${tier}`, `${metric} ${pct(rate)} — ${["정상 범위", "1σ 이탈, 기록", "2σ 이탈, 진단 대상", "3σ 이탈"][tier]}`);
      state.lastTier[metric] = tier;
    }
    let note;

    if (tier === 3 && open) {
      open.lastSeenAt = new Date(now).toISOString();
      open.peakRate = Math.max(open.peakRate ?? 0, rate);
      note = `이미 열린 사건 ${open.key} — 중복 생성하지 않음`;
    } else if (tier === 3) {
      const incident = await openIncident({ metric, rate, summary, output, now, sink, triage, state, stateFile });
      state.incidents[metric] = incident;
      pushEvent(
        state,
        now,
        "ticket",
        incident.action === "commented"
          ? `기존 티켓 ${incident.key} 에 같은 사건으로 코멘트`
          : `${incident.action === "drafted" ? "티켓 초안" : "티켓"} ${incident.key} — ${incident.rootCause ?? "틀 티켓(클로드 미사용)"}`,
      );
      const verb = incident.action === "commented" ? "기존 티켓에 코멘트" : incident.action === "drafted" ? "티켓 초안 작성" : "티켓 생성";
      note = `${verb} ${incident.key} ${incident.url ?? ""}${incident.rootCause ? `\n    추정 원인: ${incident.rootCause}` : ""}`;
    } else if (tier === 0 && open) {
      await closeIncident(
        open,
        `회복: 최근 ${settings.windowSec / 60}분 ${metric}=${pct(rate)} (${summary.total}건), tier 0. 최고치는 ${pct(open.peakRate ?? 0)}였다. 모니터는 이 사건을 닫는다 — 원인 조치는 이 티켓에서 계속한다.`,
        { sink, triage },
      );
      state.history.unshift({ ...open, resolvedAt: new Date(now).toISOString() });
      state.history = state.history.slice(0, 10);
      delete state.incidents[metric];
      note = `회복 — ${open.key} 에 코멘트를 남기고 사건을 닫음`;
      pushEvent(state, now, "recovered", `${metric} 회복 — ${open.key} 에 회복 코멘트, 사건 종료`);
    } else {
      note = ["정상", "기록만 한다", "진단 대상 — 티켓은 만들지 않는다"][tier] ?? "";
    }

    log(`${line} → ${note}`);
    results[metric] = { rate, count, tier, note };
  }

  if (summary.total < settings.minRequests) log(`최근 ${settings.windowSec}초 요청 ${summary.total}건 — 표본 부족, 판정 보류`);

  state.lastRun = {
    at: new Date(now).toISOString(),
    windowSec: settings.windowSec,
    total: summary.total,
    destination: destination(sink, triage),
    results,
  };
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  return state;
}

/**
 * 키 파일을 읽는다. todo-app/.env 가 먼저고, 없는 값은 러너와 같이 쓰는 AI_SDLC/.env 에서 채운다.
 * 이미 셸에 export 된 값은 덮어쓰지 않는다.
 */
function loadEnvFiles() {
  for (const file of [join(APP_ROOT, ".env"), join(APP_ROOT, "..", "AI_SDLC", ".env")]) {
    if (!existsSync(file)) continue;
    for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      if (v && !process.env[k]) process.env[k] = v;
    }
  }
}

async function main() {
  loadEnvFiles();
  const once = process.argv.includes("--once");
  const sink = sinkFromEnv();
  const triage = triageFromEnv();

  // 진단 도중 모니터가 죽었다면 "진단 중" 사건이 남는다. 새로 시작할 때 지워야 다시 판정한다.
  const state = readState();
  for (const [metric, incident] of Object.entries(state.incidents ?? {})) {
    if (incident.status === "triaging") delete state.incidents[metric];
  }
  if (state.incidents) writeFileSync(MONITOR_STATE, JSON.stringify(state, null, 2));

  log(
    `시작 — ${once ? "1회 판정" : `${settings.intervalSec}초마다`}, 창 ${settings.windowSec}초, 최소 표본 ${settings.minRequests}건, ` +
      `3σ 시 ${destination(sink, triage)}`,
  );

  if (once) {
    await evaluate({ sink, triage });
    return;
  }

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await evaluate({ sink, triage });
    } catch (err) {
      log(`판정 실패: ${err.message}`);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, settings.intervalSec * 1000);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[monitor] ${err.message}`);
    process.exit(1);
  });
}
