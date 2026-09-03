#!/usr/bin/env bash
# PreToolUse hook: block Edit/Write/MultiEdit whose new content looks like it embeds a credential.
# Reads the Claude Code hook JSON from stdin. exit 0 = allow, exit 2 = block (stderr -> Claude).
# Fails OPEN on any parsing/tooling problem — same reasoning as guard-protected-paths.sh.
# ponytail: pattern list is a heuristic, not a real secret scanner. Swap in gitleaks/trufflehog
# if false negatives on custom token formats start to matter.
set -u

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && exit 0

extract_texts() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r '
      (.tool_input.content // ""),
      (.tool_input.new_string // ""),
      (.tool_input.edits[]?.new_string // "")
    ' 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
ti = d.get("tool_input") or {}
texts = []
if isinstance(ti.get("content"), str):
    texts.append(ti["content"])
if isinstance(ti.get("new_string"), str):
    texts.append(ti["new_string"])
for e in ti.get("edits") or []:
    if isinstance(e, dict) and isinstance(e.get("new_string"), str):
        texts.append(e["new_string"])
for t in texts:
    print(t)
' 2>/dev/null
  fi
}

texts="$(extract_texts)"
[ -z "$texts" ] && exit 0

pattern='AKIA[0-9A-Z]{16}'
pattern="$pattern|-----BEGIN [A-Z ]*PRIVATE KEY-----"
pattern="$pattern|gh[pousr]_[A-Za-z0-9]{20,}"
pattern="$pattern|xox[baprs]-[A-Za-z0-9-]{10,}"
pattern="$pattern|sk_live_[0-9a-zA-Z]{16,}"
pattern="$pattern|(api[_-]?key|secret|token|passwd|password)[\"'\`]?[[:space:]]*[:=][[:space:]]*[\"'\`][A-Za-z0-9_/+=-]{12,}[\"'\`]"

if printf '%s\n' "$texts" | grep -Eqi "$pattern"; then
  {
    echo "차단됨(block-secrets): 편집 내용에 자격 증명처럼 보이는 문자열이 있다."
    echo "  실제 시크릿이면 .env로 옮기고 커밋하지 마라(.env는 guard-protected-paths가 별도로 보호한다)."
    echo "  오탐(테스트 픽스처 등)이면 사람이 직접 편집하거나 패턴을 조정하라."
  } >&2
  exit 2
fi

exit 0
