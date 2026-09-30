// TODO API 의 기본 동작. 서버를 빈 포트로 띄우고 실제 HTTP 로 두드린다.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "todo-server-"));
process.env.ACCESS_LOG = join(dir, "access.jsonl");

const { server } = await import("../server/index.mjs");
let base;

before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, body, raw) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

test("목록을 돌려준다", async () => {
  const { status, data } = await call("GET", "/api/todos");
  assert.equal(status, 200);
  assert.ok(Array.isArray(data));
});

test("할 일을 만들고, 체크하고, 지운다", async () => {
  const created = await call("POST", "/api/todos", { title: "  테스트 항목  " });
  assert.equal(created.status, 201);
  assert.equal(created.data.title, "테스트 항목");
  assert.equal(created.data.done, false);

  const patched = await call("PATCH", `/api/todos/${created.data.id}`, { done: true });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.done, true);

  const removed = await call("DELETE", `/api/todos/${created.data.id}`);
  assert.equal(removed.status, 204);
  const list = await call("GET", "/api/todos");
  assert.ok(!list.data.some((t) => t.id === created.data.id));
});

test("빈 제목과 너무 긴 제목은 400", async () => {
  assert.equal((await call("POST", "/api/todos", { title: "" })).status, 400);
  assert.equal((await call("POST", "/api/todos", { title: "   " })).status, 400);
  assert.equal((await call("POST", "/api/todos", { title: "가".repeat(121) })).status, 400);
});

test("깨진 JSON 과 잘못된 done 은 400", async () => {
  assert.equal((await call("POST", "/api/todos", undefined, "{not json")).status, 400);
  const { data } = await call("POST", "/api/todos", { title: "done 검증용" });
  assert.equal((await call("PATCH", `/api/todos/${data.id}`, { done: "yes" })).status, 400);
});

test("없는 할 일과 없는 경로는 404, 지원하지 않는 메서드는 405", async () => {
  assert.equal((await call("PATCH", "/api/todos/nope", { done: true })).status, 404);
  assert.equal((await call("DELETE", "/api/todos/nope")).status, 404);
  assert.equal((await call("GET", "/api/nothing")).status, 404);
  assert.equal((await call("PUT", "/api/todos")).status, 405);
});

test("요청마다 접근 로그를 남기고, /api/_ops 는 남기지 않는다", async () => {
  await call("GET", "/api/todos");
  await call("GET", "/api/_ops/chaos");
  const lines = readFileSync(process.env.ACCESS_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const last = lines.at(-1);
  assert.equal(last.route, "/api/todos");
  assert.equal(last.status, 200);
  assert.ok(!lines.some((l) => l.path.startsWith("/api/_ops")));
  const bad = lines.find((l) => l.status === 400);
  assert.ok(bad.error, "에러 응답은 메시지를 로그에 남긴다");
});
