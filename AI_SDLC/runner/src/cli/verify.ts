/**
 * Token-format pre-checks and live Slack/Linear API verification for `init`/`doctor`. Uses plain
 * `fetch` (Node >= 22 has it globally) — no SDKs — and takes the fetch implementation as a
 * parameter so tests can inject a fake instead of hitting the network.
 */
export type TokenKind = "slackBot" | "slackApp" | "linear";

const PREFIXES: Record<TokenKind, string> = {
  slackBot: "xoxb-",
  slackApp: "xapp-",
  linear: "lin_api_",
};

const LABELS: Record<TokenKind, string> = {
  slackBot: "Slack 봇 토큰(xoxb-)",
  slackApp: "Slack 앱 토큰(xapp-)",
  linear: "Linear API 키(lin_api_)",
};

function detectKind(token: string): TokenKind | null {
  for (const kind of Object.keys(PREFIXES) as TokenKind[]) {
    if (token.startsWith(PREFIXES[kind])) return kind;
  }
  return null;
}

/** Returns a Korean reason when the prefix is wrong, or `null` when it matches. */
export function checkTokenPrefix(kind: TokenKind, token: string): string | null {
  const trimmed = token.trim();
  if (trimmed.startsWith(PREFIXES[kind])) return null;

  const actualKind = detectKind(trimmed);
  if (actualKind && actualKind !== kind) {
    return `이 값은 ${LABELS[actualKind]}처럼 보인다. ${LABELS[kind]}를 입력해야 한다.`;
  }
  return `${LABELS[kind]}는 "${PREFIXES[kind]}"로 시작해야 한다.`;
}

/** Accepts a raw channel id ("C0ABC123") or a channel link ("…/archives/C0ABC123/p…"). */
export function parseChannelInput(input: string): string | null {
  const trimmed = input.trim();
  const linkMatch = trimmed.match(/\/archives\/([A-Za-z0-9]+)/);
  if (linkMatch) return linkMatch[1];
  if (/^[A-Za-z][A-Za-z0-9]{6,}$/.test(trimmed)) return trimmed;
  return null;
}

export interface Verifier {
  slackBot(token: string): Promise<{ ok: true; team: string; botName: string; botUserId: string } | { ok: false; error: string }>;
  slackApp(token: string): Promise<{ ok: true } | { ok: false; error: string }>;
  postTest(botToken: string, channel: string): Promise<{ ok: true } | { ok: false; error: string }>;
  userGroups(botToken: string): Promise<Array<{ id: string; handle: string; name: string }>>;
  linear(
    apiKey: string,
  ): Promise<{ ok: true; viewer: string; teams: Array<{ id: string; key: string; name: string }> } | { ok: false; error: string }>;
}

/** Slack Web API "AI-SDLC connected" test message, sent to the chosen channel during `init`. */
export const SLACK_TEST_MESSAGE = "✅ AI-SDLC 연결 확인 — 이 채널에서 티켓 알림과 승인을 받는다.";

export function createVerifier(fetchImpl: typeof fetch = fetch): Verifier {
  async function slackApi(method: string, token: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body ?? {}),
    });
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    async slackBot(token) {
      const data = await slackApi("auth.test", token);
      if (!data.ok) return { ok: false, error: String(data.error ?? "unknown_error") };
      return {
        ok: true,
        team: String(data.team ?? ""),
        botName: String(data.user ?? ""),
        botUserId: String(data.user_id ?? ""),
      };
    },

    async slackApp(token) {
      const data = await slackApi("apps.connections.open", token);
      if (!data.ok) return { ok: false, error: String(data.error ?? "unknown_error") };
      return { ok: true };
    },

    async postTest(botToken, channel) {
      const data = await slackApi("chat.postMessage", botToken, { channel, text: SLACK_TEST_MESSAGE });
      if (!data.ok) return { ok: false, error: String(data.error ?? "unknown_error") };
      return { ok: true };
    },

    async userGroups(botToken) {
      const data = await slackApi("usergroups.list", botToken);
      if (!data.ok || !Array.isArray(data.usergroups)) return [];
      return (data.usergroups as Array<Record<string, unknown>>).map((g) => ({
        id: String(g.id),
        handle: String(g.handle),
        name: String(g.name),
      }));
    },

    async linear(apiKey) {
      const res = await fetchImpl("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "{ viewer { name } teams { nodes { id key name } } }" }),
      });
      const data = (await res.json()) as {
        data?: { viewer?: { name?: string }; teams?: { nodes?: Array<{ id: string; key: string; name: string }> } };
        errors?: Array<{ message?: string }>;
      };
      if (data.errors && data.errors.length > 0) {
        return { ok: false, error: String(data.errors[0]?.message ?? "unknown_error") };
      }
      const viewer = data.data?.viewer?.name;
      if (!viewer) return { ok: false, error: "invalid_response" };
      const teams = (data.data?.teams?.nodes ?? []).map((t) => ({ id: String(t.id), key: String(t.key), name: String(t.name) }));
      return { ok: true, viewer, teams };
    },
  };
}
