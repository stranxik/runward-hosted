#!/usr/bin/env bash
# One gesture through the operator's gateway (ADR-0016), from the CI or from the author's workstation.
#   SCW_SECRET_KEY=... RW_OPERATOR_TOKEN=... RW_OPERATOR_URL=https://... scripts/operator-call.sh <gesture> ['<json args>']
# Two barriers: X-Auth-Token (the hoster's, the container is private) and X-RW-Operator-Token (the
# gateway's). Exit 0 only on HTTP 200.
# What it prints is a status and a code, read from the answer's closed fields only (gesture, ok, exit,
# error), never the body itself: this output lands in a GitHub runner's log, outside the private network
# (review finding of 2026-11-10). The result of a gesture is in the operator journal of the database.
# The two secrets reach curl in a header file it reads from a pipe (-H @<(...), printf being a shell
# builtin), never in its arguments: a command line is read by every process of the machine (AGENTS.md,
# never-rule 5; review finding of 2026-11-10, the two headers were curl arguments).
set -euo pipefail
gesture="$1" args="${2:-}"
[[ "$gesture" =~ ^[a-z-]+$ ]] || { echo "operator-call: not a gesture name: $gesture"; exit 2; }
for v in SCW_SECRET_KEY RW_OPERATOR_TOKEN RW_OPERATOR_URL; do [ -n "${!v:-}" ] || { echo "operator-call: $v is required"; exit 2; }; done
body='{}'; [ -z "$args" ] || body=$(jq -cn --argjson a "$args" '{args: $a}')
out=$(mktemp); trap 'rm -f "$out"' EXIT
status=$(curl -sS --max-time 900 -o "$out" -w '%{http_code}' -X POST \
  -H @<(printf 'X-Auth-Token: %s\nX-RW-Operator-Token: %s\n' "$SCW_SECRET_KEY" "$RW_OPERATOR_TOKEN") -H 'content-type: application/json' \
  "${RW_OPERATOR_URL%/}/gestures/$gesture" -d "$body") || status=000
# each field is kept only in its own closed form: a gesture name, a boolean, an exit code, an error code
said=$(jq -r '[ (.gesture | select(type == "string" and test("^[a-z-]{1,40}$")) | "gesture=\(.)"),
                (.ok | select(type == "boolean") | "ok=\(.)"),
                (.exit | select(type == "number" and . >= 0 and . < 256 and floor == .) | "exit=\(.)"),
                (.error | select(type == "string" and test("^[a-z-]{1,40}$")) | "error=\(.)") ] | join(" ")' "$out" 2>/dev/null || true)
echo "operator-call: $gesture answered HTTP $status${said:+ ($said)}"
[ "$status" = "200" ] || exit 1
