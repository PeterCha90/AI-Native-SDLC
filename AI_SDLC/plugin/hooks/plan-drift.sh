#!/usr/bin/env bash
# PreToolUse hook on Bash: before `git commit`, check that every staged file is covered by the
# most recently modified docs/plan/<ticket-id>.md's "변경할 파일" list.
# Reads the Claude Code hook JSON from stdin. exit 0 = allow, exit 2 = block (stderr -> Claude).
# Fails OPEN on any parsing/tooling problem, when the command isn't a git commit, or when no plan
# file exists yet — a misconfigured hook must never block every commit in the repo.
# ponytail: plan-entry-as-directory-prefix matching is a heuristic, not a real path-spec parser
# (no globs, no gitignore-style negation). Upgrade if plans start listing glob patterns.
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
[ "${tool_name:-}" = "Bash" ] || exit 0

command="$(get_field '.tool_input.command' 'tool_input.command')"
[ -z "${command:-}" ] && exit 0

printf '%s' "$command" | grep -Eq '(^|[;&|]|[[:space:]])git[[:space:]]+commit([[:space:]]|$)' || exit 0

# Most recently modified plan file.
plan_file="$(ls -t docs/plan/*.md 2>/dev/null | head -n1)"
[ -z "${plan_file:-}" ] && exit 0
[ -f "$plan_file" ] || exit 0

# Lines under "## 변경할 파일" up to the next "## " heading.
planned_section="$(awk '
  /^## 변경할 파일/ { grab=1; next }
  grab && /^## / { grab=0 }
  grab { print }
' "$plan_file")"
[ -z "$planned_section" ] && exit 0

# Strip list markers/backticks/whitespace, then keep only the first whitespace-delimited token —
# sdlc-plan's template asks for the path plus an annotation ("- `src/api.py` (수정)"), and without
# dropping that annotation nothing would ever match. Trailing "/" goes too, so a directory entry
# like "src/bar/" normalizes to "src/bar" before the "$p"/* prefix match below. Keep only lines
# that look like a path (contain "/" or a "." extension) — ignore blank lines and prose.
# ponytail: first-token means a planned path containing a space can't be expressed. Quote-aware
# parsing if that ever comes up.
planned_paths="$(printf '%s\n' "$planned_section" \
  | sed -E 's/^[[:space:]]*[-*][[:space:]]*//; s/`//g; s/^[[:space:]]+//' \
  | awk '{ print $1 }' \
  | sed -E 's#/+$##' \
  | grep -E '/|\.[A-Za-z0-9]+' || true)"
[ -z "$planned_paths" ] && exit 0

staged="$(git diff --cached --name-only 2>/dev/null || true)"
[ -z "$staged" ] && exit 0

# POSIX-ish loops on purpose: avoid mapfile/arrays since ${CLAUDE_PLUGIN_ROOT}/hooks scripts run
# under whatever "bash" is first on PATH, and macOS still ships bash 3.2 (no mapfile) by default.
offenders=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  # The plan documents themselves are never drift. This hook's own remedy is "update plan.md and
  # re-commit", so blocking the commit that carries that update would be a deadlock.
  case "$f" in
    docs/plan/*.md|*/docs/plan/*.md) continue ;;
  esac
  covered=0
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    case "$f" in
      "$p"|"$p"/*) covered=1; break ;;
    esac
  done < <(printf '%s\n' "$planned_paths")
  [ "$covered" = "0" ] && offenders="$offenders$f
"
done < <(printf '%s\n' "$staged")

if [ -n "$offenders" ]; then
  {
    echo "차단됨(plan-drift): 커밋하려는 파일 중 plan.md(${plan_file})의 \"변경할 파일\"에 없는 것이 있다."
    echo "  파일:"
    printf '%s' "$offenders" | sed 's/^/    /'
    echo "  plan.md를 갱신하고 다시 커밋하거나, 계획에 없는 변경을 빼라."
  } >&2
  exit 2
fi

exit 0
