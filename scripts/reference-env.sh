#!/usr/bin/env bash
# Run a command in the reference environment of the suites, the one of the CI test job (ci.yml): Linux,
# the Node.js major of .nvmrc, a throwaway PostgreSQL at the digest ci.yml pins, and jq (which the image
# node:<major> does not carry; scripts/operator-call.sh and scripts/container-deploy.sh need it, and so
# do their tests). For a host with Docker, from a checkout of this repository:
#   scripts/reference-env.sh 'npm test'
#   scripts/reference-env.sh 'npm run test:pg'
#   scripts/reference-env.sh -            the command is read from standard input
# PG_ADMIN_URL is set for the command. The PostgreSQL container is this run's own (its name holds this
# process's id) and is removed with its volume when the command ends, whatever its outcome; jq is fetched
# from its release, checked against the sha256 pinned below, and removed too. Nothing else is left on the
# host but node_modules in the checkout (npm ci --ignore-scripts, when it is absent). Exit status: the
# command's. RW_REF_CPUS caps the containers' processors (unset: no cap).
set -euo pipefail
cmd="${1:?usage: scripts/reference-env.sh '<command>' | -}"
[ "$cmd" != "-" ] || cmd=$(cat)
cd "$(dirname "$0")/.."

JQ_URL=https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64
JQ_SHA256=5942c9b0934e510ee61eb3e30273f1b3fe2590df93933a93d7c58b81d19c8ff5
[ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || { echo "reference-env: the reference environment is Linux x86_64 (this host: $(uname -s) $(uname -m))"; exit 2; }
node_major=$(tr -dc '0-9.' < .nvmrc | cut -d. -f1)
pg_image=$(grep -o 'postgres@sha256:[0-9a-f]\{64\}' .github/workflows/ci.yml | head -1)
[ -n "$node_major" ] && [ -n "$pg_image" ] || { echo "reference-env: .nvmrc or the PostgreSQL digest of ci.yml cannot be read"; exit 2; }

pg="rw-ref-pg-$$"
tools=$(mktemp -d)
cleanup() { docker rm -f -v "$pg" >/dev/null 2>&1 || true; rm -f "$tools/jq"; rmdir "$tools" 2>/dev/null || true; }
trap cleanup EXIT

curl -sSfLo "$tools/jq" "$JQ_URL"
echo "$JQ_SHA256  $tools/jq" | sha256sum -c --status - || { echo "reference-env: jq does not match its pinned sha256"; exit 2; }
chmod 755 "$tools/jq"

cap=(); [ -z "${RW_REF_CPUS:-}" ] || cap=(--cpus "$RW_REF_CPUS")
docker run -d --name "$pg" "${cap[@]}" -e POSTGRES_HOST_AUTH_METHOD=trust "$pg_image" >/dev/null
ready=0
for _ in $(seq 1 60); do if docker exec "$pg" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi; sleep 1; done
[ "$ready" = 1 ] || { echo "reference-env: the throwaway PostgreSQL did not start"; exit 2; }

# the command's container shares the PostgreSQL container's network: the server is localhost:5432 for it
docker run --rm --init "${cap[@]}" --network "container:$pg" --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e CI=true -e PG_ADMIN_URL=postgres://postgres@localhost:5432/postgres \
  -v "$PWD":/w:Z -v "$tools":/tools:ro,Z -w /w -e RW_REF_CMD="$cmd" "node:$node_major" bash -c '
    export PATH=/tools:$PATH
    echo "reference-env: node $(node --version), $(jq --version), PostgreSQL $(node -e "
      import(\"postgres\").then(async ({ default: p }) => { const s = p(process.env.PG_ADMIN_URL, { max: 1 }); const [r] = await s\`show server_version\`; console.log(r.server_version); await s.end(); }).catch(() => console.log(\"(version read after npm ci)\"))")"
    [ -d node_modules ] || npm ci --ignore-scripts --no-audit --no-fund >/tmp/npm-ci.log 2>&1 || { tail -20 /tmp/npm-ci.log; exit 1; }
    eval "$RW_REF_CMD"'
