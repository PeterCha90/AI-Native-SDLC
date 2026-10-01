import { test } from "node:test";
import assert from "node:assert/strict";
import { RoleChecker } from "../src/slack/roles.ts";

test("role with no group mapping is unrestricted", async () => {
  const checker = new RoleChecker({
    roleGroups: {},
    listMembers: async () => {
      throw new Error("should not be called");
    },
  });
  const result = await checker.canAct("Engineer", "U1");
  assert.deepEqual(result, { ok: true });
});

test("member of the mapped group can act", async () => {
  const checker = new RoleChecker({
    roleGroups: { "Product Owner": "S1" },
    listMembers: async () => ["U1", "U2"],
  });
  const result = await checker.canAct("Product Owner", "U1");
  assert.deepEqual(result, { ok: true });
});

test("non-member of the mapped group cannot act", async () => {
  const checker = new RoleChecker({
    roleGroups: { "Product Owner": "S1" },
    listMembers: async () => ["U2"],
  });
  const result = await checker.canAct("Product Owner", "U1");
  assert.deepEqual(result, { ok: false, groupId: "S1" });
});

test("listMembers is cached for ttlMs and re-fetched after expiry", async () => {
  let calls = 0;
  let nowMs = 0;
  const checker = new RoleChecker({
    roleGroups: { "Product Owner": "S1" },
    listMembers: async () => {
      calls++;
      return ["U1"];
    },
    now: () => nowMs,
  });

  await checker.canAct("Product Owner", "U1");
  nowMs += 59_000;
  await checker.canAct("Product Owner", "U1");
  assert.equal(calls, 1, "should reuse the cached member list within ttl");

  nowMs += 2_000; // total 61s since first call
  await checker.canAct("Product Owner", "U1");
  assert.equal(calls, 2, "should re-fetch after ttl expires");
});

test("listMembers rejection fails closed", async () => {
  const checker = new RoleChecker({
    roleGroups: { "Product Owner": "S1" },
    listMembers: async () => {
      throw new Error("slack down");
    },
  });
  const result = await checker.canAct("Product Owner", "U1");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.groupId, "S1");
    assert.match(result.error ?? "", /slack down/);
  }
});

test("unrestrictedRoles returns roles without a group mapping", () => {
  const checker = new RoleChecker({
    roleGroups: { "Product Owner": "S1" },
    listMembers: async () => [],
  });
  assert.deepEqual(checker.unrestrictedRoles(["Product Owner", "Engineer", "Code Owner"]), ["Engineer", "Code Owner"]);
});

// ── roleUsers (specific people, no paid-plan user group required) ───────────────

test("a listed user can act when the role has roleUsers but no group", async () => {
  const checker = new RoleChecker({
    roleGroups: {},
    roleUsers: { "Product Owner": ["U1", "U2"] },
    listMembers: async () => {
      throw new Error("should not be called");
    },
  });
  const result = await checker.canAct("Product Owner", "U1");
  assert.deepEqual(result, { ok: true });
});

test("a user not in roleUsers is denied when the role has no group", async () => {
  const checker = new RoleChecker({
    roleGroups: {},
    roleUsers: { "Product Owner": ["U1", "U2"] },
    listMembers: async () => {
      throw new Error("should not be called");
    },
  });
  const result = await checker.canAct("Product Owner", "U3");
  assert.deepEqual(result, { ok: false, userIds: ["U1", "U2"] });
});

test("roleUsers and a group union: a listed user acts without a group lookup, a group member also acts", async () => {
  let listCalls = 0;
  const checker = new RoleChecker({
    roleGroups: { "Product Owner": "S1" },
    roleUsers: { "Product Owner": ["U1"] },
    listMembers: async () => {
      listCalls++;
      return ["U2"];
    },
  });

  const viaUsers = await checker.canAct("Product Owner", "U1");
  assert.deepEqual(viaUsers, { ok: true });
  assert.equal(listCalls, 0, "a listed user must not trigger a group lookup");

  const viaGroup = await checker.canAct("Product Owner", "U2");
  assert.deepEqual(viaGroup, { ok: true });
  assert.equal(listCalls, 1);

  const neither = await checker.canAct("Product Owner", "U3");
  assert.deepEqual(neither, { ok: false, groupId: "S1", userIds: ["U1"] });
});

test("a group lookup error still allows a listed user (checked first) but fails closed for everyone else", async () => {
  const checker = new RoleChecker({
    roleGroups: { "Product Owner": "S1" },
    roleUsers: { "Product Owner": ["U1"] },
    listMembers: async () => {
      throw new Error("slack down");
    },
  });

  const listed = await checker.canAct("Product Owner", "U1");
  assert.deepEqual(listed, { ok: true });

  const notListed = await checker.canAct("Product Owner", "U2");
  assert.equal(notListed.ok, false);
  if (!notListed.ok) {
    assert.equal(notListed.groupId, "S1");
    assert.deepEqual(notListed.userIds, ["U1"]);
    assert.match(notListed.error ?? "", /slack down/);
  }
});

test("unrestrictedRoles excludes roles with only a roleUsers list (no group)", () => {
  const checker = new RoleChecker({
    roleGroups: {},
    roleUsers: { "Product Owner": ["U1"] },
    listMembers: async () => [],
  });
  assert.deepEqual(checker.unrestrictedRoles(["Product Owner", "Engineer"]), ["Engineer"]);
});
