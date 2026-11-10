# Independent review of the 42 proposed conformance rows, 2026-11-10 (commit a4ede14, main)

**Reviewer**: a second AI agent (Claude Fable 5.2, read-only `reviewer` agent) that wrote none of the rows. Thibault Souris, the author, is accountable for it. It read a clean clone of `main` at `a4ede1485323293609957a700aba13ddf99de27f`, the merge of PR #1, and changed nothing.

**What the gate said** (`runward@0.46.0 check --strict`, exit 1): 42 rows `proposed:*` awaiting ratification, 4 handover rules missing from the manifest, and `runward/handover.md` still a raw template. CI at that head: `test`, `image` and `infra` succeeded, and `runward` failed (run 42802870224).

**Mechanical checks**:
- every pointer of the 42 rows resolves ;
- `reports/junit.xml`: 138 cases, 0 failure, 0 skip ;
- `reports/eslint.json`: 33 files, 0 error ;
- `reports/eslint-security.sarif`: 0 result ;
- secretlint: 0 result, with 4 rules proven live ;
- the CI regenerates and compares these reports (`scripts/reports-fresh.mjs`).

**Result: 33 rows hold (13 applied, 1 deviated, 19 n/a), 9 do not.** The 19 n/a rows are exact: the service calls no model. That was checked in `package.json`, the lockfile, `src/` and the vendored package. The five defects found on 2026-11-08 are fixed and held by tests with a planted control, with three reservations (below). One new product defect was reproduced.

## New defect, reproduced
`src/adapters/oidc/github.js:21-22`: `fetchedAt` was set before the key fetch succeeded. After one failed fetch (a cold start, a timeout), every token was answered `token-unreadable` (401) for 60 seconds. `send.yml` does not retry a 401, so an upload was lost, with misleading advice. Reproduced outside the repository: one 503, then three 401s with a single fetch.

## Rejected rows (9)
- `architecture.md:process-adr-and-journal`: ADR-0002, accepted on 2026-11-08, was rewritten in place on 2026-11-10 (commit `c0b9948`), which the rule forbids. `architecture.md` also still lists 0002, 0014 and 0015 as proposed.
- `execution-topology.md`, four rows (`topology-port-placement-mapped`, `topology-sovereignty-by-data-class`, `topology-trace-export-decision`, `topology-usage-registry-present`): the topology predates the operator gateway of ADR-0016, a second, private container with two cron triggers, which is absent from the map, the usage registry and the threat model. The gestures' output, which includes tenant and member identifiers, reaches the GitHub runner's log with no decision naming that destination.
- `floor.md:checklist-day-zero-project`: no pre-commit hook, and no recorded deviation.
- `governance/threat-model.md:async-job-guardrails`: a failed daily job is journalled but alerts no one.
- `governance/threat-model.md:checklist-pre-production-observability`: no dashboard, and log retention still "to confirm".
- `governance/threat-model.md:checklist-pre-production-resilience`: the new OIDC defect.

## Reservations on the 2026-11-08 fixes
- The migration guard can still be bypassed by an `E'\''` string and by a double-quoted identifier containing a quote.
- Rate limits cover the routes tagged `public` only; unauthenticated requests to the workload, reader and session routes are not counted before their costly work.
- The composition test calls the egress directly, so the wiring to S3 and to the verifier is not held by a test. `oidc()` in `send.yml` has no timeout.

## Handover
Not started: `runward/handover.md`, the four handover rows, the final agents charter, a task redone without the builder, and the restore drill.

## Follow-up
All rejected rows, the new defect, the reservations and the handover are being corrected on the branch `fix/h0-gate`. The corrected rows will be reviewed again independently before any ratification. Ratification is made under the reviewing agent's name, for Thibault Souris, and marked single accountable.
