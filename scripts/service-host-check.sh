#!/usr/bin/env bash
# vars.RW_SERVICE_HOST is the hostname the hoster itself reports for the service's container, or the
# deploy stops before it builds (review finding of 2026-11-10, C31: the variable was taken on trust; a
# value naming another routed host that answers the same refusal would have passed the smoke).
#   scripts/service-host-check.sh <RW_SERVICE_HOST> < the container, as the hoster's API returns it
# The hostname is read from the field `domain_name` of the container (containers API v1beta1; the field's
# name is the one of the hoster's published SDK, its value was not read from the live API when this was
# written). So it fails closed: an answer that is not JSON, or that carries no such field, or an empty
# one, is a refusal, never a pass. Compared without case and without one trailing dot, as DNS names are;
# nothing else is forgiven (no scheme, no port, no path). Hostnames are not secrets: both are printed.
set -euo pipefail
want="${1:-}"
norm() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/\.$//'; }
reported=$(jq -r 'if (.domain_name | type) == "string" then .domain_name else "" end' 2>/dev/null) || reported=""
[ -n "$want" ] || { echo "service-host: RW_SERVICE_HOST is empty: refused"; exit 1; }
[ -n "$reported" ] || { echo "service-host: the hoster's answer names no hostname (domain_name) for the service's container: RW_SERVICE_HOST cannot be checked, refused"; exit 1; }
[ "$(norm "$want")" = "$(norm "$reported")" ] || { echo "service-host: RW_SERVICE_HOST ($want) is not the hostname the hoster reports for the service's container ($reported): refused"; exit 1; }
echo "service-host: RW_SERVICE_HOST is the service's container's own hostname at the hoster"
