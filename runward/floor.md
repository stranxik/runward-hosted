# Floor Note: runward hosted

**Date**: 2026-11-06 · **State**: built and tested locally and on the NAS; NOT deployed (no paid resource exists: the author approved the budget on 2026-11-06, 20 EUR excl. VAT a month with an alert at 15 EUR, and each paid resource is still announced to the author before it is created)

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
| checklist-day-zero-project | proposed:applied | test:reports/junit.xml::the service refuses to start half configured: exit 78, each missing variable named, no value echoed; test:reports/junit.xml::the schema the migrations build is the committed snapshot (no drift); test:reports/junit.xml::the hexagon is refused by the linter: each forbidden arrow, planted in its layer, is an error; file:.github/workflows/ci.yml; adr:0001 |
| config-secrets-boundary | proposed:applied | file:reports/eslint-security.sarif#no-restricted-properties; test:reports/junit.xml::the security scan refuses a read of the environment outside the composition roots, and eval; adr:0008 |
| data-migrations-forward-only | proposed:applied | test:reports/junit.xml::migrations: a contracting statement is refused wherever it sits, in any spelling; test:reports/junit.xml::migrations: a gap, a duplicate number, a bad name, a reordering, a vanished or changed file are refused; test:reports/junit.xml::the migration is idempotent: a second run applies nothing |
| frontier-deterministic-boundary | proposed:n/a | the service calls no model (architecture §1): deterministic end to end: every value shown is computed by runward-fleet from the exports, none comes from a model |
| hexa-adapter-pattern | proposed:applied | file:reports/eslint.json#src/application/app.js; file:reports/eslint.json#src/adapters/store/memory.js; file:reports/eslint.json#src/adapters/store/postgres.js; adr:0015 |
| hexa-architecture | proposed:applied | file:reports/eslint.json#src/domain/identity.js; file:reports/eslint.json#src/application/app.js; test:reports/junit.xml::the hexagon is refused by the linter: each forbidden arrow, planted in its layer, is an error |
| hexa-move-deterministic-out | proposed:n/a | the service calls no model (architecture §1): every value is computed by deterministic code; there is no model call to move work out of |
| provider-llm-auto-detection | proposed:n/a | the service calls no model (architecture §1): deterministic end to end |
| provider-no-crash-missing-env | proposed:applied | test:reports/junit.xml::the service refuses to start half configured: exit 78, each missing variable named, no value echoed; test:reports/junit.xml::database TLS in production: verify-full with the authority, or the service does not start |
| scaling-state-externalization | proposed:applied | test:reports/junit.xml::two instances on one PostgreSQL share every state: a session, a challenge, a token already used; adr:0006 |
| security-prompt-injection | proposed:n/a | the service calls no model (architecture §1): deterministic end to end; untrusted claims and exports are data, bounded and escaped (file:src/domain/workload.js#cleanClaim) |
| state-event-sourcing | proposed:n/a | the service calls no model (architecture §1): there is no agent state to rebuild from events; the tenant journal is append only and chained (adr:0007), a record beside the state |
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
| No deployment: S1 to S6 are not measured | the floor is not proven | pending: the paid resources of runbook §11 are created, within the budget the author approved on 2026-11-06 |
| The invitation of a second member is not built (routes and screens) | none in the floor: PADR-0019 builds it at its trigger | PADR-0019, ratified 2026-11-06 |
| runward-fleet pinned by a vendored tarball, not an attested release | ADR-0002 is the interim | to ratify (ADR-0002) |
| The passkey ceremonies were not exercised in a real browser with a real authenticator | the WebAuthn path is tested with a stand-in that checks the challenge | the author's gesture (runbook §12) |
| The restore drill is not done | B14 of the critique stays open until it is | needs a throwaway DB-DEV-S instance, paid (runbook §11) |

## 4. Deferrals confirmed

Framing §6, unchanged.

## 5. Next tier

Deploy, then measure S1 to S6 for seven days.
