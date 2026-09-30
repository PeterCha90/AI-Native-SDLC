// 3σ 판정이 난 뒤에 부르는 클로드 세션. 모니터는 "언제 움직일지"만 정하고,
// "무엇이 문제이고 무엇을 해야 하는지"는 여기서 클로드가 정한다.
//
// 클로드는 AI_SDLC 플러그인의 sdlc-maintain 스킬(3σ 절차)을 따른다.
//   1. 접근 로그와 서버 코드를 읽고 원인을 추정한다 (읽기 전용)
//   2. 이미 열린 장애 티켓과 같은 사건인지 Linear 에서 확인한다
//   3. docs/intent/<id>.md 를 01 Plan 형식으로 쓰고, Linear MCP 로 티켓을 만든다
//      (같은 사건이면 새로 만들지 않고 기존 티켓에 코멘트한다)
//
// 도구는 --tools 와 --permission-mode dontAsk 로 좁힌다. 허용 목록에 없는 도구는 묻지 않고 거부된다.
// 파일 쓰기는 Edit(docs/intent/**) 규칙으로 docs/intent/ 안에만 허용된다(쓰기 권한은 Write 가 아니라 Edit 규칙이 정한다).
// Bash 는 아예 없다.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT, METRICS } from "./metrics.mjs";

const PLUGIN_DIR = join(APP_ROOT, "..", "plugin");
const RUNNER_CONFIG = join(APP_ROOT, "..", "runner", "sdlc.config.json");

const LINEAR_TOOLS = [
  "mcp__linear__list_teams",
  "mcp__linear__list_issues",
  "mcp__linear__get_issue",
  "mcp__linear__list_issue_labels",
  "mcp__linear__create_issue_label",
  "mcp__linear__save_issue",
  "mcp__linear__save_comment",
];

export const claudeSettings = {
  bin: process.env.CLAUDE_BIN ?? "claude",
  model: process.env.MONITOR_CLAUDE_MODEL ?? "sonnet",
  timeoutMs: Number(process.env.MONITOR_CLAUDE_TIMEOUT_SEC ?? 300) * 1000,
};

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["created", "commented", "drafted"] },
    ticketKey: { type: "string", description: "만들었거나 코멘트한 Linear 이슈 식별자(예: FAS-12). drafted 면 빈 문자열" },
    ticketUrl: { type: "string" },
    title: { type: "string", description: "티켓 제목" },
    rootCause: { type: "string", description: "추정 원인 한두 문장" },
    intentPath: { type: "string", description: "작성한 intent 문서 경로(todo-app 기준 상대 경로)" },
    ticketBody: { type: "string", description: "티켓 본문 전체(markdown). drafted 일 때 필수" },
  },
  required: ["action", "ticketKey", "ticketUrl", "title", "rootCause", "intentPath", "ticketBody"],
};

export function linearTeamId(env = process.env) {
  if (env.LINEAR_TEAM_ID) return env.LINEAR_TEAM_ID;
  if (!existsSync(RUNNER_CONFIG)) return "";
  try {
    return JSON.parse(readFileSync(RUNNER_CONFIG, "utf8")).linearTeamId ?? "";
  } catch {
    return "";
  }
}

export function buildTriagePrompt({ metric, rate, summary, detectOutput, now, incidentId, depth, labels, teamId, useLinear }) {
  const { label } = METRICS[metric];
  const errors = summary.topErrors
    .filter((e) => METRICS[metric].match(e.status))
    .map((e) => `- ${e.count}건 ${e.status} ${e.method} ${e.route} — ${e.error || "(메시지 없음)"}`)
    .join("\n");

  const linearSteps = useLinear
    ? [
        `4. Linear MCP 로 팀(id: ${teamId})에서 라벨 "incident" 가 붙은 열린 이슈를 찾아본다. 같은 원인으로 이미 열린 티켓이 있으면`,
        `   새로 만들지 말고 그 티켓에 이번 감지 내용을 코멘트로 남긴 뒤 action="commented" 로 끝낸다.`,
        `5. 없으면 새 이슈를 만든다. 팀 id ${teamId}, 라벨 ${labels.map((l) => `"${l}"`).join(", ")} (없으면 만든다 — sdlc-auto 가`,
        `   빠지면 러너가 깊이 제한을 세지 못한다). 본문은 진단 요약 + intent 문서 내용이고, 마지막 줄은 정확히 "sdlc-depth: ${depth}" 다.`,
        `   action="created" 로 끝낸다.`,
      ]
    : [
        `4. Linear 는 쓰지 않는다(드라이런). 대신 티켓 제목과 본문을 결과의 title, ticketBody 에 채운다.`,
        `   본문은 진단 요약 + intent 문서 내용이고, 마지막 줄은 정확히 "sdlc-depth: ${depth}" 다. action="drafted", ticketKey·ticketUrl 은 빈 문자열.`,
      ];

  return [
    `sdlc-maintain 스킬의 3σ 절차를 따르라. 이 저장소(todo-app)는 TODO API 서버와 React 화면이다.`,
    ``,
    `## 감지 내용 (모니터가 결정론적으로 판정했다 — 장애 여부를 다시 판단하지 마라)`,
    `- 지표: ${metric} (${label} 비율) = ${(rate * 100).toFixed(1)}%, 최근 창 요청 ${summary.total}건`,
    `- 감지 시각: ${new Date(now).toISOString()}`,
    `- 가장 많이 난 에러:`,
    errors || "- (없음)",
    `- detect.sh 출력:`,
    "```",
    detectOutput,
    "```",
    ``,
    `## 할 일`,
    `1. 원인을 진단한다. 읽기만 한다. logs/access.jsonl 은 계속 커지는 파일이니 Grep 으로 에러 줄만 보거나 끝부분만 읽는다.`,
    `   서버 코드는 server/index.mjs, 화면은 src/App.jsx 다. 코드·설정은 절대 고치지 않는다.`,
    `   원인이 코드 버그인지, 의존성(DB 등) 장애인지, 클라이언트가 잘못된 요청을 보내는 것인지 구분해서 근거와 함께 적는다.`,
    `2. 진단 결과를 docs/intent/${incidentId}.md 에 sdlc-intent 스킬의 intent 형식으로 쓴다. 헤드리스 실행이니 되묻지 말고`,
    `   모르는 것은 "## 미해결 질문" 에 남긴다. 출처에는 지표 이름과 감지 시각을 적는다.`,
    `3. 제목은 "[장애] " 로 시작하고 증상과 추정 원인을 한 줄로 담는다.`,
    ...linearSteps,
    ``,
    `마지막 응답은 지정된 JSON 스키마를 따른다.`,
  ].join("\n");
}

function runClaude(args, cwd) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(claudeSettings.bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ ok: false, error: `claude 실행 실패: ${err.message}` });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, claudeSettings.timeoutMs);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `claude 실행 실패: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let json;
      try {
        json = JSON.parse(stdout);
      } catch {
        resolve({ ok: false, error: `claude 출력이 JSON 이 아니다 (exit ${code}): ${(stderr || stdout).slice(0, 300)}` });
        return;
      }
      if (json.is_error || !json.structured_output) {
        resolve({ ok: false, error: `claude 세션 실패: ${String(json.result ?? json.subtype).slice(0, 300)}` });
        return;
      }
      resolve({ ok: true, output: json.structured_output, costUsd: json.total_cost_usd, sessionId: json.session_id });
    });
  });
}

/** 진단하고 티켓을 만든다(또는 초안을 돌려준다). 절대 throw 하지 않는다 — 실패는 ok:false 로 온다. */
export async function triageWithClaude(input) {
  const args = [
    "-p",
    buildTriagePrompt(input),
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(RESULT_SCHEMA),
    "--model",
    claudeSettings.model,
    "--plugin-dir",
    PLUGIN_DIR,
    "--tools",
    "Read Glob Grep Skill Write",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ["Read", "Glob", "Grep", "Skill", "Edit(docs/intent/**)", ...(input.useLinear ? LINEAR_TOOLS : [])].join(" "),
  ];
  return runClaude(args, APP_ROOT);
}

/** 회복 코멘트. 모니터에 Linear 키가 없으니 이것도 클로드가 MCP 로 단다. */
export async function commentWithClaude(ticketKey, body) {
  const args = [
    "-p",
    `Linear MCP 로 이슈 ${ticketKey} 에 아래 내용을 코멘트로 그대로 남겨라. 다른 일은 하지 마라.\n\n${body}`,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify({ type: "object", properties: { done: { type: "boolean" } }, required: ["done"] }),
    "--model",
    claudeSettings.model,
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "mcp__linear__save_comment mcp__linear__get_issue",
  ];
  return runClaude(args, APP_ROOT);
}
