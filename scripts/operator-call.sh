#!/usr/bin/env bash
# One gesture through the operator's gateway (ADR-0016), from the CI or from the author's workstation.
#   SCW_SECRET_KEY=... RW_OPERATOR_TOKEN=... RW_OPERATOR_URL=https://... scripts/operator-call.sh <gesture> ['<json args>']
# Two barriers: X-Auth-Token (the hoster's, the container is private) and X-RW-Operator-Token (the
# gateway's). Exit 0 only on HTTP 200; the gateway's answer (exit code, redacted output) is printed.
set -euo pipefail
gesture="$1" args="${2:-}"
[[ "$gesture" =~ ^[a-z-]+$ ]] || { echo "operator-call: not a gesture name: $gesture"; exit 2; }
for v in SCW_SECRET_KEY RW_OPERATOR_TOKEN RW_OPERATOR_URL; do [ -n "${!v:-}" ] || { echo "operator-call: $v is required"; exit 2; }; done
body='{}'; [ -z "$args" ] || body=$(jq -cn --argjson a "$args" '{args: $a}')
out=$(mktemp); trap 'rm -f "$out"' EXIT
status=$(curl -sS --max-time 900 -o "$out" -w '%{http_code}' -X POST \
  -H "X-Auth-Token: $SCW_SECRET_KEY" -H "X-RW-Operator-Token: $RW_OPERATOR_TOKEN" -H 'content-type: application/json' \
  "${RW_OPERATOR_URL%/}/gestures/$gesture" -d "$body") || status=000
jq . "$out" 2>/dev/null || cat "$out"
[ "$status" = "200" ] || { echo "operator-call: $gesture answered HTTP $status"; exit 1; }
