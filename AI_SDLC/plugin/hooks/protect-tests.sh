#!/usr/bin/env bash
# PreToolUse hook: during a bug-fix session (SDLC_BUGFIX=1), block Edit/Write/MultiEdit on files
# that look like tests — during a bug fix the failing test is the specification.
# Reads the Claude Code hook JSON from stdin. exit 0 = allow, exit 2 = block (stderr -> Claude).
# Fails OPEN on any parsing/tooling problem, and whenever SDLC_BUGFIX isn't set to "1" — this hook
# only ever restricts behavior inside an explicitly-declared bug-fix session.
set -u

[ "${SDLC_BUGFIX:-}" = "1" ] || exit 0

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

is_test=0
case "$file_path" in
  */tests/*|*/test/*) is_test=1 ;;
esac
case "$base" in
  test_*.py|*_test.py|*.test.ts|*.test.tsx|*.test.js|*.spec.ts|*.spec.js) is_test=1 ;;
esac

if [ "$is_test" = "1" ]; then
  {
    echo "차단됨(protect-tests): 버그 수정 중에는 실패하는 테스트가 명세다."
    echo "  파일: $file_path"
    echo "  테스트가 아니라 코드를 고쳐라. 테스트 자체가 진짜 잘못됐다면 사람이 직접 고치고"
    echo "  그 이유를 PR에 남겨야 한다."
  } >&2
  exit 2
fi

exit 0
