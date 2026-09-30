#!/usr/bin/env bash
# todo-app e2e 확인. `npm run dev` 로 API(:4100)와 화면(:5180)이 떠 있어야 한다.
#
#   1. 화면이 뜨는지 본다. ego-browser 가 있으면 실제 브라우저로 열어 렌더링된 글자를 읽고,
#      없으면 HTML 응답만 확인한다(저장소를 막 받은 사람도 돌릴 수 있게).
#   2. 같은 제목의 할 일을 API 로 두 번 추가한다. 두 번째는 "이미 있는 할 일"로 거절(4xx)돼야
#      정상이다. 5xx 가 나오면 서버가 중복 처리 중에 죽은 것이다.
#   3. 만든 항목을 지워 목록을 원래대로 돌린다.
#
# exit 0 = 통과, exit 1 = 버그 재현, exit 2 = 환경 문제(서버가 안 떠 있음 등).
# 버그와 환경 문제를 구분해야 06 Maintain 이 환경 문제를 장애로 세지 않는다.
set -uo pipefail

API_URL="${API_URL:-http://localhost:4100}"
APP_URL="${APP_URL:-http://localhost:5180}"

wait_for() {
  local url="$1" name="$2"
  for _ in $(seq 1 20); do
    curl -s -o /dev/null "$url" && return 0
    sleep 0.5
  done
  echo "FAIL: $name 에 연결할 수 없다 ($url). 먼저 npm run dev 를 띄운다." >&2
  exit 2
}

wait_for "$API_URL/api/todos" "API 서버"
wait_for "$APP_URL" "화면"

# 1. 화면
if command -v ego-browser >/dev/null 2>&1; then
  # cliLog() 는 stdout 이 아니라 stderr 로 찍힌다. 2>&1 로 합치지 않으면 스냅샷이 조용히 사라진다.
  snapshot=$(ego-browser nodejs 2>&1 <<JS
const task = await useOrCreateTaskSpace('todo-app e2e')
await openOrReuseTab('$APP_URL', { wait: true, timeout: 20 })
cliLog(await snapshotText())
JS
)
  if ! echo "$snapshot" | grep -qi "daybook"; then
    echo "$snapshot" | tail -20
    echo "FAIL: 화면이 렌더링되지 않았다 (ego-browser 스냅샷에 앱 이름 Daybook 이 없다 — 화면에선 CSS 로 대문자 표시)." >&2
    exit 1
  fi
  echo "ok  화면 렌더링 (ego-browser)"
else
  curl -s "$APP_URL" | grep -q '<div id="root">' || { echo "FAIL: $APP_URL 이 앱 HTML 을 돌려주지 않는다." >&2; exit 1; }
  echo "ok  화면 HTML 응답 (ego-browser 가 없어 브라우저 렌더링은 건너뜀)"
fi

# 2. 중복 추가
title="e2e 중복 확인 $(date +%s)"
post() {
  curl -s -o /tmp/todo-e2e-body.$$ -w '%{http_code}' -X POST "$API_URL/api/todos" \
    -H 'Content-Type: application/json' -d "{\"title\": \"$title\"}"
}
first=$(post)
first_id=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' /tmp/todo-e2e-body.$$)
second=$(post)
rm -f /tmp/todo-e2e-body.$$
echo "    POST 같은 제목 두 번 → $first, $second"

# 3. 정리
[ -n "$first_id" ] && curl -s -o /dev/null -X DELETE "$API_URL/api/todos/$first_id"

if [ "$first" != "201" ]; then
  echo "FAIL: 새 할 일 추가가 $first 로 실패했다." >&2
  exit 1
fi
case "$second" in
  4??) echo "ok  중복 추가는 $second 로 거절됨" ;;
  5??)
    echo "FAIL: 같은 제목을 두 번 추가하면 서버가 $second 로 죽는다 (server/index.mjs 의 POST /api/todos 중복 처리)." >&2
    exit 1 ;;
  *)
    echo "FAIL: 같은 제목이 두 번 추가됐다 ($second). 중복은 4xx 로 거절해야 한다." >&2
    exit 1 ;;
esac

echo "PASS"
exit 0
