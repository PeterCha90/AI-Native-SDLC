#!/usr/bin/env bash
# PreToolUse hook on Bash: block commands that look like a production deploy unless a human
# has set the release-approval env var. exit 0 = allow, exit 2 = block (stderr -> Claude).
# Fails OPEN when input can't be parsed or the tool isn't Bash.
# ponytail: keyword heuristic, not a real command parser — false negatives are possible.
# Replace with a project-specific deploy-command allowlist if that starts to matter.
set -u

RELEASE_ENV_VAR="RELEASE_APPROVED"

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
[ "${tool_name:-}" = "Bash" ] || exit 0

command="$(get_field '.tool_input.command' 'tool_input.command')"
[ -z "${command:-}" ] && exit 0

is_deploy=0
printf '%s' "$command" | grep -Eqi 'kubectl[[:space:]]+apply|terraform[[:space:]]+apply|flyctl[[:space:]]+deploy|serverless[[:space:]]+deploy|git[[:space:]]+push' && is_deploy=1
printf '%s' "$command" | grep -Eqi 'npm[[:space:]]+publish|vercel[[:space:]]+.*--prod' && is_deploy=1

is_prod=0
printf '%s' "$command" | grep -Eqi '\bprod(uction)?\b' && is_prod=1
printf '%s' "$command" | grep -Eqi 'npm[[:space:]]+publish|vercel[[:space:]]+.*--prod' && is_prod=1

if [ "$is_deploy" = "1" ] && [ "$is_prod" = "1" ]; then
  if [ "${RELEASE_APPROVED:-}" != "1" ]; then
    {
      echo "차단됨(production-gate): 프로덕션 배포로 보이는 명령이며 릴리스 승인이 없다."
      echo "  명령: $command"
      echo "  ${RELEASE_ENV_VAR}=1 을 사람이 명시적으로 설정한 뒤에만 실행하라."
    } >&2
    exit 2
  fi
fi

exit 0
