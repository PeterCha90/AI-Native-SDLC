import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createLinearAdapter } from "../src/adapters/linear.ts";

const secret = "test-webhook-secret";
const adapter = createLinearAdapter({ webhookSecret: secret, apiKey: "unused", teamId: "unused" });

function sign(body: string, key = secret): string {
  return createHmac("sha256", key).update(body, "utf8").digest("hex");
}

interface MockCall {
  url: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only: variables shape differs per call
  body: { query: string; variables: Record<string, any> };
}

/**
 * Mocks global fetch for the duration of a single test (auto-restored by
 * node:test's per-test mock tracker). Each entry in `responses` is returned,
 * in order, as a successful GraphQL response body; the last entry repeats if
 * more requests are made than responses supplied.
 */
function mockFetch(t: TestContext, responses: Array<{ data?: unknown; errors?: Array<{ message: string }> }>): MockCall[] {
  const calls: MockCall[] = [];
  let i = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    const payload = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

test("verify() accepts a correctly signed body", () => {
  const body = JSON.stringify({ hello: "world" });
  const headers = { "linear-signature": sign(body) };
  assert.equal(adapter.verify(headers, body), true);
});

test("verify() rejects a wrong signature", () => {
  const body = JSON.stringify({ hello: "world" });
  const headers = { "linear-signature": sign(body, "wrong-secret") };
  assert.equal(adapter.verify(headers, body), false);
});

test("verify() rejects a tampered body kept with the original signature", () => {
  const body = JSON.stringify({ hello: "world" });
  const headers = { "linear-signature": sign(body) };
  assert.equal(adapter.verify(headers, body + "tampered"), false);
});

test("verify() rejects a missing signature header", () => {
  const body = JSON.stringify({ hello: "world" });
  assert.equal(adapter.verify({}, body), false);
});

test("parse() returns null for events that aren't Issue/create", () => {
  const commentEvent = JSON.stringify({ type: "Comment", action: "create", data: { id: "1" } });
  assert.equal(adapter.parse(commentEvent), null);

  const issueUpdate = JSON.stringify({ type: "Issue", action: "update", data: { id: "1" } });
  assert.equal(adapter.parse(issueUpdate), null);

  assert.equal(adapter.parse("not json"), null);
});

test("parse() converts an Issue/create event into a Ticket", () => {
  const event = JSON.stringify({
    type: "Issue",
    action: "create",
    url: "https://linear.app/team/issue/ENG-1",
    data: {
      id: "abc-123",
      identifier: "ENG-1",
      title: "Something broke",
      description: "It broke.",
      labels: [{ name: "bug" }],
    },
  });
  const ticket = adapter.parse(event);
  assert.ok(ticket);
  assert.equal(ticket?.key, "ENG-1");
  assert.equal(ticket?.title, "Something broke");
  assert.deepEqual(ticket?.labels, ["bug"]);
  assert.equal(ticket?.url, "https://linear.app/team/issue/ENG-1");
});

test("setStateType() moves the issue to the lowest-position state of the given type", async (t) => {
  const calls = mockFetch(t, [
    {
      data: {
        issue: {
          team: {
            states: {
              nodes: [
                { id: "state-high", position: 2 },
                { id: "state-low", position: 1 },
              ],
            },
          },
        },
      },
    },
    { data: { issueUpdate: { success: true } } },
  ]);

  await adapter.setStateType("I1", "completed");

  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.variables.input.stateId, "state-low");
});

test("setStateType() rejects with a message naming the missing type when the team has no such state", async (t) => {
  mockFetch(t, [{ data: { issue: { team: { states: { nodes: [] } } } } }]);
  await assert.rejects(adapter.setStateType("I1", "completed"), /completed/);
});

test("setStateType() moves the issue to the lowest-position state of type 'unstarted'", async (t) => {
  const calls = mockFetch(t, [
    {
      data: {
        issue: {
          team: {
            states: {
              nodes: [
                { id: "unstarted-high", position: 5 },
                { id: "unstarted-low", position: 0 },
              ],
            },
          },
        },
      },
    },
    { data: { issueUpdate: { success: true } } },
  ]);

  await adapter.setStateType("I1", "unstarted");

  assert.equal(calls[0].body.variables.type, "unstarted");
  assert.equal(calls[1].body.variables.input.stateId, "unstarted-low");
});

test("listRecentIssues() returns only parentless issues, sorted ascending by createdAt", async (t) => {
  mockFetch(t, [
    {
      data: {
        issues: {
          nodes: [
            {
              id: "id-2",
              identifier: "ENG-2",
              title: "Second",
              description: "d2",
              url: "https://linear.app/x/issue/ENG-2",
              createdAt: "2026-01-02T00:00:00Z",
              creator: { name: "Bob" },
              labels: { nodes: [] },
            },
            {
              id: "id-1",
              identifier: "ENG-1",
              title: "First",
              description: "d1",
              url: "https://linear.app/x/issue/ENG-1",
              createdAt: "2026-01-01T00:00:00Z",
              creator: { name: "Alice", email: "alice@example.com" },
              labels: { nodes: [{ name: "bug" }] },
            },
          ],
        },
      },
    },
  ]);

  const result = await adapter.listRecentIssues("2026-01-01T00:00:00Z");

  assert.deepEqual(result.map((r) => r.key), ["ENG-1", "ENG-2"]);
  assert.equal(result[0].creator, "Alice");
  assert.equal(result[1].creator, "Bob");
  assert.deepEqual(result[0].labels, ["bug"]);
  assert.equal(result[0].creatorEmail, "alice@example.com");
});

test("getTicket() looks up an issue by key or id and maps it onto a Ticket", async (t) => {
  const calls = mockFetch(t, [
    {
      data: {
        issue: {
          id: "uuid-12",
          identifier: "ENG-12",
          title: "Found it",
          description: "body text",
          url: "https://linear.app/x/issue/ENG-12",
          labels: { nodes: [{ name: "bug" }] },
          creator: { email: "creator@example.com" },
        },
      },
    },
  ]);

  const ticket = await adapter.getTicket("ENG-12");

  assert.equal(calls[0].body.variables.id, "ENG-12");
  assert.equal(ticket.key, "ENG-12");
  assert.equal(ticket.title, "Found it");
  assert.deepEqual(ticket.labels, ["bug"]);
  assert.equal(ticket.creatorEmail, "creator@example.com");
});

test("parse() maps webhook creator.email onto creatorEmail when present", () => {
  const event = JSON.stringify({
    type: "Issue",
    action: "create",
    url: "https://linear.app/team/issue/ENG-1",
    data: {
      id: "abc-123",
      identifier: "ENG-1",
      title: "Something broke",
      description: "It broke.",
      labels: [],
      creator: { email: "reporter@example.com" },
    },
  });
  const ticket = adapter.parse(event);
  assert.ok(ticket);
  assert.equal(ticket?.creatorEmail, "reporter@example.com");
});

test("parse() leaves creatorEmail undefined when the webhook payload has no creator", () => {
  const event = JSON.stringify({
    type: "Issue",
    action: "create",
    data: { id: "abc-123", identifier: "ENG-1", title: "x", description: "", labels: [] },
  });
  const ticket = adapter.parse(event);
  assert.ok(ticket);
  assert.equal(ticket?.creatorEmail, undefined);
});
