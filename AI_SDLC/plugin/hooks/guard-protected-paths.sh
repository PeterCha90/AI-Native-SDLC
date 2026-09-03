#!/usr/bin/env bash
# PreToolUse hook: block Edit/Write/MultiEdit on protected paths (.env*, infra/, .github/workflows/).
# Reads the Claude Code hook JSON from stdin. exit 0 = allow, exit 2 = block (stderr -> Claude).
# Fails OPEN on any parsing/tooling problem — a misconfigured hook must never silently
# block every edit in the repo.
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

blocked=0
case "$file_path" in
  *.env|*.env.*|*/.env|*/.env.*) blocked=1 ;;
esac
case "$file_path" in
  infra/*|*/infra/*) blocked=1 ;;
esac
case "$file_path" in
  .github/workflows/*|*/.github/workflows/*) blocked=1 ;;
esac

if [ "$blocked" = "1" ]; then
  {
    echo "차단됨(guard-protected-paths): 보호 경로는 에이전트가 직접 편집할 수 없다."
    echo "  파일: $file_path"
    echo "  보호 대상: .env*, infra/, .github/workflows/"
    echo "  필요하면 사람이 직접 수정하고 리뷰 후 커밋하라."
  } >&2
  exit 2
fi

exit 0
