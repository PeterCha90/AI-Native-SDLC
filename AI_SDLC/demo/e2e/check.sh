#!/usr/bin/env bash
# e2e check for the demo Todo app.
#
# What it does:
#   1. POSTs an empty-title todo straight to the API (bypasses the
#      frontend's own guard) — this is how the seeded bug reproduces.
#   2. Opens the running frontend (:5173) with ego-browser and reads
#      the rendered page text.
#   3. If the empty todo made it into the API (bug present) it will
#      render as the "(empty)" placeholder — script exits 1.
#      If the API rejected it (DEMO_STRICT_VALIDATION=1, bug fixed),
#      nothing broke — script exits 0.
#
# Requires backend (:8000) and frontend (:5173) already running
# (`make dev` in another shell/process).
set -uo pipefail

API_URL="${API_URL:-http://localhost:8000}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"

wait_for() {
  local url="$1" name="$2"
  for _ in $(seq 1 20); do
    curl -s -o /dev/null "$url" && return 0
    sleep 0.5
  done
  echo "FAIL: $name not reachable at $url (did you run 'make dev'?)" >&2
  exit 2
}

if ! command -v ego-browser >/dev/null 2>&1; then
  echo "FAIL: ego-browser not installed — cannot run e2e check." >&2
  exit 2
fi

wait_for "$API_URL/health" "backend"
wait_for "$FRONTEND_URL" "frontend"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/todos" \
  -H 'Content-Type: application/json' \
  -d '{"title": ""}')

echo "API POST /todos with empty title -> HTTP $status"

snapshot=$(ego-browser nodejs <<'EOF' 2>&1
const task = await useOrCreateTaskSpace('demo e2e')
await openOrReuseTab('http://localhost:5173', { wait: true, timeout: 20 })
cliLog(await snapshotText())
EOF
)

echo "$snapshot"

if [ "$status" = "201" ] && echo "$snapshot" | grep -q '(empty)'; then
  echo "FAIL: seeded bug reproduced — API accepted an empty title and it rendered as '(empty)'." >&2
  echo "      Fix: reject blank titles in backend/app/main.py (set DEMO_STRICT_VALIDATION=1 or make it the default)." >&2
  exit 1
fi

echo "PASS: no empty todo reached the rendered list."
exit 0
