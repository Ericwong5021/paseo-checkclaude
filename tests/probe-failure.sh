#!/bin/bash
# Baseline signals adapted from zzusec/CheckClaude's MIT-licensed score tests.
# All probes are deterministic stubs; no network or user settings are changed.
set -uo pipefail
ROOT="${CHECKCLAUDE_TEST_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
export AUTO_TZ_DIR
AUTO_TZ_DIR=$(mktemp -d)
export AUTO_TZ_SELFTEST=1 CC_SELFTEST=1
source "$ROOT/server/scripts/auto-timezone.sh"
trap 'rm -rf "$AUTO_TZ_DIR" "${TMP:-$AUTO_TZ_DIR}"' EXIT
assert_eq() {
  if [[ "$2" != "$3" ]]; then printf 'FAIL %s: got [%s], wanted [%s]\n' "$1" "$2" "$3"; exit 1; fi
}
# A failed domestic probe must overwrite an old, inconsistent snapshot.
printf '36.231.105.55|0\n' >"$STATE"
cat >"$STATUS" <<'EOF'
consistent=0
cn=36.227.210.139
intl=36.231.105.55
gfw=36.231.105.55
EOF
ip_china(){ printf '?|0|0|0|0|000|ip.3322.net: TLS 握手失败(HTTP 000)\n'; return 1; }
ip_intl(){ printf '1.2.3.4|0|0|0|0|200\n'; }
ip_gfw(){ printf '1.2.3.4|0|0|0|0|200\n'; }
google_reachable(){ printf '0|0|0|0|204\n'; }
sync_timezone_from_gfw(){ :; }
main >/dev/null || true
field(){ sed -n "s/^$1=//p" "$STATUS"; }
assert_eq 'failed route cleared' "$(field cn)" '?'
assert_eq 'successful route current' "$(field gfw)" '1.2.3.4'
assert_eq 'failure is unknown, not mismatch' "$(field consistent)" unknown
assert_eq 'failure state' "$(field network)" probe_failed
case "$(field network_detail)" in *'TLS 握手失败'*) ;; *) echo 'FAIL missing failure reason'; exit 1;; esac
# Recovery requires two valid samples and then publishes the new route.
ip_china(){ printf '1.2.3.4|0|0|0|0|200\n'; }
main >/dev/null || true
assert_eq 'recovery awaiting confirmation' "$(field network)" verifying
main >/dev/null || true
assert_eq 'recovery completed' "$(field consistent)" 1
assert_eq 'recovery state' "$(field network)" ok
printf 'PASS failure overwrites old snapshot and recovery confirms new route\n'
source "$ROOT/server/scripts/claude-check.sh"
ip_country_code(){ echo US; }
base_signals() {
  NETWORK_STATE=ok; NETWORK_DETAIL=""
  COUNTRY=US; COUNTRY2=US; COUNTRY3=US; COUNTRY4=US; COUNTRY_NAME=美国; CITY=LA; ISP=Comcast; ASN=AS7922; LATITUDE=34.0522; LONGITUDE=-118.2437
  INTEL_SOURCES="ip-api:US,ipinfo:US,ipwho:US,ip.sb:US"; INTEL_COUNT=4
  HOSTING=0; PROXY=0
  API_CODE=401; WEB_CODE=200; API_REGION_BLOCK=0
  CF_COLO=LAX; CF_LOC=US; CF_IP=1.2.3.4; CF_WARP=off; PROBE_IP=1.2.3.4; CN_IP=1.2.3.4; INTL_IP=1.2.3.4
  CONSISTENT=1; SYS_TZ=America/Los_Angeles; GFW_TZ=America/Los_Angeles
  TZ_SELF_CONSISTENT=1; TZ_OFFSET=-0700; TZ_ABBR=PDT
  SYS_LOCALE=en_US; SYS_LANG=en; LOCALE_CC=US
  PROXY_MODE="TUN 全局"; PAC_ON=0
  DNS_VERDICT="正常(Cloudflare)"; DNS_RESULT=104.18.1.1; DNS_SCOPE="本地/代理接管"; DNS_SERVERS="1.1.1.1 8.8.8.8 "
  CLAUDE_BASE=""; CLAUDE_VER=test
  IP_CHANGES=0; VM_HOST=物理机
  BR_OK=1; BR_TZ=America/Los_Angeles; BR_LANGS=en-US,en; BR_LOCALE=en-US
  BR_RTC=1.2.3.4; BR_RTC_STATUS=ok; BR_RTC_SUPPORTED=1; BR_RTC_CANDIDATES=2; BR_RTC_PUBLIC_COUNT=1
  BR_RTC_MS=350; BR_RTC_ERROR=""; BR_WEBGL="Apple M1"; BR_FONTS="PingFang SC"; BR_LOCALE=en-US
  SITE_CODE=200; IPV6=""; IPV6_CC=""; SYS_LANGS=en-US
  OS_VER="macOS 26.6"; BR_SOURCE=browser; BR_UA=Chrome; BR_UA_JS=Chrome
  BR_CH_UA=Chromium; BR_CH_PLAT=macOS; BR_ACCEPT=en-US; BR_UAD_PLAT=macOS; BR_UAD_BRANDS=Chromium
  BR_SF_SITE=same-origin; BR_SF_MODE=cors; BR_SF_DEST=empty
}

base_signals; compute_score
assert_eq 'healthy baseline' "$SCORE/$GRADE" '100/优秀'
base_signals; NETWORK_STATE=probe_failed; NETWORK_DETAIL='国内：TLS 握手失败'; CONSISTENT=unknown; CN_IP=?
compute_score; build_gains
assert_eq 'failure does not deduct points' "$SCORE" 100
assert_eq 'failure remains unverified' "$GRADE/$RISK_LEVEL/$SAFE_USE" '探测失败/待复测/0'
case "$VERDICT" in *'TLS 握手失败'*) ;; *) echo 'FAIL reason absent'; exit 1;; esac
case "$GAINS" in *三路*) echo 'FAIL failure listed as recoverable points'; exit 1;; esac
# A real mismatch still receives the original penalty and risk warning.
base_signals; CONSISTENT=0; CN_IP=9.9.9.9; compute_score
assert_eq 'real mismatch still deducted' "$SCORE/$GRADE" '95/风险'
# Missing auxiliary probes must not mask unrelated confirmed failures.
base_signals; NETWORK_STATE=probe_failed; CONSISTENT=unknown; API_CODE=403; compute_score
assert_eq 'API block still deducted' "$SCORE" 90
assert_eq 'API block remains high risk' "$RISK_LEVEL" 高风险
base_signals; NETWORK_STATE=probe_failed; CONSISTENT=unknown; BR_RTC=9.9.9.9; compute_score
assert_eq 'real WebRTC leak still deducted' "$SCORE" 94
assert_eq 'real WebRTC leak remains high risk' "$RISK_LEVEL" 高风险
# Legacy failed snapshots must use live IP before querying its country metadata.
cat >"$STATUS" <<'EOF'
consistent=0
cn=36.227.210.139
intl=36.231.105.55
gfw=36.231.105.55
network=unstable
EOF
fake_trace(){ printf 'ip=1.2.3.4\nloc=US\n'; }
CURL=fake_trace
refresh_base
assert_eq 'fresh IP selected before geo queries' "$PROBE_IP" 1.2.3.4
printf 'PASS failure scoring, real mismatch, API block, WebRTC leak and legacy fallback\n'

fake_trace(){ return 1; }
refresh_base
assert_eq 'failed live lookup does not reuse legacy IP' "$PROBE_IP" '?'
