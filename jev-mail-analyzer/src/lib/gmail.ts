import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EmailSummary, MailboxStatus } from "./types";
import { mapPool } from "./pool";

/**
 * Reads Gmail server-side via plain `fetch` against an existing OAuth
 * credential file (the JSON shape google-auth writes for workspace-mcp).
 * No googleapis dependency — this is a thin, purpose-built client.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GoogleCredentials {
  token?: string;
  refresh_token: string;
  token_uri: string;
  client_id: string;
  client_secret: string;
  scopes?: string[];
  expiry?: string;
}

interface GmailMessageListResponse {
  messages?: { id: string; threadId: string }[];
  resultSizeEstimate?: number;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessageMetadata {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
}

/* ------------------------------------------------------------------ */
/* Credential loading + token refresh                                  */
/* ------------------------------------------------------------------ */

function credentialsPath(): string {
  if (process.env.GOOGLE_CREDENTIALS_PATH) return process.env.GOOGLE_CREDENTIALS_PATH;
  const email = process.env.GOOGLE_ACCOUNT_EMAIL ?? "petercha90@gmail.com";
  return path.join(os.homedir(), ".config", "workspace-mcp", "credentials", `${email}.json`);
}

type LoadResult = { creds: GoogleCredentials } | { error: string };

async function loadCredentials(): Promise<LoadResult> {
  const filePath = credentialsPath();
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const creds = JSON.parse(raw) as GoogleCredentials;
    if (!creds.refresh_token || !creds.token_uri || !creds.client_id || !creds.client_secret) {
      return { error: `Gmail 자격 증명 파일(${filePath})에 필요한 필드가 없습니다. 샘플 데이터를 표시합니다.` };
    }
    return { creds };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Gmail 자격 증명 파일을 찾을 수 없어 샘플 데이터를 표시합니다. (${filePath}: ${message})`,
    };
  }
}

let tokenCache: { accessToken: string; expiresAt: number } | undefined;

async function getAccessToken(creds: GoogleCredentials): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: "refresh_token",
  });

  const res = await fetch(creds.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google 토큰 갱신 실패 (HTTP ${res.status}) ${text}`.trim());
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return tokenCache.accessToken;
}

async function gmailGet<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail API 오류 (HTTP ${res.status}) ${text}`.trim());
  }
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Header parsing                                                      */
/* ------------------------------------------------------------------ */

function normalizeCharset(charset: string): BufferEncoding {
  const c = charset.toLowerCase();
  if (c === "utf-8" || c === "utf8") return "utf8";
  if (c === "us-ascii" || c === "ascii") return "ascii";
  if (c === "iso-8859-1" || c === "latin1") return "latin1";
  // Charsets Buffer can't decode natively (e.g. EUC-KR) fall back to utf8 —
  // readable most of the time, and never throws.
  return "utf8";
}

/** Decodes RFC 2047 `=?charset?B/Q?...?=` encoded header words. */
function decodeRFC2047(input: string): string {
  const re = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;
  return input.replace(re, (match, charset: string, enc: string, payload: string) => {
    try {
      const encoding = normalizeCharset(charset);
      if (enc.toUpperCase() === "B") {
        return Buffer.from(payload, "base64").toString(encoding);
      }
      // Quoted-printable: '_' is a space, '=XX' is a hex-encoded byte.
      const bytes: number[] = [];
      const q = payload.replace(/_/g, " ");
      for (let i = 0; i < q.length; i++) {
        if (q[i] === "=" && i + 2 < q.length) {
          bytes.push(parseInt(q.slice(i + 1, i + 3), 16));
          i += 2;
        } else {
          bytes.push(q.charCodeAt(i));
        }
      }
      return Buffer.from(bytes).toString(encoding);
    } catch {
      return match;
    }
  });
}

function parseFromHeader(raw: string): { fromName: string; fromAddress: string } {
  const decoded = decodeRFC2047(raw).trim();
  const match = decoded.match(/^(.*)<([^<>]+)>\s*$/);
  if (match) {
    let name = match[1].trim();
    if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
    const address = match[2].trim();
    return { fromName: name.length > 0 ? name : address, fromAddress: address };
  }
  const address = decoded;
  return { fromName: address, fromAddress: address };
}

function htmlUnescape(input: string): string {
  return input
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function getHeader(headers: GmailHeader[], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function toEmailSummary(msg: GmailMessageMetadata): EmailSummary {
  const headers = msg.payload?.headers ?? [];
  const fromRaw = getHeader(headers, "From") ?? "";
  const { fromName, fromAddress } = parseFromHeader(fromRaw);
  const subject = decodeRFC2047(getHeader(headers, "Subject") ?? "(제목 없음)");
  const dateHeader = getHeader(headers, "Date");

  let date: string;
  const fromHeader = dateHeader ? new Date(dateHeader) : undefined;
  if (fromHeader && !isNaN(fromHeader.getTime())) {
    date = fromHeader.toISOString();
  } else {
    const internal = Number(msg.internalDate ?? 0);
    date = new Date(Number.isFinite(internal) ? internal : 0).toISOString();
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: fromRaw,
    fromName,
    fromAddress,
    subject,
    snippet: htmlUnescape(msg.snippet ?? ""),
    date,
    gmailLabels: msg.labelIds ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Cache of the most recently fetched emails, so /api/spam can resolve ids without re-listing. */
const emailCache = new Map<string, EmailSummary>();

function cacheSample(limit: number): EmailSummary[] {
  const emails = SAMPLE_EMAILS.slice(0, limit);
  for (const e of emails) emailCache.set(e.id, e);
  return emails;
}

export async function fetchInbox(limit: number): Promise<{ emails: EmailSummary[]; status: MailboxStatus }> {
  const loaded = await loadCredentials();
  if ("error" in loaded) {
    console.warn(`[gmail] 샘플 데이터로 대체: ${loaded.error}`);
    return { emails: cacheSample(limit), status: { source: "sample", reason: loaded.error } };
  }

  try {
    const token = await getAccessToken(loaded.creds);
    const listUrl = `${GMAIL_API}/messages?maxResults=${limit}&q=in%3Ainbox`;
    const list = await gmailGet<GmailMessageListResponse>(token, listUrl);
    const ids = (list.messages ?? []).map((m) => m.id);
    const metadataParams =
      "format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date";

    const fetched = await mapPool(ids, 10, async (id) => {
      try {
        const url = `${GMAIL_API}/messages/${id}?${metadataParams}`;
        return await gmailGet<GmailMessageMetadata>(token, url);
      } catch {
        return null; // one bad message must not kill the whole inbox fetch
      }
    });

    const emails = fetched
      .filter((m): m is GmailMessageMetadata => m !== null)
      .map(toEmailSummary);
    for (const e of emails) emailCache.set(e.id, e);

    let account = process.env.GOOGLE_ACCOUNT_EMAIL;
    try {
      const profile = await gmailGet<{ emailAddress: string }>(token, `${GMAIL_API}/profile`);
      account = profile.emailAddress;
    } catch {
      // Non-fatal — keep the env-derived account name, if any.
    }

    return {
      emails,
      status: { source: "gmail", account, loadedCount: emails.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A silent downgrade mid-demo is worse than a noisy one — say so in the log.
    console.warn(`[gmail] 조회 실패, 샘플 데이터로 대체: ${message}`);
    return {
      emails: cacheSample(limit),
      status: { source: "sample", reason: `Gmail 조회에 실패해 샘플 데이터를 표시합니다: ${message}` },
    };
  }
}

export async function getMailboxStatus(): Promise<MailboxStatus> {
  const loaded = await loadCredentials();
  if ("error" in loaded) {
    return { source: "sample", reason: loaded.error };
  }

  try {
    const token = await getAccessToken(loaded.creds);
    const profile = await gmailGet<{ emailAddress: string }>(token, `${GMAIL_API}/profile`);
    return { source: "gmail", account: profile.emailAddress };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[gmail] 연결 실패: ${message}`);
    return {
      source: "sample",
      reason: `Gmail 연결에 실패해 샘플 데이터를 표시합니다: ${message}`,
    };
  }
}

/** Resolves ids from the last fetch's cache, falling back to a per-id Gmail lookup. */
export async function getEmailsByIds(ids: string[]): Promise<EmailSummary[]> {
  const missing = ids.filter((id) => !emailCache.has(id));

  if (missing.length > 0) {
    const loaded = await loadCredentials();
    if (!("error" in loaded)) {
      try {
        const token = await getAccessToken(loaded.creds);
        const metadataParams =
          "format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date";
        const fetched = await mapPool(missing, 10, async (id) => {
          try {
            const url = `${GMAIL_API}/messages/${id}?${metadataParams}`;
            const msg = await gmailGet<GmailMessageMetadata>(token, url);
            return toEmailSummary(msg);
          } catch {
            return null;
          }
        });
        for (const e of fetched) if (e) emailCache.set(e.id, e);
      } catch {
        // Fall through — whatever is cached (or sample-matched below) is all we can offer.
      }
    }

    for (const id of missing) {
      if (!emailCache.has(id)) {
        const sample = SAMPLE_EMAILS.find((e) => e.id === id);
        if (sample) emailCache.set(id, sample);
      }
    }
  }

  return ids.map((id) => emailCache.get(id)).filter((e): e is EmailSummary => e !== undefined);
}

/* ------------------------------------------------------------------ */
/* Bundled sample dataset — used whenever Gmail isn't reachable         */
/* ------------------------------------------------------------------ */

function sample(
  id: string,
  from: string,
  fromName: string,
  fromAddress: string,
  subject: string,
  snippet: string,
  date: string,
  gmailLabels: string[],
): EmailSummary {
  return { id, threadId: id, from, fromName, fromAddress, subject, snippet, date, gmailLabels };
}

const SAMPLE_EMAILS: EmailSummary[] = [
  sample(
    "sample-01",
    '"김지현" <jihyun.kim@partner-corp.com>',
    "김지현",
    "jihyun.kim@partner-corp.com",
    "3분기 협업 제안서 검토 요청드립니다",
    "안녕하세요, 지난 미팅에서 논의한 협업 제안서 초안을 첨부드립니다. 이번 주 금요일까지 검토 의견 부탁드립니다.",
    "2026-09-19T02:14:00.000Z",
    ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
  ),
  sample(
    "sample-02",
    "Sarah Connor <sarah.connor@acme-client.com>",
    "Sarah Connor",
    "sarah.connor@acme-client.com",
    "Contract renewal — signature needed by Friday",
    "Hi, following up on our call. Could you have the updated contract signed and returned by end of week?",
    "2026-09-19T05:40:00.000Z",
    ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
  ),
  sample(
    "sample-03",
    '"엄마" <mom.choi@naver.com>',
    "엄마",
    "mom.choi@naver.com",
    "이번 주말에 집에 올 수 있니",
    "잘 지내니? 이번 주말에 할머니 생신이라 다 같이 모이기로 했어. 시간 괜찮으면 연락해줘.",
    "2026-09-18T11:05:00.000Z",
    ["INBOX", "CATEGORY_PERSONAL"],
  ),
  sample(
    "sample-04",
    "Mike Tanaka <mike.tanaka88@gmail.com>",
    "Mike Tanaka",
    "mike.tanaka88@gmail.com",
    "long time no see!",
    "Hey! It's been forever, saw your post the other day. We should grab coffee sometime next week, are you free?",
    "2026-09-17T23:20:00.000Z",
    ["INBOX", "CATEGORY_PERSONAL"],
  ),
  sample(
    "sample-05",
    '"쿠팡" <marketing@coupang.com>',
    "쿠팡",
    "marketing@coupang.com",
    "[쿠팡] 가을맞이 최대 70% 할인, 오늘만!",
    "회원님만을 위한 특별 할인이 시작됐어요. 지금 바로 확인하고 최대 70% 혜택을 받아보세요.",
    "2026-09-19T00:00:00.000Z",
    ["INBOX", "CATEGORY_PROMOTIONS"],
  ),
  sample(
    "sample-06",
    "Spotify <no-reply@spotify.com>",
    "Spotify",
    "no-reply@spotify.com",
    "3 months of Premium for ₩1,900 — ends soon",
    "Your favorite playlists sound even better on Premium. Upgrade now and save before this offer disappears.",
    "2026-09-16T14:30:00.000Z",
    ["INBOX", "CATEGORY_PROMOTIONS"],
  ),
  sample(
    "sample-07",
    '"쿠팡 배송" <delivery@coupang.com>',
    "쿠팡 배송",
    "delivery@coupang.com",
    "[쿠팡] 상품이 배송 완료되었습니다",
    "주문하신 상품(무선 이어폰 외 1건)이 문 앞에 배송 완료되었습니다. 이용해 주셔서 감사합니다.",
    "2026-09-19T07:12:00.000Z",
    ["INBOX", "CATEGORY_UPDATES"],
  ),
  sample(
    "sample-08",
    "GitHub <noreply@github.com>",
    "GitHub",
    "noreply@github.com",
    "[GitHub] A new sign-in from Seoul, South Korea",
    "We noticed a new sign-in to your account from a device we don't recognize. If this was you, no action is needed.",
    "2026-09-18T18:02:00.000Z",
    ["INBOX", "CATEGORY_UPDATES"],
  ),
  sample(
    "sample-09",
    '"카카오톡" <noreply@kakao.com>',
    "카카오톡",
    "noreply@kakao.com",
    "[카카오톡] 친구 3명이 생일을 맞이했어요",
    "오늘 친구들의 생일이에요. 카카오톡에서 축하 메시지를 보내보세요.",
    "2026-09-19T00:30:00.000Z",
    ["INBOX", "CATEGORY_SOCIAL"],
  ),
  sample(
    "sample-10",
    "LinkedIn <messages-noreply@linkedin.com>",
    "LinkedIn",
    "messages-noreply@linkedin.com",
    "You have 5 new profile views this week",
    "See who's been checking out your profile and grow your professional network.",
    "2026-09-17T09:15:00.000Z",
    ["INBOX", "CATEGORY_SOCIAL"],
  ),
  sample(
    "sample-11",
    '"신한카드" <card@shinhancard.com>',
    "신한카드",
    "card@shinhancard.com",
    "[신한카드] 9월 이용대금 명세서 안내",
    "고객님의 9월 이용대금은 542,300원이며, 결제일은 9월 25일입니다. 자세한 내역은 앱에서 확인하세요.",
    "2026-09-15T01:00:00.000Z",
    ["INBOX", "CATEGORY_UPDATES"],
  ),
  sample(
    "sample-12",
    "PayPal <service@paypal.com>",
    "PayPal",
    "service@paypal.com",
    "You sent $42.00 USD to DigitalOcean, LLC",
    "Your payment has been completed. Thanks for using PayPal for your recent transaction.",
    "2026-09-14T16:45:00.000Z",
    ["INBOX", "CATEGORY_UPDATES"],
  ),
  sample(
    "sample-13",
    '"KB국민은행 보안센터" <security@kb-verify-account.com>',
    "KB국민은행 보안센터",
    "security@kb-verify-account.com",
    "[긴급] 고객님의 계좌가 일시 제한되었습니다. 본인확인 필요",
    "비정상적인 접근이 감지되어 계좌 이용이 제한되었습니다. 아래 링크에서 즉시 본인확인을 완료하지 않으면 계좌가 영구 정지됩니다.",
    "2026-09-19T04:55:00.000Z",
    ["INBOX", "SPAM"],
  ),
  sample(
    "sample-14",
    '"행복론" <loan-fast@easymoney-kr.biz>',
    "행복론",
    "loan-fast@easymoney-kr.biz",
    "무담보 최저 2.4%, 당일 입금 가능한 대출 안내",
    "신용등급 상관없이 누구나 가능! 서류 없이 5분 신청, 당일 최대 5천만원까지 입금됩니다. 지금 바로 상담 신청하세요.",
    "2026-09-18T08:20:00.000Z",
    ["INBOX", "SPAM"],
  ),
  sample(
    "sample-15",
    "Crypto Wealth Team <support@doublecoin-invest.net>",
    "Crypto Wealth Team",
    "support@doublecoin-invest.net",
    "Double your Bitcoin in 24 hours — guaranteed returns",
    "Send any amount of BTC to our verified wallet and receive 2x back within 24 hours. Limited slots available today only!",
    "2026-09-17T12:10:00.000Z",
    ["INBOX", "SPAM"],
  ),
  sample(
    "sample-16",
    "International Prize Committee <claims@lottowinner-intl.org>",
    "International Prize Committee",
    "claims@lottowinner-intl.org",
    "CONGRATULATIONS! You have won $1,000,000 USD",
    "Your email address was randomly selected as the winner of our international lottery. To claim your prize, reply with your full name, address, and bank details.",
    "2026-09-16T20:05:00.000Z",
    ["INBOX", "SPAM"],
  ),
  sample(
    "sample-17",
    '"오렌지테크 인사팀" <hr@orangetech.co.kr>',
    "오렌지테크 인사팀",
    "hr@orangetech.co.kr",
    "백엔드 개발자 면접 일정 조율 요청",
    "서류 전형에 합격하셨습니다. 다음 주 화요일 또는 목요일 오후 중 편하신 시간을 알려주시면 면접 일정을 확정하겠습니다.",
    "2026-09-18T03:40:00.000Z",
    ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
  ),
  sample(
    "sample-18",
    "Notion <team@mail.notion.so>",
    "Notion",
    "team@mail.notion.so",
    "We're updating our Privacy Policy on October 1",
    "We're writing to let you know about upcoming changes to our Privacy Policy, effective October 1, 2026. No action is required.",
    "2026-09-13T10:00:00.000Z",
    ["INBOX", "CATEGORY_UPDATES"],
  ),
];
