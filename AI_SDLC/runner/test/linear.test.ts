import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createLinearAdapter } from "../src/adapters/linear.ts";

const secret = "test-webhook-secret";
const adapter = createLinearAdapter({ webhookSecret: secret, apiKey: "unused", teamId: "unused" });

function sign(body: string, key = secret): string {
  return createHmac("sha256", key).update(body, "utf8").digest("hex");
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
