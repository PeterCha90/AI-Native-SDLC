import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkTokenPrefix,
  parseChannelInput,
  createVerifier,
  isSlackUrlLike,
  translateVerifyError,
  ERROR_NETWORK,
  ERROR_INVALID_RESPONSE,
} from "../src/cli/verify.ts";

test("checkTokenPrefix accepts correct prefixes", () => {
  assert.equal(checkTokenPrefix("slackBot", "xoxb-123"), null);
  assert.equal(checkTokenPrefix("slackApp", "xapp-123"), null);
  assert.equal(checkTokenPrefix("linear", "lin_api_123"), null);
});

test("checkTokenPrefix detects a swapped slack bot/app token", () => {
  const botErr = checkTokenPrefix("slackBot", "xapp-123");
  assert.ok(botErr);
  assert.match(botErr as string, /앱 토큰/);

  const appErr = checkTokenPrefix("slackApp", "xoxb-123");
  assert.ok(appErr);
  assert.match(appErr as string, /봇 토큰/);
});

test("checkTokenPrefix rejects an unrelated value for linear", () => {
  const err = checkTokenPrefix("linear", "xoxb-123");
  assert.ok(err && err.length > 0);
});

test("parseChannelInput accepts a raw channel id", () => {
  assert.equal(parseChannelInput("C0ABC123"), "C0ABC123");
});

test("parseChannelInput extracts the id from an archive link", () => {
  assert.equal(parseChannelInput("https://acme.slack.com/archives/C0ABC123/p1699999999000"), "C0ABC123");
});

test("parseChannelInput rejects garbage input", () => {
  assert.equal(parseChannelInput("hello world"), null);
});

test("parseChannelInput extracts the id from an archive link with a thread_ts query string", () => {
  assert.equal(
    parseChannelInput("https://acme.slack.com/archives/C0ABC123/p1699999999000?thread_ts=1699999999.000200&cid=C0ABC123"),
    "C0ABC123",
  );
});

test("parseChannelInput extracts the id from an archive link with no trailing message id", () => {
  assert.equal(parseChannelInput("https://acme.slack.com/archives/C0ABC123?thread_ts=1699999999.000200"), "C0ABC123");
});

test("parseChannelInput extracts the id from a client deep link", () => {
  assert.equal(parseChannelInput("https://app.slack.com/client/T02ABCDEF/C0ABC123"), "C0ABC123");
});

test("parseChannelInput extracts the id from a client deep link with a trailing path", () => {
  assert.equal(parseChannelInput("https://app.slack.com/client/T02ABCDEF/C0ABC123/thread/C0ABC123-1699999999.000200"), "C0ABC123");
});

test("parseChannelInput returns null for a URL it cannot parse", () => {
  assert.equal(parseChannelInput("https://acme.slack.com/messages/general"), null);
});

test("isSlackUrlLike recognizes URLs and slack.com hosts, not bare ids or garbage", () => {
  assert.equal(isSlackUrlLike("https://acme.slack.com/archives/C0ABC123"), true);
  assert.equal(isSlackUrlLike("http://app.slack.com/client/T1/C1"), true);
  assert.equal(isSlackUrlLike("slack.com/archives/whatever"), true);
  assert.equal(isSlackUrlLike("C0ABC123"), false);
  assert.equal(isSlackUrlLike("hello world"), false);
});

test("translateVerifyError maps known codes to Korean messages and passes through unknown ones", () => {
  assert.match(translateVerifyError(ERROR_NETWORK), /네트워크/);
  assert.match(translateVerifyError(ERROR_INVALID_RESPONSE), /응답/);
  assert.equal(translateVerifyError("invalid_auth"), "invalid_auth");
});

test("verifier.slackBot maps a successful auth.test", async () => {
  const calls: Array<{ url: string; init: any }> = [];
  const fakeFetch = (async (url: string, init: any) => {
    calls.push({ url: String(url), init });
    return { json: async () => ({ ok: true, team: "Acme", user: "ai-sdlc", user_id: "U1" }) } as Response;
  }) as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.slackBot("xoxb-abc");
  assert.deepEqual(result, { ok: true, team: "Acme", botName: "ai-sdlc", botUserId: "U1" });
  assert.equal(calls[0].url, "https://slack.com/api/auth.test");
  assert.equal(calls[0].init.headers.Authorization, "Bearer xoxb-abc");
});

test("verifier.slackBot surfaces invalid_auth", async () => {
  const fakeFetch = (async () => ({ json: async () => ({ ok: false, error: "invalid_auth" }) })) as unknown as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.slackBot("xoxb-bad");
  assert.deepEqual(result, { ok: false, error: "invalid_auth" });
});

test("verifier.slackApp calls apps.connections.open with the app token", async () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string, init: any) => {
    calls.push(String(url));
    assert.equal(init.headers.Authorization, "Bearer xapp-abc");
    return { json: async () => ({ ok: true }) } as Response;
  }) as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.slackApp("xapp-abc");
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0], "https://slack.com/api/apps.connections.open");
});

test("verifier.postTest sends the connection-check text to the channel", async () => {
  let sentBody: any;
  const fakeFetch = (async (_url: string, init: any) => {
    sentBody = JSON.parse(init.body);
    return { json: async () => ({ ok: true }) } as Response;
  }) as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.postTest("xoxb-abc", "C0ABC123");
  assert.deepEqual(result, { ok: true });
  assert.equal(sentBody.channel, "C0ABC123");
  assert.equal(sentBody.text, "✅ AI-SDLC 연결 확인 — 이 채널에서 티켓 알림과 승인을 받습니다.");
});

test("verifier.postTest surfaces not_in_channel", async () => {
  const fakeFetch = (async () => ({ json: async () => ({ ok: false, error: "not_in_channel" }) })) as unknown as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.postTest("xoxb-abc", "C0ABC123");
  assert.deepEqual(result, { ok: false, error: "not_in_channel" });
});

test("verifier.userGroups maps usergroups.list", async () => {
  const fakeFetch = (async () => ({
    json: async () => ({ ok: true, usergroups: [{ id: "S1", handle: "eng", name: "Engineers" }] }),
  })) as unknown as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.userGroups("xoxb-abc");
  assert.deepEqual(result, [{ id: "S1", handle: "eng", name: "Engineers" }]);
});

test("verifier.userGroups returns an empty list on failure", async () => {
  const fakeFetch = (async () => ({ json: async () => ({ ok: false, error: "missing_scope" }) })) as unknown as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.userGroups("xoxb-abc");
  assert.deepEqual(result, []);
});

test("verifier.users maps members, excluding deleted, bots, and USLACKBOT", async () => {
  const fakeFetch = (async () => ({
    json: async () => ({
      ok: true,
      members: [
        { id: "U1", name: "alice", deleted: false, is_bot: false, profile: { real_name: "Alice Kim" } },
        { id: "U2", name: "deleted-user", deleted: true, is_bot: false, profile: { real_name: "Gone" } },
        { id: "B1", name: "botty", deleted: false, is_bot: true, profile: { real_name: "Bot" } },
        { id: "USLACKBOT", name: "slackbot", deleted: false, is_bot: false, profile: { real_name: "Slackbot" } },
      ],
      response_metadata: { next_cursor: "" },
    }),
  })) as unknown as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.users("xoxb-abc");
  assert.deepEqual(result, [{ id: "U1", name: "alice", realName: "Alice Kim" }]);
});

test("verifier.users paginates via cursor until next_cursor is empty", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeFetch = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (!body.cursor) {
      return {
        json: async () => ({
          ok: true,
          members: [{ id: "U1", name: "alice", deleted: false, is_bot: false, profile: { real_name: "Alice" } }],
          response_metadata: { next_cursor: "page2" },
        }),
      } as Response;
    }
    return {
      json: async () => ({
        ok: true,
        members: [{ id: "U2", name: "bob", deleted: false, is_bot: false, profile: { real_name: "Bob" } }],
        response_metadata: { next_cursor: "" },
      }),
    } as Response;
  }) as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.users("xoxb-abc");
  assert.deepEqual(result, [
    { id: "U1", name: "alice", realName: "Alice" },
    { id: "U2", name: "bob", realName: "Bob" },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].limit, 200);
  assert.equal(calls[0].cursor, undefined);
  assert.equal(calls[1].cursor, "page2");
});

test("verifier.users returns an empty list on failure", async () => {
  const fakeFetch = (async () => ({ json: async () => ({ ok: false, error: "missing_scope" }) })) as unknown as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.users("xoxb-abc");
  assert.deepEqual(result, []);
});

test("verifier.linear maps viewer and teams", async () => {
  const fakeFetch = (async (url: string, init: any) => {
    assert.equal(url, "https://api.linear.app/graphql");
    assert.equal(init.headers.Authorization, "lin_api_abc");
    return {
      json: async () => ({ data: { viewer: { name: "Peter" }, teams: { nodes: [{ id: "T1", key: "ENG", name: "Engineering" }] } } }),
    } as Response;
  }) as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.linear("lin_api_abc");
  assert.deepEqual(result, { ok: true, viewer: "Peter", teams: [{ id: "T1", key: "ENG", name: "Engineering" }] });
});

test("verifier.linear surfaces graphql errors", async () => {
  const fakeFetch = (async () => ({ json: async () => ({ errors: [{ message: "Authentication required" }] }) })) as unknown as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.linear("bad-key");
  assert.deepEqual(result, { ok: false, error: "Authentication required" });
});

test("a rejecting fetch never throws — every verifier method returns network_error", async () => {
  const rejectingFetch = (async () => {
    throw new Error("getaddrinfo ENOTFOUND slack.com");
  }) as unknown as typeof fetch;
  const verifier = createVerifier(rejectingFetch);

  assert.deepEqual(await verifier.slackBot("xoxb-a"), { ok: false, error: ERROR_NETWORK });
  assert.deepEqual(await verifier.slackApp("xapp-a"), { ok: false, error: ERROR_NETWORK });
  assert.deepEqual(await verifier.postTest("xoxb-a", "C1"), { ok: false, error: ERROR_NETWORK });
  assert.deepEqual(await verifier.linear("lin_api_a"), { ok: false, error: ERROR_NETWORK });
  assert.deepEqual(await verifier.userGroups("xoxb-a"), []);
  assert.deepEqual(await verifier.users("xoxb-a"), []);
});

test("userGroups logs the network error instead of swallowing it silently", async () => {
  const rejectingFetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const logs: string[] = [];
  const verifier = createVerifier(rejectingFetch, (msg) => logs.push(msg));
  const result = await verifier.userGroups("xoxb-a");
  assert.deepEqual(result, []);
  assert.ok(logs.some((l) => l.includes("네트워크")));
});

test("a non-JSON response body never throws — every verifier method returns invalid_response", async () => {
  const brokenJsonFetch = (async () => ({
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  })) as unknown as typeof fetch;
  const verifier = createVerifier(brokenJsonFetch);

  assert.deepEqual(await verifier.slackBot("xoxb-a"), { ok: false, error: ERROR_INVALID_RESPONSE });
  assert.deepEqual(await verifier.slackApp("xapp-a"), { ok: false, error: ERROR_INVALID_RESPONSE });
  assert.deepEqual(await verifier.postTest("xoxb-a", "C1"), { ok: false, error: ERROR_INVALID_RESPONSE });
  assert.deepEqual(await verifier.linear("lin_api_a"), { ok: false, error: ERROR_INVALID_RESPONSE });
  assert.deepEqual(await verifier.userGroups("xoxb-a"), []);
  assert.deepEqual(await verifier.users("xoxb-a"), []);
});

test("verifier.linear treats a well-formed but empty JSON body as invalid_response, not a throw", async () => {
  const fakeFetch = (async () => ({ json: async () => ({}) })) as unknown as typeof fetch;
  const verifier = createVerifier(fakeFetch);
  const result = await verifier.linear("lin_api_a");
  assert.deepEqual(result, { ok: false, error: ERROR_INVALID_RESPONSE });
});
