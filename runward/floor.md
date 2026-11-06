# Floor Note: runward hosted

**Date**: 2026-11-06 · **State**: built and tested locally and on the NAS; NOT deployed (no paid resource exists, the author's approval of the prices is pending)

## 1. Scope shipped

- The service (`src/`): the routes of the architecture note (§3.1), with their named refusals; uploads by OIDC (ADR-0003); the index by the pinned runward-fleet (ADR-0002, ADR-0004); passkeys, sessions, links, recovery (ADR-0005); forced RLS (ADR-0006); the chained journal and the security log (ADR-0007); consent, retention, erasure (ADR-0009); the export and its replay; the witness reader (ADR-0012); `/api/version`, `/api/health`, `security.txt`.
- The shell (`web/`), from the preview, on the live API; tokens in one file (ADR-0014).
- The send workflow (`.github/workflows/send.yml`), the CI, the probe, the witness reader's workflow; the deploy and rollback workflows written and OFF (ADR-0008).
- The operator's gestures (`src/operator.js`, `scripts/operator-link.mjs`), the migrations (`db/`), the two infrastructure descriptions (`infra/`), the runbook.

## Rule conformance

> Rows are proposed by an agent session and ratified by the author, never by the agent (AGENTS.md, ADR-0082 of runward). The gate refuses a proposed row until it is ratified.

| Rule | Status | Evidence |
|---|---|---|
| async-post-turn-pipeline | proposed:n/a | the service calls no model (architecture §1): deterministic end to end; no post-turn pipeline exists |
| checklist-day-zero-project | proposed:applied | file:src/main.js#readConfig; file:src/adapters/system/log.js#jsonLog; file:.github/workflows/ci.yml; adr:0001 |
| config-secrets-boundary | proposed:applied | file:src/main.js#readConfig (secrets read from the environment only, never logged; the vault is the hoster's secret environment and the GitHub environment production); adr:0008 |
| data-migrations-forward-only | proposed:applied | file:scripts/migrate.mjs#migrate; file:db/migrations/0001_floor.sql |
| frontier-deterministic-boundary | proposed:n/a | the service calls no model (architecture §1): deterministic end to end: every value shown is computed by runward-fleet from the exports, none comes from a model |
| hexa-adapter-pattern | proposed:applied | file:src/application/app.js#PORTS; file:src/adapters/store/memory.js#memoryStore; file:src/adapters/store/postgres.js#postgresStore |
| hexa-architecture | proposed:applied | test:test/unit/boundary.test.js; adr:0001 |
| hexa-move-deterministic-out | proposed:applied | file:src/domain/workload.js#placeUpload; file:src/domain/identity.js#linkState; file:src/domain/ledger.js#verifyChain |
| provider-llm-auto-detection | proposed:n/a | the service calls no model (architecture §1): deterministic end to end |
| provider-no-crash-missing-env | proposed:applied | file:src/main.js#readConfig (the service refuses to start half configured and names what is missing, never a value) |
| scaling-state-externalization | proposed:applied | file:src/adapters/store/postgres.js#postgresStore; adr:0006 (challenges, sessions, links and counters are in the database; nothing in memory outlives a request) |
| security-prompt-injection | proposed:n/a | the service calls no model (architecture §1): deterministic end to end; untrusted claims and exports are data, bounded and escaped (file:src/domain/workload.js#cleanClaim) |
| state-event-sourcing | proposed:applied | file:src/domain/ledger.js#nextEntry; file:src/application/context.js#append; adr:0007 |
| tools-registry-pattern | proposed:n/a | no agent and no tool registry in the service; the route table is the closed list of gestures (file:src/http/server.js#routes) |
| tools-scope-atomicity | proposed:n/a | no agent tools; each route is one gesture (file:src/http/server.js#routes) |

## 2. Proof against the success criterion

The six measures are made on the deployed service only (framing §3). None is measured yet: there is no deployment. What runs today is listed in §3 as local substitutes, which prove the behaviour, not the criterion.

**Criterion**: SC-1
**Metric**: share of accepted uploads whose indexSha256 anchored in the client job is the index served and the index runward-fleet rebuilds from the export, over 7 consecutive days
**Threshold (success)**: = 100
**Traffic used**: none on the deployed service; locally, the uploads of the test suites (memory store on the workstation, PostgreSQL on the NAS)
**Period**: 2026-11-06..2026-11-06
**Measured result**: not measured on the deployed service. Locally: every published index of the test exports rebuilds byte for byte with runward-fleet 0.46.0 (test/unit/repositories.test.js, test/pg/isolation.test.js)
**Verdict**: not-met — the floor is built, not proven; the gate stays at the floor until the deployed measures exist
**Observability check**: every answer carries a request id that the JSON log line, the journal entry and the job summary repeat (file:src/http/server.js, file:src/application/context.js); not yet reconstructed on a deployed trajectory

**Behavioral proof**: `npm test && PG_ADMIN_URL=postgres://postgres@<throwaway server>/postgres npm run test:pg`

## 3. Gaps and deviations

| Gap / deviation | Impact | Agreed with sponsor |
|---|---|---|
| No deployment: S1 to S6 are not measured | the floor is not proven | pending: the author approves the paid resources (runbook §11) |
| The invitation of a second member is not built (routes and screens) | none in the floor: PADR-0019 builds it at its trigger | PADR-0019, ratified 2026-11-06 |
| runward-fleet pinned by a vendored tarball, not an attested release | ADR-0002 is the interim | to ratify (ADR-0002) |
| The passkey ceremonies were not exercised in a real browser with a real authenticator | the WebAuthn path is tested with a stand-in that checks the challenge | the author's gesture (runbook §12) |
| The restore drill is not done | B14 of the critique stays open until it is | needs a throwaway DB-DEV-S instance, paid (runbook §11) |

## 4. Deferrals confirmed

Framing §6, unchanged.

## 5. Next tier

Deploy, then measure S1 to S6 for seven days.
