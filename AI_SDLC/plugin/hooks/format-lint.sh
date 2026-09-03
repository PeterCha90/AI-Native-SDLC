#!/usr/bin/env bash
# PostToolUse hook: after Edit/Write/MultiEdit, auto-format the touched file and, if lint still
# fails, report the errors back to Claude (exit 2) so it self-corrects in the same turn.
# Fails OPEN (exit 0) when the extension has no known formatter or the tool isn't installed —
# missing tooling must never look like "your code is broken".
# ponytail: covers the common JS/TS/Python/Go cases only. Add more extensions here as needed.
set -u

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && exit 0

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
[ -f "$file_path" ] || exit 0

lint_out=""
lint_status=0

case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css|*.md)
    if [ -f package.json ] && command -v npx >/dev/null 2>&1; then
      npx --no-install prettier --write "$file_path" >/dev/null 2>&1 || true
      if [ -f .eslintrc.json ] || [ -f .eslintrc.js ] || [ -f .eslintrc.cjs ] || [ -f eslint.config.js ]; then
        lint_out="$(npx --no-install eslint "$file_path" 2>&1)"; lint_status=$?
      fi
    fi
    ;;
  *.py)
    command -v black >/dev/null 2>&1 && black -q "$file_path" >/dev/null 2>&1
    if command -v ruff >/dev/null 2>&1; then
      lint_out="$(ruff check "$file_path" 2>&1)"; lint_status=$?
    fi
    ;;
  *.go)
    command -v gofmt >/dev/null 2>&1 && gofmt -w "$file_path" >/dev/null 2>&1
    if command -v go >/dev/null 2>&1; then
      lint_out="$(go vet "$file_path" 2>&1)"; lint_status=$?
    fi
    ;;
  *)
    exit 0
    ;;
esac

if [ "$lint_status" != "0" ] && [ -n "$lint_out" ]; then
  {
    echo "format-lint: $file_path 에서 린트 오류가 발견됐다. 고친 뒤 다시 시도하라."
    echo "$lint_out"
  } >&2
  exit 2
fi

exit 0
