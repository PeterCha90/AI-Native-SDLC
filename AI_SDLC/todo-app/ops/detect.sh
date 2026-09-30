#!/usr/bin/env bash
# ops/detect.sh — Stage 06(maintain) 결정론적 감지 스크립트.
#
# AI-native SDLC 플레이북이 강조하는 지점: 이상 감지 자체는 모델이 판단하지 않는다.
# ops/bands.yaml에 정의된 baseline/sigma로 deviation = |value - baseline| / sigma 를
# 계산하는 순수 산수이며, 이 스크립트 어디에도 `claude` 호출이 없다. tier가 2 이상일
# 때만 (이 스크립트 밖에서, 러너가) Claude를 read-only 진단/티켓 작성 역할로 부른다.
#
# tier 의미:
#   0 : 정상 범위(<1 sigma)      — action=none
#   1 : action=log      — 기록만 한다. 에이전트 미개입.
#   2 : action=diagnose — Claude를 read-only로 띄워 원인만 진단한다.
#   3 : action=act      — 진단 결과를 새 intent.md로 쓰고 Linear 티켓을 만든다.
#
# exit code: tier 0~1 -> 0, tier 2~3 -> 1 (호출자가 stdout 파싱 없이 분기 가능)
#
# YAML 파싱은 python3 + PyYAML로만 한다. PyYAML이 없으면 애매하게 폴백하지 않고
# 바로 명확한 메시지와 함께 exit 2 한다 — 기준값을 잘못 파싱해서 조용히 틀린 tier를
# 내는 것보다 그 자리에서 죽는 게 낫다.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BANDS_FILE="${BANDS_FILE:-$SCRIPT_DIR/bands.yaml}"

usage() {
  echo "usage: $0 --metric <name> --value <float>" >&2
  echo "       $0 --self-check" >&2
}

# $1 = metric name, $2 = field name (baseline|sigma) -> stdout: 값 하나
read_band() {
  local metric="$1" field="$2"
  python3 - "$BANDS_FILE" "$metric" "$field" <<'PY'
import sys
try:
    import yaml
except ImportError:
    print("ERROR: PyYAML이 설치되어 있지 않다. `pip install pyyaml`로 설치하라.", file=sys.stderr)
    sys.exit(2)

bands_file, metric, field = sys.argv[1], sys.argv[2], sys.argv[3]
with open(bands_file) as f:
    data = yaml.safe_load(f)

m = (data or {}).get("metrics", {}).get(metric)
if m is None:
    print(f"ERROR: bands.yaml에 metric '{metric}'이 없다.", file=sys.stderr)
    sys.exit(2)

val = m.get(field)
if val is None:
    print(f"ERROR: metric '{metric}'에 '{field}' 필드가 없다.", file=sys.stderr)
    sys.exit(2)
print(val)
PY
}

# $1 = value, $2 = baseline, $3 = sigma -> stdout: "<tier> <deviation>"
compute_tier() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
value, baseline, sigma = (float(x) for x in sys.argv[1:4])
deviation = abs(value - baseline) / sigma if sigma != 0 else float("inf")
if deviation < 1:
    tier = 0
elif deviation < 2:
    tier = 1
elif deviation < 3:
    tier = 2
else:
    tier = 3
print(f"{tier} {deviation}")
PY
}

action_for_tier() {
  case "$1" in
    0) echo "none" ;;
    1) echo "log" ;;
    2) echo "diagnose" ;;
    3) echo "act" ;;
  esac
}

summary_for_tier() {
  local metric="$1" tier="$2" value="$3" baseline="$4" sigma="$5" deviation="$6"
  case "$tier" in
    0) echo "정상 범위: $metric=$value (baseline=$baseline, sigma=$sigma, deviation=${deviation}sigma) — 조치 없음." ;;
    1) echo "1sigma 이탈: $metric=$value (baseline=$baseline, deviation=${deviation}sigma) — 기록만 한다." ;;
    2) echo "2sigma 이탈: $metric=$value (baseline=$baseline, deviation=${deviation}sigma) — Claude를 read-only로 띄워 진단한다." ;;
    3) echo "3sigma 이탈: $metric=$value (baseline=$baseline, deviation=${deviation}sigma) — 진단을 intent.md로 쓰고 Linear 티켓을 만든다." ;;
  esac
}

run_detect() {
  local metric="$1" value="$2"
  local baseline sigma tier_and_dev tier deviation action

  baseline="$(read_band "$metric" baseline)" || exit $?
  sigma="$(read_band "$metric" sigma)" || exit $?

  tier_and_dev="$(compute_tier "$value" "$baseline" "$sigma")"
  tier="${tier_and_dev%% *}"
  deviation="${tier_and_dev#* }"
  action="$(action_for_tier "$tier")"

  echo "tier=$tier action=$action"
  summary_for_tier "$metric" "$tier" "$value" "$baseline" "$sigma" "$deviation"

  case "$tier" in
    0|1) exit 0 ;;
    *) exit 1 ;;
  esac
}

self_check() {
  # bands.yaml의 실제 api_5xx_rate(baseline=0.0, sigma=0.02)를 읽어 네 tier 경계를
  # 전부 확인한다. YAML 파싱 경로까지 함께 검증한다.
  local baseline sigma fail=0
  baseline="$(read_band api_5xx_rate baseline)" || exit $?
  sigma="$(read_band api_5xx_rate sigma)" || exit $?

  check() {
    local desc="$1" n_sigma="$2" expected_tier="$3"
    local value out tier
    value="$(python3 -c "print($baseline + $n_sigma * $sigma)")"
    out="$(compute_tier "$value" "$baseline" "$sigma")"
    tier="${out%% *}"
    if [ "$tier" != "$expected_tier" ]; then
      echo "self-check FAIL: $desc (n_sigma=$n_sigma, value=$value) -> tier=$tier (expected $expected_tier)" >&2
      fail=1
    fi
  }

  check "0.5 sigma, tier 0 구간"      0.5 0
  check "1.0 sigma 경계, tier 1 진입" 1.0 1
  check "1.9 sigma, tier 1 구간"      1.9 1
  check "2.0 sigma 경계, tier 2 진입" 2.0 2
  check "2.9 sigma, tier 2 구간"      2.9 2
  check "3.0 sigma 경계, tier 3 진입" 3.0 3
  check "5.0 sigma, tier 3 구간"      5.0 3

  if [ "$fail" = "0" ]; then
    echo "self-check: PASS"
    exit 0
  fi
  exit 1
}

metric=""
value=""
while [ $# -gt 0 ]; do
  case "$1" in
    --metric) metric="$2"; shift 2 ;;
    --value) value="$2"; shift 2 ;;
    --self-check) self_check ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$metric" ] || [ -z "$value" ]; then
  usage
  exit 2
fi

run_detect "$metric" "$value"
