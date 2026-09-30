// TODO API 서버. 의존성 없이 node:http 로만 돈다.
//
// 모든 /api/todos 요청은 logs/access.jsonl 에 한 줄씩 남는다. 모니터(ops/monitor.mjs)가
// 이 파일을 주기적으로 읽어 에러 비율을 판정하므로, 여기서 나는 4xx/5xx 가 곧 지표다.
//
// 에러는 흉내가 아니라 실제 경로에서 난다.
//   400 — 제목이 비었거나 너무 길다, JSON 이 깨졌다
//   404 — 없는 할 일을 고치거나 지운다, 없는 API 경로
//   500 — 장애 주입(chaos)을 켜면 요청 일부가 "DB 타임아웃" 예외로 죽는다
//
// /api/_ops/* 는 시연 조작용이라 로그에 남기지 않는다. 남기면 관측 행위가 지표를 오염시킨다.
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { ACCESS_LOG, readLog, readState, summarize, windowEntries } from "../ops/metrics.mjs";

const PORT = Number(process.env.PORT ?? 4100);
const STATS_WINDOW_MS = Number(process.env.MONITOR_WINDOW_SEC ?? 120) * 1000;
const MAX_TITLE = 120;

mkdirSync(dirname(ACCESS_LOG), { recursive: true });

let todos = [
  { id: randomUUID(), title: "발표 슬라이드 다시 만들기", done: false, createdAt: new Date().toISOString() },
  { id: randomUUID(), title: "Linear API 키 발급받기", done: true, createdAt: new Date().toISOString() },
  { id: randomUUID(), title: "모니터 켜 두고 장애 주입해 보기", done: false, createdAt: new Date().toISOString() },
];

/** 0~1. 이 비율만큼의 /api/todos 요청이 500 으로 죽는다. */
let chaos = { errorRate: 0 };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  res.statusCode = status;
  if (body === undefined) return res.end();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "요청 본문이 올바른 JSON 이 아니다");
  }
}

function validTitle(title) {
  if (typeof title !== "string" || !title.trim()) throw new HttpError(400, "title 이 비어 있다");
  if (title.length > MAX_TITLE) throw new HttpError(400, `title 은 ${MAX_TITLE}자 이하여야 한다`);
  return title.trim();
}

function findTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) throw new HttpError(404, `할 일 ${id} 를 찾을 수 없다`);
  return todo;
}

async function handleTodos(req, res, id) {
  if (Math.random() < chaos.errorRate) {
    throw new Error("upstream DB timeout: connection pool exhausted (chaos)");
  }

  if (!id && req.method === "GET") return send(res, 200, todos);
  if (!id && req.method === "POST") {
    const { title } = await readJson(req);
    const clean = validTitle(title);
    // 같은 제목의 할 일이 아직 안 끝났으면 새로 만들지 않고 409 로 알려준다.
    const dup = todos.find((t) => !t.done && t.title === clean);
    if (dup) throw new HttpError(409, `이미 ${dup.createdAt.toLocaleDateString("ko-KR")}에 추가한 할 일이다`);
    const todo = { id: randomUUID(), title: clean, done: false, createdAt: new Date().toISOString() };
    todos.push(todo);
    return send(res, 201, todo);
  }
  if (id && req.method === "PATCH") {
    const todo = findTodo(id);
    const body = await readJson(req);
    if (body.title !== undefined) todo.title = validTitle(body.title);
    if (body.done !== undefined) {
      if (typeof body.done !== "boolean") throw new HttpError(400, "done 은 boolean 이어야 한다");
      todo.done = body.done;
    }
    return send(res, 200, todo);
  }
  if (id && req.method === "DELETE") {
    findTodo(id);
    todos = todos.filter((t) => t.id !== id);
    return send(res, 204);
  }
  throw new HttpError(405, `${req.method} 는 지원하지 않는다`);
}

async function handleOps(req, res, path) {
  if (path === "/api/_ops/chaos" && req.method === "GET") return send(res, 200, chaos);
  if (path === "/api/_ops/chaos" && req.method === "POST") {
    const { errorRate } = await readJson(req);
    const rate = Number(errorRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new HttpError(400, "errorRate 는 0~1 사이여야 한다");
    chaos = { errorRate: rate };
    console.log(`[server] 장애 주입 errorRate=${rate}`);
    return send(res, 200, chaos);
  }
  if (path === "/api/_ops/stats" && req.method === "GET") {
    const all = readLog();
    const entries = windowEntries(all, STATS_WINDOW_MS);
    const recentErrors = windowEntries(all, SERIES_SPAN_MS).filter((e) => e.status >= 400).slice(-30).reverse();
    return send(res, 200, {
      windowSec: STATS_WINDOW_MS / 1000,
      ...summarize(entries),
      series: series(all),
      recentErrors,
      chaos,
      monitor: readState(),
    });
  }
  throw new HttpError(404, `없는 ops 경로 ${path}`);
}

/** 콘솔 그래프용. 최근 10분을 15초 칸으로 나눠 칸마다 요청 수와 5xx·4xx 수를 센다. */
const SERIES_SPAN_MS = 10 * 60 * 1000;
const SERIES_STEP_MS = 15 * 1000;
function series(all, now = Date.now()) {
  const n = SERIES_SPAN_MS / SERIES_STEP_MS;
  const end = Math.ceil(now / SERIES_STEP_MS) * SERIES_STEP_MS;
  const start = end - SERIES_SPAN_MS;
  const buckets = Array.from({ length: n }, (_, i) => ({ t: new Date(start + i * SERIES_STEP_MS).toISOString(), total: 0, e5: 0, e4: 0 }));
  for (const e of all) {
    const i = Math.floor((Date.parse(e.ts) - start) / SERIES_STEP_MS);
    if (i < 0 || i >= n) continue;
    const b = buckets[i];
    b.total += 1;
    if (e.status >= 500) b.e5 += 1;
    else if (e.status >= 400) b.e4 += 1;
  }
  return buckets;
}

function routeOf(path) {
  if (path === "/api/todos") return { route: "/api/todos", id: null };
  const m = path.match(/^\/api\/todos\/([^/]+)$/);
  if (m) return { route: "/api/todos/:id", id: decodeURIComponent(m[1]) };
  return { route: path, id: null };
}

export const server = createServer(async (req, res) => {
  const started = performance.now();
  const path = new URL(req.url, "http://localhost").pathname;

  if (path.startsWith("/api/_ops/")) {
    try {
      await handleOps(req, res, path);
    } catch (err) {
      send(res, err.status ?? 500, { error: err.message });
    }
    return;
  }

  const { route, id } = routeOf(path);
  let error;
  try {
    if (route.startsWith("/api/todos")) await handleTodos(req, res, id);
    else throw new HttpError(404, `없는 API 경로 ${path}`);
  } catch (err) {
    error = err.message;
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`[server] 500 ${req.method} ${path} — ${err.message}`);
    send(res, status, { error: status >= 500 ? "서버 내부 오류" : err.message });
  }

  const entry = {
    ts: new Date().toISOString(),
    method: req.method,
    path,
    route,
    status: res.statusCode,
    ms: Math.round(performance.now() - started),
    ...(error ? { error } : {}),
  };
  appendFileSync(ACCESS_LOG, JSON.stringify(entry) + "\n");
});

// 테스트는 이 모듈을 import 해서 빈 포트로 띄운다. 직접 실행할 때만 4100 에서 듣는다.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  server.listen(PORT, () => {
    console.log(`[server] TODO API http://localhost:${PORT}  (접근 로그 ${ACCESS_LOG})`);
  });
}
