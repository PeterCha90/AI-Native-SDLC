import { DEFAULT_GATE_ROLES, type FileConfig } from "../config.ts";
import { repoLayout, type RepoLayout } from "../paths.ts";
import { readCredentials, readUserConfig, writeCredentials, writeUserConfig, type Credentials } from "../user-config.ts";
import { checkTokenPrefix, parseChannelInput, type Verifier } from "./verify.ts";

export interface Prompter {
  text(o: { message: string; initialValue?: string; placeholder?: string }): Promise<string | symbol>;
  password(o: { message: string }): Promise<string | symbol>;
  select<T>(o: { message: string; options: Array<{ value: T; label: string; hint?: string }>; initialValue?: T }): Promise<T | symbol>;
  confirm(o: { message: string; initialValue?: boolean }): Promise<boolean | symbol>;
  note(msg: string, title?: string): void;
  log(msg: string): void;
  isCancel(v: unknown): boolean;
}

export interface InitDeps {
  prompter: Prompter;
  verifier: Verifier;
  repoRoot: string;
  home: string;
  installTemplates: (repoRoot: string) => Promise<string[]>;
  now?: () => Date;
}

/** Role names approval gates can be restricted to — the distinct values of DEFAULT_GATE_ROLES. */
const ROLE_NAMES = Array.from(new Set(Object.values(DEFAULT_GATE_ROLES)));

type RetryOutcome<V> = { cancelled: true } | { failed: true } | { ok: true; value: V };

/**
 * Runs `ask` up to `maxAttempts` times, feeding each raw answer through `check`. `check` returns
 * either the accepted value or a Korean error message to show before re-asking. Cancelling (per
 * `prompter.isCancel`) stops immediately; running out of attempts stops without saving — matches
 * spec §5 "검증 실패는 그 단계만 재질문(최대 3회, 이후 중단·미저장)".
 */
async function withRetry<V>(
  prompter: Prompter,
  ask: () => Promise<string | symbol>,
  check: (input: string) => Promise<{ ok: true; value: V } | { ok: false; message: string }>,
  maxAttempts = 3,
): Promise<RetryOutcome<V>> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await ask();
    if (prompter.isCancel(raw)) return { cancelled: true };
    const result = await check(raw as string);
    if (result.ok) return { ok: true, value: result.value };
    prompter.log(result.message);
    if (attempt === maxAttempts) return { failed: true };
  }
  return { failed: true };
}

function abort(layout: RepoLayout): { saved: false; layout: RepoLayout } {
  return { saved: false, layout };
}

export async function runInit(d: InitDeps): Promise<{ saved: boolean; layout: RepoLayout }> {
  const { prompter, verifier } = d;
  const layout = repoLayout(d.home, d.repoRoot);
  const existingConfig = (await readUserConfig(layout.configPath)) ?? {};
  const existingCreds = await readCredentials(layout.credentialsPath);

  // Step 2 — Slack app existence.
  const hasApp = await prompter.select<"have" | "none">({
    message: "Slack 앱이 이미 있는가?",
    options: [
      { value: "have", label: "있다 — 바로 토큰을 입력한다" },
      { value: "none", label: "아직 없다" },
    ],
  });
  if (prompter.isCancel(hasApp)) return abort(layout);
  if (hasApp === "none") {
    prompter.note(
      "다른 터미널에서 `npx ai-sdlc-runner manifest --open` 을 실행해 매니페스트로 앱을 먼저 만든다.",
      "Slack 앱 만들기",
    );
  }

  // Step 3 — Slack bot token (xoxb).
  const botOutcome = await withRetry<{ token: string; team: string; botName: string }>(
    prompter,
    () =>
      prompter.password({
        message: `Slack 봇 토큰 (xoxb-...)${existingCreds.slackBotToken ? " [Enter=기존 값 유지]" : ""}`,
      }),
    async (raw) => {
      const trimmed = raw.trim();
      const token = trimmed === "" ? (existingCreds.slackBotToken ?? "") : trimmed;
      if (!token) return { ok: false, message: "봇 토큰이 필요하다." };
      const prefixError = checkTokenPrefix("slackBot", token);
      if (prefixError) return { ok: false, message: prefixError };
      const verified = await verifier.slackBot(token);
      if (!verified.ok) return { ok: false, message: `검증 실패: ${verified.error}` };
      prompter.log(`확인됨 — ${verified.team} 워크스페이스 · 봇 이름 ${verified.botName}`);
      return { ok: true, value: { token, team: verified.team, botName: verified.botName } };
    },
  );
  if (!("ok" in botOutcome)) return abort(layout);
  const { token: slackBotToken, botName } = botOutcome.value;

  // Step 4 — Slack app token (xapp).
  const appOutcome = await withRetry<string>(
    prompter,
    () =>
      prompter.password({
        message: `Slack 앱 토큰 (xapp-...)${existingCreds.slackAppToken ? " [Enter=기존 값 유지]" : ""}`,
      }),
    async (raw) => {
      const trimmed = raw.trim();
      const token = trimmed === "" ? (existingCreds.slackAppToken ?? "") : trimmed;
      if (!token) return { ok: false, message: "앱 토큰이 필요하다." };
      const prefixError = checkTokenPrefix("slackApp", token);
      if (prefixError) return { ok: false, message: prefixError };
      const verified = await verifier.slackApp(token);
      if (!verified.ok) return { ok: false, message: `검증 실패: ${verified.error}` };
      return { ok: true, value: token };
    },
  );
  if (!("ok" in appOutcome)) return abort(layout);
  const slackAppToken = appOutcome.value;

  // Step 5 — Linear API key, then team selection.
  const linearOutcome = await withRetry<{ apiKey: string; teams: Array<{ id: string; key: string; name: string }> }>(
    prompter,
    () =>
      prompter.password({
        message: `Linear API 키 (lin_api_...)${existingCreds.linearApiKey ? " [Enter=기존 값 유지]" : ""}`,
      }),
    async (raw) => {
      const trimmed = raw.trim();
      const apiKey = trimmed === "" ? (existingCreds.linearApiKey ?? "") : trimmed;
      if (!apiKey) return { ok: false, message: "Linear API 키가 필요하다." };
      const prefixError = checkTokenPrefix("linear", apiKey);
      if (prefixError) return { ok: false, message: prefixError };
      const verified = await verifier.linear(apiKey);
      if (!verified.ok) return { ok: false, message: `검증 실패: ${verified.error}` };
      prompter.log(`확인됨 — ${verified.viewer}`);
      return { ok: true, value: { apiKey, teams: verified.teams } };
    },
  );
  if (!("ok" in linearOutcome)) return abort(layout);
  const { apiKey: linearApiKey, teams } = linearOutcome.value;

  const teamChoice = await prompter.select<string>({
    message: "Linear 팀을 선택한다",
    options: teams.map((t) => ({ value: t.id, label: `${t.name} (${t.key})` })),
    initialValue: existingConfig.linearTeamId,
  });
  if (prompter.isCancel(teamChoice)) return abort(layout);
  const linearTeamId = teamChoice as string;

  // Step 6 — Slack channel (verified by sending the connection-check message).
  const channelOutcome = await withRetry<string>(
    prompter,
    () => prompter.text({ message: "Slack 채널 ID 또는 채널 링크", initialValue: existingConfig.slack?.channelId }),
    async (raw) => {
      const trimmed = raw.trim();
      const channelId = parseChannelInput(trimmed) ?? trimmed;
      if (!channelId) return { ok: false, message: "채널을 입력해야 한다." };
      const posted = await verifier.postTest(slackBotToken, channelId);
      if (!posted.ok) {
        if (posted.error === "not_in_channel") {
          return { ok: false, message: `봇이 채널에 없다. Slack에서 "/invite @${botName}" 을 실행한 뒤 다시 시도한다.` };
        }
        return { ok: false, message: `메시지 전송 실패: ${posted.error}` };
      }
      return { ok: true, value: channelId };
    },
  );
  if (!("ok" in channelOutcome)) return abort(layout);
  const channelId = channelOutcome.value;

  // Step 7 — Approval roles (optional), from Slack user groups.
  const roleGroups: Record<string, string> = {};
  const wantRoleGroups = await prompter.confirm({
    message: "승인 역할을 Slack 사용자 그룹으로 제한할까? (건너뛰면 채널 누구나 승인 가능)",
    initialValue: false,
  });
  if (prompter.isCancel(wantRoleGroups)) return abort(layout);
  if (wantRoleGroups) {
    const groups = await verifier.userGroups(slackBotToken);
    for (const role of ROLE_NAMES) {
      const choice = await prompter.select<string>({
        message: `${role} 승인자 그룹`,
        options: [
          { value: "", label: "(제한 없음 — 채널 누구나)" },
          ...groups.map((g) => ({ value: g.id, label: `@${g.handle} (${g.name})` })),
        ],
        initialValue: existingConfig.slack?.roleGroups?.[role] ?? "",
      });
      if (prompter.isCancel(choice)) return abort(layout);
      if (choice) roleGroups[role] = choice as string;
    }
  }

  // Step 8 — Start mode.
  const startModeChoice = await prompter.select<"button" | "auto">({
    message: "새 티켓 알림 시 시작 방식",
    options: [
      { value: "button", label: "버튼 — 사람이 '▶ 시작'을 눌러야 시작한다" },
      { value: "auto", label: "자동 — 알림과 동시에 자동 시작한다" },
    ],
    initialValue: existingConfig.slack?.startMode ?? "button",
  });
  if (prompter.isCancel(startModeChoice)) return abort(layout);

  // Step 9 — Repo templates.
  const wantTemplates = await prompter.confirm({
    message: "저장소에 CLAUDE.md·REVIEW.md·ops/ 템플릿을 설치할까? (이미 있는 파일은 건너뛴다)",
    initialValue: true,
  });
  if (prompter.isCancel(wantTemplates)) return abort(layout);
  if (wantTemplates) {
    await d.installTemplates(d.repoRoot);
  }

  // Step 10 — Save.
  await writeCredentials(layout.credentialsPath, {
    slackBotToken,
    slackAppToken,
    linearApiKey,
    linearWebhookSecret: existingCreds.linearWebhookSecret,
  });
  const newConfig: FileConfig = {
    ...existingConfig,
    ticketSource: "linear",
    repoPath: d.repoRoot,
    linearTeamId,
    linearTrigger: "poll",
    slack: {
      channelId,
      startMode: startModeChoice as "button" | "auto",
      roleGroups,
    },
  };
  await writeUserConfig(layout.configPath, newConfig);

  prompter.note("설정을 저장했다.\n다음: npx ai-sdlc-runner start", "완료");
  return { saved: true, layout };
}

export async function runInitNonInteractive(
  d: Omit<InitDeps, "prompter"> & { env: NodeJS.ProcessEnv; channel?: string; team?: string },
): Promise<{ saved: boolean; errors: string[] }> {
  const errors: string[] = [];
  const layout = repoLayout(d.home, d.repoRoot);
  const existingCreds = await readCredentials(layout.credentialsPath);

  const slackBotToken = d.env.SLACK_BOT_TOKEN ?? existingCreds.slackBotToken ?? "";
  const slackAppToken = d.env.SLACK_APP_TOKEN ?? existingCreds.slackAppToken ?? "";
  const linearApiKey = d.env.LINEAR_API_KEY ?? existingCreds.linearApiKey ?? "";
  const linearWebhookSecret = d.env.LINEAR_WEBHOOK_SECRET ?? existingCreds.linearWebhookSecret;
  const channel = d.channel;
  const team = d.team;

  if (!slackBotToken) errors.push("SLACK_BOT_TOKEN이 필요하다.");
  else {
    const prefixError = checkTokenPrefix("slackBot", slackBotToken);
    if (prefixError) errors.push(prefixError);
  }
  if (!slackAppToken) errors.push("SLACK_APP_TOKEN이 필요하다.");
  else {
    const prefixError = checkTokenPrefix("slackApp", slackAppToken);
    if (prefixError) errors.push(prefixError);
  }
  if (!linearApiKey) errors.push("LINEAR_API_KEY가 필요하다.");
  else {
    const prefixError = checkTokenPrefix("linear", linearApiKey);
    if (prefixError) errors.push(prefixError);
  }
  if (!channel) errors.push("--channel 플래그가 필요하다.");
  if (!team) errors.push("--team 플래그가 필요하다.");

  if (errors.length > 0) return { saved: false, errors };

  const botVerify = await d.verifier.slackBot(slackBotToken);
  if (!botVerify.ok) errors.push(`Slack 봇 토큰 검증 실패: ${botVerify.error}`);
  const appVerify = await d.verifier.slackApp(slackAppToken);
  if (!appVerify.ok) errors.push(`Slack 앱 토큰 검증 실패: ${appVerify.error}`);
  const linearVerify = await d.verifier.linear(linearApiKey);
  if (!linearVerify.ok) errors.push(`Linear API 키 검증 실패: ${linearVerify.error}`);

  if (errors.length > 0) return { saved: false, errors };

  const postResult = await d.verifier.postTest(slackBotToken, channel as string);
  if (!postResult.ok) errors.push(`채널 테스트 메시지 전송 실패: ${postResult.error}`);

  if (errors.length > 0) return { saved: false, errors };

  const credentials: Credentials = { slackBotToken, slackAppToken, linearApiKey, linearWebhookSecret };
  await writeCredentials(layout.credentialsPath, credentials);
  await writeUserConfig(layout.configPath, {
    ticketSource: "linear",
    repoPath: d.repoRoot,
    linearTeamId: team as string,
    linearTrigger: "poll",
    slack: { channelId: channel as string, startMode: "button", roleGroups: {} },
  });

  await d.installTemplates(d.repoRoot);

  return { saved: true, errors: [] };
}
