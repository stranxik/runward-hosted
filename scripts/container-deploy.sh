#!/usr/bin/env bash
# Deploy one Serverless Container by digest, then wait until the hoster serves that digest (S5: read from
# the hoster's API, not from the service). Used by deploy.yml and rollback.yml for the service and for the
# operator's gateway (ADR-0016).
#   SCW_SECRET_KEY=... scripts/container-deploy.sh <container id> <image@sha256:...> [commit]
# The container's plain environment is MERGED, never replaced: the API documents a merge for
# secret_environment_variables only ("secret environment variables that are not specified in this field
# will be kept unchanged", scaleway-sdk-go container/v1beta1 UpdateContainerRequest); environment_variables
# is the whole map, so a PATCH that names only RW_IMAGE would erase DATABASE_SSL, DATABASE_CA and the rest.
# The current map is read, RW_IMAGE (and RW_COMMIT when given) set on it, and the whole map sent back.
# Without a commit, RW_COMMIT is removed: the image's own RW_COMMIT (a build argument) then applies.
set -euo pipefail
id="$1" digest="$2" commit="${3:-}"
[[ "$digest" =~ ^rg\.fr-par\.scw\.cloud/runward/runward-hosted@sha256:[0-9a-f]{64}$ ]] || { echo "container-deploy: not a digest of this registry: $digest"; exit 2; }
[[ -n "${SCW_SECRET_KEY:-}" && -n "$id" ]] || { echo "container-deploy: SCW_SECRET_KEY and a container id are required"; exit 2; }
api="https://api.scaleway.com/containers/v1beta1/regions/${REGION:-fr-par}/containers/$id"
h=(-H "X-Auth-Token: $SCW_SECRET_KEY")
current=$(curl -sSf --max-time 30 "${h[@]}" "$api")
env=$(jq -c '.environment_variables // {}' <<<"$current")
[ "$(jq 'length' <<<"$env")" -gt 0 ] || { echo "container-deploy: the container's environment reads empty: refused (it would be sent back empty)"; exit 1; }
body=$(jq -n --argjson env "$env" --arg img "$digest" --arg c "$commit" \
  '{registry_image: $img, environment_variables: (($env | del(.RW_COMMIT)) + {RW_IMAGE: $img} + (if $c == "" then {} else {RW_COMMIT: $c} end))}')
curl -sSf --max-time 30 -X PATCH "${h[@]}" -H 'content-type: application/json' "$api" -d "$body" >/dev/null
curl -sSf --max-time 30 -X POST "${h[@]}" -H 'content-type: application/json' "$api/deploy" -d '{}' >/dev/null
for _ in $(seq 1 60); do
  c=$(curl -sSf --max-time 30 "${h[@]}" "$api")
  if [ "$(jq -r .status <<<"$c")" = "ready" ] && [ "$(jq -r .registry_image <<<"$c")" = "$digest" ]; then
    # the merge held: every key that was there before is still there
    missing=$(jq -r --argjson before "$env" '.environment_variables as $now | [$before | keys[] | select(. != "RW_COMMIT" and ($now[.] == null))] | join(",")' <<<"$c")
    [ -z "$missing" ] || { echo "container-deploy: variables lost by the update: $missing"; exit 1; }
    echo "container-deploy: $id serves $digest"; exit 0
  fi
  [ "$(jq -r .status <<<"$c")" = "error" ] && { echo "container-deploy: $id is in error: $(jq -r '.error_message // ""' <<<"$c")"; exit 1; }
  sleep 10
done
echo "container-deploy: $id does not serve $digest after 10 minutes"; exit 1
