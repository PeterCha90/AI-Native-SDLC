import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FileConfig } from "../config.ts";
// Task 1 (concurrent) — `Credentials` is type-only here so this file has zero RUNTIME dependency
// on user-config.ts; `import type` is fully erased by --experimental-strip-types.
import type { Credentials } from "../user-config.ts";
import { translateVerifyError, type Verifier } from "./verify.ts";

/**
 * `doctor`'s checks intentionally do NOT re-test the Slack channel (no `postTest`/spam) — the
 * channel is only ever verified during `init`. Everything else here is safe to re-run any number
 * of times.
 */
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  blocking: boolean;
}

export interface DoctorDeps {
  exec: (cmd: string, args: string[], opts?: { input?: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
  verifier: Verifier;
  repoRoot: string | null;
  config: FileConfig | null;
  credentials: Credentials;
}

async function tryExec(
  exec: DoctorDeps["exec"],
  cmd: string,
  args: string[],
  opts?: { input?: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    return await exec(cmd, args, opts);
  } catch (err) {
    return { code: 127, stdout: "", stderr: (err as Error).message };
  }
}

const REINIT_FIX = "npx ai-sdlc-runner init 으로 다시 설정해 주세요";

/**
 * Finds the `claude mcp list` line for the "linear" server — matched on the server name (the
 * token before the first `:`), not a substring of the whole line, so a description mentioning
 * "linear" elsewhere never false-positives.
 */
function findLinearMcpLine(stdout: string): string | null {
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const name = line.split(":")[0]?.trim() ?? "";
    if (name.toLowerCase().includes("linear")) return line;
  }
  return null;
}

type McpStatus = "connected" | "failed" | "needs_auth" | "unknown";

/**
 * Classifies one `claude mcp list` status line. Real formats seen from `claude mcp list`:
 *   `linear: https://mcp.linear.app/mcp (HTTP) - ✔ Connected`
 *   `linear: https://mcp.linear.app/mcp (HTTP) - ✗ Failed to connect`
 *   `linear: https://mcp.linear.app/mcp (HTTP) - ⚠ Needs authentication`
 */
function classifyMcpLine(line: string): McpStatus {
  if (/needs authentication/i.test(line)) return "needs_auth";
  if (/✗|failed/i.test(line)) return "failed";
  if (/✔|connected/i.test(line)) return "connected";
  return "unknown";
}

export async function runDoctor(d: DoctorDeps): Promise<Check[]> {
  const checks: Check[] = [];

  const nodeMajor = Number(process.version.slice(1).split(".")[0]);
  checks.push({
    name: "Node.js 버전",
    ok: nodeMajor >= 22,
    detail: nodeMajor >= 22 ? `${process.version} (>= 22)` : `${process.version} — 22 이상이 필요합니다`,
    fix: nodeMajor >= 22 ? undefined : "Node 22 이상을 설치해 주세요 (예: nvm install 22)",
    blocking: nodeMajor < 22,
  });

  const versionResult = await tryExec(d.exec, "claude", ["--version"]);
  checks.push({
    name: "Claude Code 설치",
    ok: versionResult.code === 0,
    detail: versionResult.code === 0 ? versionResult.stdout.trim() : "claude 명령을 찾을 수 없습니다",
    fix: versionResult.code === 0 ? undefined : "https://claude.com/claude-code 안내에 따라 설치해 주세요",
    blocking: versionResult.code !== 0,
  });

  const authResult = await tryExec(d.exec, "claude", ["auth", "status"]);
  checks.push({
    name: "Claude Code 로그인",
    ok: authResult.code === 0,
    detail: authResult.code === 0 ? "로그인되어 있습니다" : authResult.stderr || authResult.stdout || "로그인이 필요합니다",
    fix: authResult.code === 0 ? undefined : "claude auth login 을 실행해 주세요",
    blocking: authResult.code !== 0,
  });

  const mcpResult = await tryExec(d.exec, "claude", ["mcp", "list"]);
  const linearLine = mcpResult.code === 0 ? findLinearMcpLine(mcpResult.stdout) : null;
  const mcpStatus: McpStatus = linearLine ? classifyMcpLine(linearLine) : "unknown";
  const linearConnected = mcpStatus === "connected";
  const ADD_LINEAR_MCP_CMD = "claude mcp add --scope user --transport http linear https://mcp.linear.app/mcp";
  const mcpFix =
    mcpStatus === "needs_auth"
      ? "claude mcp 또는 /mcp 로 Linear 인증을 완료해 주세요"
      : linearLine
        ? "claude mcp 또는 /mcp 로 Linear를 다시 연결해 주세요"
        : `${ADD_LINEAR_MCP_CMD} 를 실행한 뒤, Claude Code에서 /mcp 로 인증을 완료해 주세요`;
  checks.push({
    name: "Linear MCP 연결",
    ok: linearConnected,
    detail:
      linearLine ??
      "claude mcp list에 linear가 보이지 않습니다 — 이 명령은 현재 폴더에서 보이는 서버만 표시하므로, 다른 폴더에서 local/project 범위로 추가했다면 여기에는 나타나지 않습니다.",
    fix: linearConnected ? undefined : mcpFix,
    blocking: !linearConnected,
  });

  const slackConfigured = Boolean(d.config?.slack?.channelId);

  if (d.credentials.slackBotToken) {
    const result = await d.verifier.slackBot(d.credentials.slackBotToken);
    checks.push({
      name: "Slack 봇 토큰",
      ok: result.ok,
      detail: result.ok ? `${result.team} · ${result.botName}` : translateVerifyError(result.error),
      fix: result.ok ? undefined : REINIT_FIX,
      blocking: !result.ok && slackConfigured,
    });
  } else {
    checks.push({
      name: "Slack 봇 토큰",
      ok: !slackConfigured,
      detail: slackConfigured ? "설정 안 됨" : "Slack 미사용",
      fix: slackConfigured ? REINIT_FIX : undefined,
      blocking: slackConfigured,
    });
  }

  if (d.credentials.slackAppToken) {
    const result = await d.verifier.slackApp(d.credentials.slackAppToken);
    checks.push({
      name: "Slack 앱 토큰",
      ok: result.ok,
      detail: result.ok ? "연결 가능합니다" : translateVerifyError(result.error),
      fix: result.ok ? undefined : REINIT_FIX,
      blocking: !result.ok && slackConfigured,
    });
  } else {
    checks.push({
      name: "Slack 앱 토큰",
      ok: !slackConfigured,
      detail: slackConfigured ? "설정 안 됨" : "Slack 미사용",
      fix: slackConfigured ? REINIT_FIX : undefined,
      blocking: slackConfigured,
    });
  }

  if (d.credentials.linearApiKey) {
    const result = await d.verifier.linear(d.credentials.linearApiKey);
    checks.push({
      name: "Linear API 키",
      ok: result.ok,
      detail: result.ok ? result.viewer : translateVerifyError(result.error),
      fix: result.ok ? undefined : REINIT_FIX,
      blocking: !result.ok,
    });
  } else {
    checks.push({
      name: "Linear API 키",
      ok: false,
      detail: "설정 안 됨",
      fix: REINIT_FIX,
      blocking: true,
    });
  }

  if (d.repoRoot) {
    const gitResult = await tryExec(d.exec, "git", ["-C", d.repoRoot, "rev-parse", "--is-inside-work-tree"]);
    checks.push({
      name: "대상 저장소",
      ok: gitResult.code === 0,
      detail: gitResult.code === 0 ? d.repoRoot : `${d.repoRoot} — git 저장소가 아닙니다`,
      fix: gitResult.code === 0 ? undefined : "git 저장소 안에서 실행하거나 --repo로 지정해 주세요",
      blocking: false,
    });

    // SDLC용 CLAUDE.md는 루트가 아니라 `.claude/CLAUDE.md`에 둔다 — 루트에 팀 CLAUDE.md가 이미 있어도
    // 건너뛰지 않기 위해서다(Claude Code는 둘 다 읽는다). 나머지 템플릿은 그대로 저장소 루트에 둔다.
    const claudeMdRel = join(".claude", "CLAUDE.md");
    const otherTemplateFiles = ["REVIEW.md", "ops/bands.yaml", "ops/detect.sh"];
    const hasClaudeMd = existsSync(join(d.repoRoot as string, claudeMdRel));
    const hasRootClaudeMd = existsSync(join(d.repoRoot as string, "CLAUDE.md"));
    const missingOthers = otherTemplateFiles.filter((f) => !existsSync(join(d.repoRoot as string, f)));
    const missing = hasClaudeMd ? missingOthers : [claudeMdRel, ...missingOthers];
    let templateDetail: string;
    if (missing.length === 0) {
      templateDetail = "모두 있습니다";
    } else if (!hasClaudeMd && hasRootClaudeMd) {
      templateDetail = `SDLC 규칙 파일은 .claude/CLAUDE.md 입니다(루트 CLAUDE.md는 팀 문서로 그대로 둡니다). 누락: ${missing.join(", ")}`;
    } else {
      templateDetail = `누락: ${missing.join(", ")}`;
    }
    checks.push({
      name: "저장소 템플릿",
      ok: missing.length === 0,
      detail: templateDetail,
      fix: missing.length === 0 ? undefined : "npx ai-sdlc-runner init 으로 템플릿을 설치해 주세요 (또는 /sdlc-init)",
      blocking: false,
    });
  } else {
    checks.push({
      name: "대상 저장소",
      ok: false,
      detail: "저장소를 찾지 못했습니다",
      fix: "--repo <path> 로 지정하거나 git 저장소 안에서 실행해 주세요",
      blocking: false,
    });
  }

  // 같은 판정 기준을 src/e2e.ts의 checkEgoLiteReady()와 공유한다: `cliLog("ok")` 스크립트를
  // ego-browser nodejs에 stdin으로 넣어 stdout+stderr를 합친 결과에 "ok"가 있고 "onboarding"이
  // 없으면 준비된 것으로 본다. (doctor는 injectable `exec`를 쓰므로 테스트 가능하도록 별도 구현한다.)
  const egoResult = await tryExec(d.exec, "ego-browser", ["nodejs"], { input: 'cliLog("ok")\n' });
  const egoCombined = `${egoResult.stdout}${egoResult.stderr}`;
  const egoOnboarding = egoCombined.includes("onboarding");
  const egoReady = egoCombined.includes("ok") && !egoOnboarding;
  const egoMissing = !egoReady && !egoOnboarding && egoResult.code === 127;
  let egoDetail: string;
  let egoFix: string | undefined;
  if (egoReady) {
    egoDetail = "준비되었습니다";
  } else if (egoMissing) {
    egoDetail = "ego-browser를 찾을 수 없습니다";
    egoFix = "E2E 데모가 필요하면 ego-browser를 설치해 주세요";
  } else if (egoOnboarding) {
    egoDetail = "ego-browser 온보딩이 아직 완료되지 않았습니다";
    egoFix = "ego-browser nodejs 를 실행해 온보딩을 완료해 주세요";
  } else {
    egoDetail = "ego-browser 응답을 확인하지 못했습니다";
    egoFix = "ego-browser 설치 상태를 확인해 주세요";
  }
  checks.push({
    name: "ego-browser 준비",
    ok: egoReady,
    detail: egoDetail,
    fix: egoFix,
    blocking: false,
  });

  return checks;
}

export function formatChecks(checks: Check[]): string {
  return checks
    .map((c) => {
      const mark = c.ok ? "✅" : c.blocking ? "❌" : "⚠️";
      const fix = c.fix ? ` — ${c.fix}` : "";
      return `${mark} ${c.name}: ${c.detail}${fix}`;
    })
    .join("\n");
}
