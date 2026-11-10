#!/usr/bin/env bash
# Deploy one Serverless Container by digest (one update, which the hoster redeploys by itself), then wait until the hoster serves that digest (S5: read from
# the hoster's API, not from the service). Used by deploy.yml and rollback.yml for the service and for the
# operator's gateway (ADR-0016).
#   SCW_SECRET_KEY=... scripts/container-deploy.sh <container id> <image@sha256:...> [commit]
# The container's plain environment is MERGED, never replaced: the API documents a merge for
# secret_environment_variables only ("secret environment variables that are not specified in this field
# will be kept unchanged", scaleway-sdk-go container/v1beta1 UpdateContainerRequest); environment_variables
# is the whole map (no such sentence, and the hoster's own OpenTofu provider removes a variable by sending
# the map without it: terraform-provider-scaleway v2.88.0, internal/services/container/helpers_container.go),
# so a PATCH that names only RW_IMAGE would erase DATABASE_SSL, DATABASE_CA and the rest.
# The current map is read, RW_IMAGE (and RW_COMMIT when given) set on it, and the whole map sent back.
# Without a commit, RW_COMMIT is removed: the image's own RW_COMMIT (a build argument) then applies.
set -euo pipefail
id="$1" digest="$2" commit="${3:-}"
[[ "$digest" =~ ^rg\.fr-par\.scw\.cloud/runward/runward-hosted@sha256:[0-9a-f]{64}$ ]] || { echo "container-deploy: not a digest of this registry: $digest"; exit 2; }
[[ -n "${SCW_SECRET_KEY:-}" && -n "$id" ]] || { echo "container-deploy: SCW_SECRET_KEY and a container id are required"; exit 2; }
# the hoster's API; a test points it at a local stand-in (the loopback only: the key never leaves for another host)
base="${SCW_API_URL:-https://api.scaleway.com}"
[[ "$base" =~ ^(https://api\.scaleway\.com|http://127\.0\.0\.1:[0-9]+)$ ]] || { echo "container-deploy: SCW_API_URL is the hoster's API or a loopback stand-in"; exit 2; }
api="$base/containers/v1beta1/regions/${REGION:-fr-par}/containers/$id"
# the key reaches curl in a header file it reads from a pipe (printf is a shell builtin), never in its
# arguments: a command line is read by every process of the machine (AGENTS.md, never-rule 5)
auth() { printf 'X-Auth-Token: %s\n' "$SCW_SECRET_KEY"; }
current=$(curl -sSf --max-time 30 -H @<(auth) "$api")
env=$(jq -c '.environment_variables // {}' <<<"$current")
[ "$(jq 'length' <<<"$env")" -gt 0 ] || { echo "container-deploy: the container's environment reads empty: refused (it would be sent back empty)"; exit 1; }
body=$(jq -n --argjson env "$env" --arg img "$digest" --arg c "$commit" \
  '{registry_image: $img, environment_variables: (($env | del(.RW_COMMIT)) + {RW_IMAGE: $img} + (if $c == "" then {} else {RW_COMMIT: $c} end))}')
# The update is the deploy. The hoster redeploys a container by itself when an update changes it
# (scaleway-sdk-go container/v1beta1, UpdateContainer: "When updating a container, the container is
# automatically redeployed to apply the changes"; the `redeploy` field is deprecated: "future versions of
# this API will systematically redeploy containers when needed"), and DeployContainer is only there "to
# force the redeployment of a container, even if no configuration has changed". A POST /deploy after the
# update therefore lands on a container that is already redeploying, and the hoster answers it 409: that
# failed the deploy of 2026-11-10, then its rollback, after each had already changed a container. So no
# POST here. An update that changes nothing (the same digest and map) starts nothing, and the reads below
# then find the digest already served.
# The answer is read, not left to curl -f: a refused update says its status and the hoster's message.
answer=$(curl -sS --max-time 30 -X PATCH -H @<(auth) -H 'content-type: application/json' "$api" -d "$body" -w '\n%{http_code}')
status="${answer##*$'\n'}"
if [[ ! "$status" =~ ^2[0-9][0-9]$ ]]; then
  said=$(jq -r '.message // "" | tostring | .[0:200]' <<<"${answer%$'\n'*}" 2>/dev/null || true)
  echo "container-deploy: the update of $id was refused (HTTP $status): $said"; exit 1
fi
# the pause between two reads; a test against the loopback stand-in may shorten it, the hoster's API never
pause=10
[[ "$base" == http://127.0.0.1:* && "${CONTAINER_DEPLOY_PAUSE:-}" =~ ^[0-9]+(\.[0-9]+)?$ ]] && pause="$CONTAINER_DEPLOY_PAUSE"
for _ in $(seq 1 60); do
  c=$(curl -sSf --max-time 30 -H @<(auth) "$api")
  if [ "$(jq -r .status <<<"$c")" = "ready" ] && [ "$(jq -r .registry_image <<<"$c")" = "$digest" ]; then
    # the merge held: every key that was there before is still there
    missing=$(jq -r --argjson before "$env" '.environment_variables as $now | [$before | keys[] | select(. != "RW_COMMIT" and ($now[.] == null))] | join(",")' <<<"$c")
    [ -z "$missing" ] || { echo "container-deploy: variables lost by the update: $missing"; exit 1; }
    echo "container-deploy: $id serves $digest"; exit 0
  fi
  [ "$(jq -r .status <<<"$c")" = "error" ] && { echo "container-deploy: $id is in error: $(jq -r '.error_message // ""' <<<"$c")"; exit 1; }
  sleep "$pause"
done
echo "container-deploy: $id does not serve $digest after 60 reads, $pause s apart"; exit 1
