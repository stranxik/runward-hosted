#!/usr/bin/env bash
# From the author's Mac (never-rule 10 of AGENTS.md: no full suite on it): run a command on the NAS, in
# the reference environment (scripts/reference-env.sh: Linux, Node.js 22, jq, a throwaway PostgreSQL at the
# digest of ci.yml), on the exact state of this checkout, uncommitted changes included.
#   scripts/on-nas.sh 'npm test'
#   scripts/on-nas.sh 'npm run test:pg'
#   scripts/on-nas.sh -r 'npm run test:reports:write'     -r brings reports/ and db/schema.snapshot.txt back
# Two steps: the author's ~/.claude/skills/nas/scripts/verifier-sur-nas.sh sends the tree to its copy on
# the NAS (~/verif/<name>-<digest of this path>/src; nothing git ignores leaves the Mac); then the command
# runs there through scripts/reference-env.sh, which removes what it started. Exit status: the command's.
set -euo pipefail
back=0; if [ "${1:-}" = "-r" ]; then back=1; shift; fi
cmd="${1:?usage: scripts/on-nas.sh [-r] '<command>'}"
cd "$(dirname "$0")/.."
top=$(git rev-parse --show-toplevel)
cd "$top"
copy="verif/$(basename "$top")-$(printf '%s' "$top" | shasum | cut -c1-8)/src"
"$HOME/.claude/skills/nas/scripts/verifier-sur-nas.sh" . true
status=0
ssh nas "cd ~/$copy && RW_REF_CPUS=3.5 bash scripts/reference-env.sh -" <<<"$cmd" || status=$?
if [ "$back" = 1 ]; then ssh nas "cd ~/$copy && tar -czf - reports db/schema.snapshot.txt" | tar -xzf - -C "$top"; echo "on-nas: reports/ and db/schema.snapshot.txt brought back"; fi
exit "$status"
