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
  exec: (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  verifier: Verifier;
  repoRoot: string | null;
  config: FileConfig | null;
  credentials: Credentials;
}

async function tryExec(
  exec: DoctorDeps["exec"],
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    return await exec(cmd, args);
  } catch (err) {
    return { code: 127, stdout: "", stderr: (err as Error).message };
  }
}

const REINIT_FIX = "npx ai-sdlc-runner init 으로 다시 설정한다";

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
    detail: nodeMajor >= 22 ? `${process.version} (>= 22)` : `${process.version} — 22 이상 필요`,
    fix: nodeMajor >= 22 ? undefined : "Node 22 이상을 설치한다 (예: nvm install 22)",
    blocking: nodeMajor < 22,
  });

  const versionResult = await tryExec(d.exec, "claude", ["--version"]);
  checks.push({
    name: "Claude Code 설치",
    ok: versionResult.code === 0,
    detail: versionResult.code === 0 ? versionResult.stdout.trim() : "claude 명령을 찾을 수 없다",
    fix: versionResult.code === 0 ? undefined : "https://claude.com/claude-code 안내에 따라 설치한다",
    blocking: versionResult.code !== 0,
  });

  const authResult = await tryExec(d.exec, "claude", ["auth", "status"]);
  checks.push({
    name: "Claude Code 로그인",
    ok: authResult.code === 0,
    detail: authResult.code === 0 ? "로그인됨" : authResult.stderr || authResult.stdout || "로그인 필요",
    fix: authResult.code === 0 ? undefined : "claude auth login 을 실행한다",
    blocking: authResult.code !== 0,
  });

  const mcpResult = await tryExec(d.exec, "claude", ["mcp", "list"]);
  const linearLine = mcpResult.code === 0 ? findLinearMcpLine(mcpResult.stdout) : null;
  const mcpStatus: McpStatus = linearLine ? classifyMcpLine(linearLine) : "unknown";
  const linearConnected = mcpStatus === "connected";
  const mcpFix =
    mcpStatus === "needs_auth"
      ? "claude mcp 또는 /mcp 로 Linear 인증을 완료한다"
      : linearLine
        ? "claude mcp 또는 /mcp 로 Linear를 다시 연결한다"
        : "claude mcp add 로 Linear MCP를 연결한다";
  checks.push({
    name: "Linear MCP 연결",
    ok: linearConnected,
    detail: linearLine ?? "claude mcp list에 linear가 없다 — 00 Setup이 실패한다",
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
      detail: result.ok ? "연결 가능" : translateVerifyError(result.error),
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
      detail: gitResult.code === 0 ? d.repoRoot : `${d.repoRoot} — git 저장소가 아니다`,
      fix: gitResult.code === 0 ? undefined : "git 저장소 안에서 실행하거나 --repo로 지정한다",
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
      templateDetail = "모두 있음";
    } else if (!hasClaudeMd && hasRootClaudeMd) {
      templateDetail = `SDLC 규칙 파일은 .claude/CLAUDE.md 다(루트 CLAUDE.md는 팀 문서로 그대로 둔다). 누락: ${missing.join(", ")}`;
    } else {
      templateDetail = `누락: ${missing.join(", ")}`;
    }
    checks.push({
      name: "저장소 템플릿",
      ok: missing.length === 0,
      detail: templateDetail,
      fix: missing.length === 0 ? undefined : "npx ai-sdlc-runner init 으로 템플릿을 설치한다 (또는 /sdlc-init)",
      blocking: false,
    });
  } else {
    checks.push({
      name: "대상 저장소",
      ok: false,
      detail: "저장소를 찾지 못했다",
      fix: "--repo <path> 로 지정하거나 git 저장소 안에서 실행한다",
      blocking: false,
    });
  }

  const egoResult = await tryExec(d.exec, "ego-lite", ["--version"]);
  checks.push({
    name: "ego-browser 준비",
    ok: egoResult.code === 0,
    detail: egoResult.code === 0 ? egoResult.stdout.trim() : "ego-lite를 찾을 수 없다",
    fix: egoResult.code === 0 ? undefined : "E2E 데모가 필요하면 ego-browser를 설치한다",
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
