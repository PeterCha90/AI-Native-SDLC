import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTokenPrefix, parseChannelInput, createVerifier } from "../src/cli/verify.ts";

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
  assert.equal(sentBody.text, "✅ AI-SDLC 연결 확인 — 이 채널에서 티켓 알림과 승인을 받는다.");
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
