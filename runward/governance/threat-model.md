# Threat Model: runward hosted

**Version**: v0.1 · **Last review**: 2026-11-06 · **Agent privilege level**: low (no agent in the service)

The full model (T1 to T29) is the architecture note v2 §11 (author's private folder); each threat here names its guard in this repository.

## 1. Attack surfaces

| Surface | Description | Trust | Primary risk |
|---|---|---|---|
| **Untrusted input (direct)** | HTTP requests from browsers and from CI jobs | untrusted | forged uploads, cross-site writes |
| **Untrusted input (indirect)** | the bytes of the exports and the claims of OIDC tokens | untrusted | escaping faults in the view (T3, T20) |
| **Memory** | none: the service has no model and no memory of one | untrusted by inheritance | none in the floor |
| **Tools** | none exposed to a model; the route table is the closed list of gestures | guarded | a gesture without its verification (T16) |
| **Exposed surface** | the HTTP API, the send workflow called from other repositories | guarded | oracle, flood (T17, T18) |
| **Secrets and sensitive data** | database role, S3 keys, deploy key; consented exports with declared names | internal | exfiltration, cross-tenant read (T4) |

## 2. Lethal trifecta

The trifecta does not apply to the service (no agent reads private data there or talks out). It applies to the **maintainer's workstation**: an agent reading an untrusted page in the same browser as the hosted session holds the three legs (T16). That is outside the product; the Access screen says it.

| Path / context window | Private data | Untrusted content ingested | Outbound communication | Verdict |
|---|---|---|---|---|
| the service's request path | yes | yes (exports, claims) | no (one egress to the OIDC keys, no data out) | safe (2 of 3) |
| the maintainer's browser driven by an agent | yes | yes | yes | human supervision (3 of 3) |

## 3. Guardrails

- **Separation of the untrusted**: export bytes and token claims are data: bounded, control characters removed, escaped by views.js and the shell; nothing in them is ever executed or interpreted as an instruction.
- **Least privilege on tools**: no model, no tools; the database role of the service has no owner rights, no BYPASSRLS, no DELETE, no journal UPDATE.
- **Human approval**: every heavy gesture asks a passkey verification bound to the gesture and its object (section 4).
- **Output validation**: an assembled index passes runward-fleet's rules and page check before it is published; otherwise it is quarantined.
- **Immutable log**: the chained, append-only journal and the security log doubled in the object store.
- **High-privilege patterns (if applicable)**: operator gestures are a closed list run in the hoster's network after an environment approval; only digests of link tokens reach them.

| # | Threat | Guard | Test or check |
|---|---|---|---|
| T1 | forged upload in a repository's name; capture of a repository's uploads by another tenant | OIDC verified and pinned (ADR-0003); a declaration waits for a first upload confirmed per gesture | `test/unit/ingest.test.js` |
| T2 | an agent of the repository has misleading content judged | the file comes out of the product's send workflow; content stays ci-declared, said on screen | `scripts/check-workflows.mjs` |
| T3 | malicious content in an export | views.js escapes; rules checked at ingestion; 2 MB; CSP script-src 'self'; Trusted Types | `test/unit/http.test.js` |
| T4 | read or write in another tenant | forced RLS, server-computed S3 prefix, isolation suite | `test/pg/isolation.test.js` |
| T5 | session theft or replay, cross-site request | __Host-, HttpOnly, Secure, Lax, same origin on every write, no GET writes, no CORS | `test/unit/http.test.js` |
| T6 | loss of every passkey | two passkeys, same-provider warning, recovery with a delay | `test/unit/identity.test.js` |
| T7 | deploy key within an agent's reach | environment production reserved to main; workflow changes reviewed; deploy OFF until approved | `scripts/check-workflows.mjs` |
| T8 | supply chain | runward-fleet verified file by file; runward pinned by sha512 without scripts; actions pinned by commit; three production dependencies | `scripts/verify-runward-fleet.mjs` |
| T9 | denial of service, cost drift | 2 MB read after the token; 30 runs an hour; max scale 1; statement_timeout 10 s; billing alert at 15 EUR | `test/unit/ingest.test.js` |
| T10 | rewrite or truncation of the journal by the operator | chain; no UPDATE, DELETE, TRUNCATE for rw_app; triggers; head copied into each job summary | `test/pg/isolation.test.js` |
| T11 | personal data in the logs | the log keeps a closed list of fields, never a body, token, name or path | `scripts/image-smoke.mjs` |
| T12 | outbound request diverted | one destination outside the hoster, held by boundFetch | `src/adapters/system/egress.js` |
| T14 | capture of the bootstrap | fragment, POST, 24 h, constant time, one transaction, link-used for the second | `test/unit/identity.test.js` |
| T15 | bootstrap or recovery by an agent holding the maintainer's GitHub token | only the digest leaves the workstation; approval of the environment; 24 h computed by the database; banner; reset-access | `test/pg/isolation.test.js` |
| T16 | an agent drives the maintainer's signed-in browser | fresh 5 min; per-gesture verification for the heavy gestures, adding a passkey included; read open, said | `test/unit/identity.test.js` |
| T17 | flood of refused uploads from branches | rate counted per run on pinned tokens only; refused tokens counted globally | `test/unit/ingest.test.js` |
| T18 | oracle and volume from any GitHub repository | token then repository before the body; one answer repository-not-declared; nothing in a tenant's journal | `test/unit/ingest.test.js` |
| T20 | injection through the OIDC claims shown | bounded, control characters removed, escaped; no unsafe-inline for scripts | `test/unit/domain.test.js` |
| T21 | repository transferred | repository_owner_id pinned; owner-changed | `test/unit/ingest.test.js` |
| T22 | the upload token obtained by another step of the job | the send job alone holds id-token, with no third-party step | `scripts/check-workflows.mjs` |
| T23 | regression by re-running an old green run | current = highest run_number; a re-run keeps its number | `test/unit/domain.test.js` |
| T24 | a restore resurrects withdrawn accesses | security log doubled in the object store; restore-replay closes sessions and replays | `test/unit/identity.test.js` |
| T25 | scope of the session cookie | __Host- prefix, no Domain | `test/unit/http.test.js` |
| T26 | uploads filtered by the calling workflow | status line with the commit of the last accepted upload; the witness reader compares with main | `scripts/witness-reader.mjs` |
| T27 | a passkey added by an agent driving the browser | added per gesture, announced in the other sessions, journaled and doubled | `test/unit/identity.test.js` |
| T28 | poisoned artifact or checkout | output under $RUNNER_TEMP, a closed list, digest checked by send; check without --hooks | `scripts/check-workflows.mjs` |
| T29 | disclosure by operator runs of a public repository | operator workflows and tickets in the private repository stranxik/runward-hosted-ops | `runward/runbook.md` |

## 4. Approval points

| Action | Approval trigger | Presentation to the human | If no response |
|---|---|---|---|
| consent, withdraw consent, erase content, export, add or remove a passkey, confirm a repository, cancel a recovery, authorize the reader | always: a verification bound to the gesture and its object | the screen says the effect before the passkey is asked (deterministic text) | nothing happens; the grant expires in 5 minutes |
| open a bootstrap or a recovery, reset access, maintenance | always: approval of the GitHub environment operateur | the workflow run of the private operator repository | the run waits, then expires |
| deploy | the ci run of the commit is green, then environment production | the deploy workflow | no deploy |

## Rule conformance

> Rows are proposed by an agent session and ratified by the author, never by the agent (AGENTS.md, ADR-0082 of runward). The gate refuses a proposed row until it is ratified.

| Rule | Status | Evidence |
|---|---|---|
| async-job-guardrails | proposed:applied | file:src/application/operator.js#operatorCases (the daily jobs are idempotent: each erasure checks erased_at, each retention pass is a no-op when nothing expired; bounded concurrency of one per job, scheduled at the hoster; failures land in the operator journal); file:src/application/ingest.js#upload (idempotency key run, attempt, mission, kind) |
| checklist-pre-production-observability | proposed:applied | file:src/adapters/system/log.js#jsonLog; file:src/http/server.js#createHttp (request id on every answer and every log line) |
| checklist-pre-production-performance | proposed:applied | file:src/adapters/store/postgres.js#postgresStore (statement_timeout 10 s); file:src/domain/workload.js#MAX_EXPORT_BYTES; the read budget per screen (architecture §6) measured by the browser witness |
| checklist-pre-production-resilience | proposed:applied | file:.github/workflows/send.yml (4 attempts, a failed upload warns without failing the CI); file:.github/workflows/rollback.yml; adr:0008 |
| checklist-pre-production-security | proposed:applied | test:test/unit/http.test.js; test:test/pg/isolation.test.js; adr:0005; adr:0006 |
| config-secrets-boundary | proposed:applied | file:src/main.js#readConfig (every secret from the environment, never logged; the vault is the hoster's secret environment variables and the GitHub environment production) |
| data-memory-provenance | proposed:n/a | the service calls no model: deterministic end to end and no memory; every upload's provenance is kept claim by claim in the journal (file:src/application/ingest.js#upload) |
| eval-loop | proposed:n/a | the service calls no model: deterministic end to end: the evaluation is the test pyramid and the six measures S1 to S6 (framing §3) |
| resilience-fail-open | proposed:applied | file:src/application/context.js#security (gestures fail closed: the security log is written before commit); file:web/app.js (reads degrade to named states) |
| resilience-multi-provider-fallback | proposed:n/a | no model provider; the only provider-like dependency is the OIDC issuer, which is the customer's forge itself |
| resilience-retry-backoff | proposed:applied | file:.github/workflows/send.yml (retries with backoff 2 s, 8 s, 30 s, four attempts, a named refusal never retried) |
| routing-confidence-upgrade | proposed:n/a | the service calls no model: deterministic end to end |
| security-code-execution-sandbox | proposed:n/a | no model output becomes execution; the send workflow runs runward on GitHub's hosted runner sandbox, never with --hooks (file:scripts/check-workflows.mjs) |
| security-human-agent-trust | proposed:applied | file:src/domain/identity.js#requireGesture; adr:0005 (an agent driving the browser cannot chain heavy gestures inside one verification) |
| security-mcp-server-pinning | proposed:n/a | no MCP server consumed or exposed in the floor |
| security-prompt-injection | proposed:n/a | the service calls no model: deterministic end to end; untrusted claims and exports are bounded and escaped (file:src/domain/workload.js#cleanClaim) |
| security-tool-change-reapproval | proposed:n/a | no agent tools; a change of the send workflow is a new release SHA that customers adopt explicitly, and a revoked SHA is refused (file:src/domain/workload.js#checkGenericClaims) |

## References

ADR-0003 to ADR-0012; OWASP ASVS; PADR-0010 to PADR-0020.
