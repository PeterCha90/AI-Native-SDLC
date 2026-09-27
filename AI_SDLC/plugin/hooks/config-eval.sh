#!/usr/bin/env bash
# PostToolUse hook: after Edit/Write/MultiEdit touches CLAUDE.md or anything under .claude/, run
# the repo's test suite and report back if it broke. Reads the Claude Code hook JSON from stdin.
# exit 0 = ok, exit 2 = report failure (stderr -> Claude) so it self-corrects in the same turn.
# Fails OPEN (exit 0) on any parsing/tooling problem, when the touched file isn't an agent-config
# file, or when no test command could be detected — missing tooling must never look like "your
# config broke the build".
set -u

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && exit 0

# $1 = jq filter, $2 = dotted python dict path for the same field.
get_field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
cur = d
for key in '$2'.split('.'):
    if not isinstance(cur, dict):
        cur = None
        break
    cur = cur.get(key)
print(cur if isinstance(cur, str) else '')
" 2>/dev/null
  fi
}

tool_name="$(get_field '.tool_name' 'tool_name')"
case "${tool_name:-}" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

file_path="$(get_field '.tool_input.file_path' 'tool_input.file_path')"
[ -z "${file_path:-}" ] && exit 0

base="$(basename -- "$file_path")"
is_config=0
[ "$base" = "CLAUDE.md" ] && is_config=1
case "$file_path" in
  .claude/*|*/.claude/*) is_config=1 ;;
esac
[ "$is_config" = "1" ] || exit 0

npm_has_test() {
  [ -f package.json ] || return 1
  if command -v jq >/dev/null 2>&1; then
    test -n "$(jq -r '.scripts.test // empty' package.json 2>/dev/null)"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "
import json, sys
try:
    d = json.load(open('package.json'))
except Exception:
    sys.exit(1)
sys.exit(0 if (d.get('scripts') or {}).get('test') else 1)
" 2>/dev/null
  else
    return 1
  fi
}

test_cmd=""
if [ -f Makefile ] && grep -Eq '^test[[:space:]]*:' Makefile; then
  test_cmd="make test"
elif npm_has_test; then
  test_cmd="npm test --silent"
elif [ -f pytest.ini ] || [ -f pyproject.toml ]; then
  test_cmd="pytest -q"
fi
[ -z "$test_cmd" ] && exit 0

if command -v timeout >/dev/null 2>&1; then
  output="$(timeout 120 bash -c "$test_cmd" 2>&1)"; status=$?
else
  output="$(bash -c "$test_cmd" 2>&1)"; status=$?
fi

# 124 is `timeout`'s "I killed it" code, not the suite's verdict. A repo whose tests legitimately
# run longer than the limit would otherwise be told its config change broke them on every single
# edit. Report it as inconclusive and fail open — this hook must not become a permanent blocker.
if [ "$status" = "124" ]; then
  echo "config-eval: 테스트가 120초 안에 끝나지 않아 판정을 보류한다(${test_cmd}). 설정 변경의 영향은 사람이 직접 확인하라." >&2
  exit 0
fi

if [ "$status" != "0" ]; then
  {
    echo "차단됨(config-eval): 에이전트 설정(${file_path})이 바뀐 뒤 테스트 스위트가 통과하지 않는다."
    echo "  실행한 명령: $test_cmd"
    echo "  출력(마지막 40줄):"
    printf '%s\n' "$output" | tail -n 40 | sed 's/^/    /'
  } >&2
  exit 2
fi

exit 0
