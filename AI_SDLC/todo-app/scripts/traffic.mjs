// 부하 생성기. UI 버튼과 같은 요청을 터미널에서 보낸다.
//
//   npm run traffic                # 정상 요청 30건
//   npm run traffic -- 4xx 20      # 400/404 요청 20건
//   npm run traffic -- mixed 40    # 정상 70%, 4xx 30%
//   npm run traffic -- dup 8       # 같은 제목 반복 추가 (중복 처리 경로)
const API = process.env.API_URL ?? "http://localhost:4100";
const [kind = "ok", nArg = "30"] = process.argv.slice(2);
const n = Number(nArg);

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.status;
}

const ok = () => call("GET", "/api/todos");
const bad = (i) => (i % 2 ? call("POST", "/api/todos", { title: "" }) : call("DELETE", `/api/todos/no-such-${i}`));

const dup = () => call("POST", "/api/todos", { title: "우유 사기" });

const counts = {};
for (let i = 0; i < n; i++) {
  const status = await (kind === "dup" ? dup() : kind === "4xx" ? bad(i) : kind === "mixed" && Math.random() < 0.3 ? bad(i) : ok());
  counts[status] = (counts[status] ?? 0) + 1;
}
console.log(`[traffic] ${kind} ${n}건 →`, counts);
