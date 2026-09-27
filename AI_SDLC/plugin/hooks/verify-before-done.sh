#!/usr/bin/env bash
# Stop hook: before Claude finishes, check that the commands listed under plan.md's "성공 기준"
# were actually run at some point in this session's transcript. Reads the Claude Code hook JSON
# from stdin. exit 0 = allow stop, exit 2 = block stop (stderr -> Claude, which then runs the
# missing commands). Fails OPEN on any parsing/tooling problem, when there's no plan file, or when
# the transcript path is missing/unreadable — this hook must never trap a session in a stop loop.
# ponytail: substring match against the raw transcript text, not real command-execution tracking
# (a command merely typed/quoted anywhere would also count as "run"). Upgrade to parsing actual
# tool_use/tool_result events if false negatives start to matter.
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
if isinstance(cur, bool):
    print(str(cur).lower())
else:
    print(cur if isinstance(cur, str) else '')
" 2>/dev/null
  fi
}

stop_hook_active="$(get_field '.stop_hook_active' 'stop_hook_active')"
[ "${stop_hook_active:-}" = "true" ] && exit 0

plan_file="$(ls -t docs/plan/*.md 2>/dev/null | head -n1)"
[ -z "${plan_file:-}" ] && exit 0
[ -f "$plan_file" ] || exit 0

# Lines under "## 성공 기준" up to the next "## " heading.
criteria_section="$(awk '
  /^## 성공 기준/ { grab=1; next }
  grab && /^## / { grab=0 }
  grab { print }
' "$plan_file")"
[ -z "$criteria_section" ] && exit 0

# Backtick-quoted commands anywhere in that section.
commands="$(printf '%s\n' "$criteria_section" | grep -oE '`[^`]+`' | sed -E 's/^`//; s/`$//' || true)"
[ -z "$commands" ] && exit 0

transcript_path="$(get_field '.transcript_path' 'transcript_path')"
[ -z "${transcript_path:-}" ] && exit 0
[ -r "$transcript_path" ] || exit 0

# POSIX-ish loop on purpose: avoid mapfile/arrays since ${CLAUDE_PLUGIN_ROOT}/hooks scripts run
# under whatever "bash" is first on PATH, and macOS still ships bash 3.2 (no mapfile) by default.
unrun=""
while IFS= read -r cmd; do
  [ -z "$cmd" ] && continue
  grep -qF -- "$cmd" "$transcript_path" 2>/dev/null || unrun="$unrun$cmd
"
done < <(printf '%s\n' "$commands")

if [ -n "$unrun" ]; then
  {
    echo "차단됨(verify-before-done): plan.md(${plan_file})의 성공 기준 명령 중 실행한 흔적이 없는 것이 있다."
    echo "  실행하지 않은 것으로 보이는 명령:"
    printf '%s' "$unrun" | sed 's/^/    /'
    echo "  끝났다고 보고하기 전에 위 명령을 실제로 실행하고 결과를 확인하라."
  } >&2
  exit 2
fi

exit 0
