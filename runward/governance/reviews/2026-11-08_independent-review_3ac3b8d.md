# Independent review of the 42 proposed conformance rows, 2026-11-08 (commit 3ac3b8d)

**Reviewer**: a second AI agent (Claude, read-only `reviewer` agent) that wrote none of the rows. Thibault Souris, the author, is accountable for it. **Proposer of the rows**: the AI agent that built the service. Rule applied: a proposal is not a decision, and whoever proposes does not ratify.

**State at the reviewed commit** (`3ac3b8d`, whose code is `060bef9` plus three ADR status lines): `test`, `infra` and `image` succeeded, and `runward` failed. Its check-runs are on commit `060bef9`.

**Result: 25 rows accepted, 17 rejected.** Six of the rejected rows exposed five real defects of the product that the green tests had not caught (one defect is cited by two rows). They were fixed on 2026-11-08 in `606736b`, `62bdbb8`, `af7ed4a`, `5b5b06d` and `701e142`, each with a test that fails if the defect comes back. The other eleven rows were rejected because their evidence did not support the stated status. Nothing was ratified on the strength of this review.

## The five defects
1. `floor.md:config-secrets-boundary` and `governance/threat-model.md:config-secrets-boundary`: `DATABASE_SSL=require` gave `rejectUnauthorized:false` in the PostgreSQL client. The connection to the database was encrypted but did not verify the server's certificate. Fixed in `606736b` (verify-full).
2. `floor.md:data-migrations-forward-only`: the migration guard let `alter table if exists x drop column y` through, along with a drop that does not start a line, and refused neither a gap nor a reordering of the sequence. Fixed in `62bdbb8`.
3. `governance/threat-model.md:checklist-pre-production-resilience`: the service's calls to the OIDC issuer and to S3 had no explicit timeout and no circuit breaker. Fixed in `af7ed4a`.
4. `governance/threat-model.md:checklist-pre-production-security`: no rate limit on the public routes, for example `/api/v0/auth/options`, and no dependency audit. Fixed in `5b5b06d`.
5. `governance/threat-model.md:async-job-guardrails`: the operator journal was written only after a successful loop; a failure went to stderr, and one tenant's error stopped every tenant after it. Fixed in `701e142`.

## The other eleven rejections (evidence that did not hold)
- `architecture.md:contracts-governance`: the API contract digest was compared to nothing.
- `architecture.md:hexa-typescript-native`: marked deviated on the rule's name, when the rule asks for no TypeScript; the right status is n/a.
- `architecture.md:process-adr-and-journal`: no session journal.
- `execution-topology.md:topology-sovereignty-by-data-class`: a level per port rather than per class of data.
- `floor.md:checklist-day-zero-project`: lint, README, `.env.example` and a schema-drift test were missing.
- `floor.md:hexa-move-deterministic-out`: the service calls no model, so the right status is n/a.
- `floor.md:state-event-sourcing`: the ledger is an audit trail, not a reduced state; the right status is n/a.
- `governance/threat-model.md:checklist-pre-production-observability`: no error rate, no alert and no dashboard.
- `governance/threat-model.md:checklist-pre-production-performance`: no load test and no measured P95.
- `governance/threat-model.md:resilience-retry-backoff`: the rule targets model calls, which the service does not make; the right status is n/a.
- `governance/threat-model.md:security-human-agent-trust`: the provenance marker on each field was not cited.

Count: the six rows of the five defects above (the secrets boundary appears in two deliverables) plus these eleven make the seventeen rejections.

**Re-review**: on 2026-11-10 a second independent review re-read every row at `main` (`a4ede14`). See `2026-11-10_independent-review_a4ede14.md`.
