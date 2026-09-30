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

/** True when the input is (or looks like) a URL rather than a bare id — used to give a clearer error when link-parsing fails. */
export function isSlackUrlLike(input: string): boolean {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) || /slack\.com/i.test(trimmed);
}

/**
 * Accepts a raw channel id ("C0ABC123"), a channel link ("…/archives/C0ABC123/p…", with or
 * without a trailing `?thread_ts=…` query string), or a client deep link
 * ("https://app.slack.com/client/T0TEAM/C0ABC123…"). Returns `null` when no id can be found —
 * callers should check `isSlackUrlLike` to tell "not a channel id" apart from "a link we
 * couldn't parse".
 */
export function parseChannelInput(input: string): string | null {
  const trimmed = input.trim();

  const archiveMatch = trimmed.match(/\/archives\/([A-Za-z0-9]+)/);
  if (archiveMatch) return archiveMatch[1];

  const clientMatch = trimmed.match(/\/client\/T[A-Za-z0-9]+\/([A-Za-z0-9]+)/);
  if (clientMatch) return clientMatch[1];

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

/** `fetch` itself rejected (offline, DNS, TLS, …) — never thrown further up. */
export const ERROR_NETWORK = "network_error";
/** The HTTP call succeeded but the body wasn't the JSON we expected. */
export const ERROR_INVALID_RESPONSE = "invalid_response";

const ERROR_MESSAGES: Record<string, string> = {
  [ERROR_NETWORK]: "네트워크에 연결하지 못했다 — 인터넷 연결을 확인하고 다시 시도한다.",
  [ERROR_INVALID_RESPONSE]: "서버 응답을 해석하지 못했다 — 잠시 후 다시 시도한다.",
};

/** Maps a verifier error code to a Korean, actionable message; unknown codes pass through as-is. */
export function translateVerifyError(error: string): string {
  return ERROR_MESSAGES[error] ?? error;
}

type RawResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

export function createVerifier(fetchImpl: typeof fetch = fetch, log: (message: string) => void = () => {}): Verifier {
  /** Never throws — a rejected fetch or a non-JSON body both become a `{ ok: false }` result. */
  async function rawFetch(url: string, init: RequestInit): Promise<RawResult> {
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch {
      return { ok: false, error: ERROR_NETWORK };
    }
    try {
      const data = (await res.json()) as Record<string, unknown>;
      return { ok: true, data };
    } catch {
      return { ok: false, error: ERROR_INVALID_RESPONSE };
    }
  }

  async function slackApi(method: string, token: string, body?: Record<string, unknown>): Promise<RawResult> {
    return rawFetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body ?? {}),
    });
  }

  return {
    async slackBot(token) {
      const result = await slackApi("auth.test", token);
      if (!result.ok) return { ok: false, error: result.error };
      const data = result.data;
      if (!data.ok) return { ok: false, error: String(data.error ?? "unknown_error") };
      return {
        ok: true,
        team: String(data.team ?? ""),
        botName: String(data.user ?? ""),
        botUserId: String(data.user_id ?? ""),
      };
    },

    async slackApp(token) {
      const result = await slackApi("apps.connections.open", token);
      if (!result.ok) return { ok: false, error: result.error };
      const data = result.data;
      if (!data.ok) return { ok: false, error: String(data.error ?? "unknown_error") };
      return { ok: true };
    },

    async postTest(botToken, channel) {
      const result = await slackApi("chat.postMessage", botToken, { channel, text: SLACK_TEST_MESSAGE });
      if (!result.ok) return { ok: false, error: result.error };
      const data = result.data;
      if (!data.ok) return { ok: false, error: String(data.error ?? "unknown_error") };
      return { ok: true };
    },

    async userGroups(botToken) {
      const result = await slackApi("usergroups.list", botToken);
      if (!result.ok) {
        log(`Slack 사용자 그룹 조회 실패: ${translateVerifyError(result.error)}`);
        return [];
      }
      const data = result.data;
      if (!data.ok || !Array.isArray(data.usergroups)) {
        if (!data.ok) log(`Slack 사용자 그룹 조회 실패: ${String(data.error ?? "unknown_error")}`);
        return [];
      }
      return (data.usergroups as Array<Record<string, unknown>>).map((g) => ({
        id: String(g.id),
        handle: String(g.handle),
        name: String(g.name),
      }));
    },

    async linear(apiKey) {
      const result = await rawFetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "{ viewer { name } teams { nodes { id key name } } }" }),
      });
      if (!result.ok) return { ok: false, error: result.error };
      const data = result.data as {
        data?: { viewer?: { name?: string }; teams?: { nodes?: Array<{ id: string; key: string; name: string }> } };
        errors?: Array<{ message?: string }>;
      };
      if (data.errors && data.errors.length > 0) {
        return { ok: false, error: String(data.errors[0]?.message ?? "unknown_error") };
      }
      const viewer = data.data?.viewer?.name;
      if (!viewer) return { ok: false, error: ERROR_INVALID_RESPONSE };
      const teams = (data.data?.teams?.nodes ?? []).map((t) => ({ id: String(t.id), key: String(t.key), name: String(t.name) }));
      return { ok: true, viewer, teams };
    },
  };
}
