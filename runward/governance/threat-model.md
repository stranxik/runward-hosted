# Threat Model: runward hosted

**Version**: v0.2 · **Last review**: 2026-11-10 · **Agent privilege level**: low (no agent in the service)

Revised on 2026-11-10: the operator's gateway as an entry point, T30 to T33, after the independent review of a4ede14.

The full model (T1 to T29) is the architecture note v2 §11 (author's private folder); each threat here names its guard in this repository.

## 1. Attack surfaces

| Surface | Description | Trust | Primary risk |
|---|---|---|---|
| **Untrusted input (direct)** | HTTP requests from browsers and from CI jobs | untrusted | forged uploads, cross-site writes |
| **Untrusted input (indirect)** | the bytes of the exports and the claims of OIDC tokens | untrusted | escaping faults in the view (T3, T20) |
| **Memory** | none: the service has no model and no memory of one | untrusted by inheritance | none in the floor |
| **Tools** | none exposed to a model; the route table is the closed list of gestures | guarded | a gesture without its verification (T16) |
| **Exposed surface** | the HTTP API, the send workflow called from other repositories | guarded | oracle, flood (T17, T18, T32) |
| **Operator entry** (ADR-0016) | the gateway's routes, in a private container of the private network: `/gestures/*` behind the hoster's barrier (`X-Auth-Token`) and the operator's token; `/scheduled/retention` and `/scheduled/verify-chains` behind the hoster's barrier only (its schedule cannot hold a secret) | guarded, the most privileged deployment (it holds every database role) | a gesture made by whoever passes the hoster's barrier (T30); the gestures' results leaving the private network (T31) |
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
- **High-privilege patterns (if applicable)**: operator gestures are a closed list run in the hoster's private network, through the operator's gateway (ADR-0016), after an environment approval; only digests of link tokens reach them; each runs as a child process holding one database role; what comes back is a status and a code.

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
| T9 | denial of service, cost drift | 2 MB read after the token; 30 runs an hour; max scale 1; statement_timeout 10 s; billing alert at 15 EUR | `test/unit/ingest.test.js`, `test/pg/isolation.test.js` (the deadline read on the store's connections) |
| T10 | rewrite or truncation of the journal by the operator | chain; no UPDATE, DELETE, TRUNCATE for rw_app; triggers; head copied into each job summary | `test/pg/isolation.test.js` |
| T11 | personal data in the logs | the log keeps a closed list of fields, never a body, token, name or path; its two free fields are bounded and scrubbed (URLs with credentials, tokens, addresses, paths, identifiers) | `scripts/image-smoke.mjs`, `test/unit/observability.test.js` |
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
| T29 | disclosure by operator runs of a public repository | the gestures that take tenant or member identifiers run from the author's workstation, never in a public repository's run; the deploy's gestures in this public repository (`roles`, `migrate`, `isolation`) take no argument, and the gateway answers a status and a code only (T30 to T33); the private repository `stranxik/runward-hosted-ops` is planned for runs that wait for the author's approval (empty on 2026-11-10) | `runward/runbook.md` §8, `.github/workflows/deploy.yml` |
| T30 | a call to the operator's gateway by whoever passes the hoster's barrier (a leaked IAM key with ContainersPrivateAccess) | the operator's token, compared by its sha256 in constant time, the gateway holding only the hash; a closed list of gestures and of arguments, passed as argv; the two token-free paths run only retention and verify-chains, argument-free and idempotent; one gesture at a time (409), each with its deadline (504) | `test/unit/operator-gateway.test.js` |
| T31 | tenant, member and link identifiers, chain heads or error messages of the operator's gestures leaving the private network (the GitHub runner's log) | the gateway answers a status and a code; `scripts/operator-call.sh` prints only closed fields, even from an older gateway; the results stay in the operator journal | `test/unit/operator-gateway.test.js` |
| T32 | a flood of unauthenticated requests on the machine and session routes, each costing an RSA check or a database read | every machine call, every cookie that resolves to no session, counted per address and for the instance before that work; 429 with Retry-After | `test/unit/limits.test.js` |
| T33 | the issuer's keys unreadable for a moment (cold start, deadline): uploads refused for the token's fault and never retried | a failed or empty read of the keys is the service's failure, answered 503 and retried by send.yml; the refresh minute starts only from a good read | `test/unit/oidc.test.js` |

## 4. Approval points

| Action | Approval trigger | Presentation to the human | If no response |
|---|---|---|---|
| consent, withdraw consent, erase content, export, add or remove a passkey, confirm a repository, cancel a recovery, authorize the reader | always: a verification bound to the gesture and its object | the screen says the effect before the passkey is asked (deterministic text) | nothing happens; the grant expires in 5 minutes |
| open a bootstrap or a recovery, reset access, maintenance | always: approval of the GitHub environment operateur, then the hoster's barrier and the operator's token at the gateway | the workflow run of the private operator repository; its log says the gesture's status and code only | the run waits, then expires |
| deploy | the ci run of the commit is green, then environment production | the deploy workflow | no deploy |

## Rule conformance

> Rows are proposed by an agent session and ratified by the author, never by the agent (AGENTS.md, ADR-0082 of runward). The gate refuses a proposed row until it is ratified.

| Rule | Status | Evidence |
|---|---|---|
| async-job-guardrails | proposed:applied | test:reports/junit.xml::a daily job: a failing tenant is retried three times, journalled with its error, and the next tenants still run; test:reports/junit.xml::a daily job: when the tenant list itself cannot be read, the failure is noted before the job stops; test:reports/junit.xml::the retention job is idempotent: a second pass erases nothing and journals nothing more; test:reports/junit.xml::one gesture at a time: a second call while one runs is refused 409; test:reports/junit.xml::"a daily job that did not complete is read by /api/health, without a tenant, and raises the hourly probe's alert until a run completes" — bounded retry, idempotency, bounded concurrency (one gesture at a time, max scale 1), and the failure seen: /api/health reads the last outcome of each job, the probe alerts on it |
| checklist-pre-production-observability | proposed:applied | test:reports/junit.xml::a log line keeps only the fields of its schema: no body, no token, no secret, no path; test:reports/junit.xml::a log line's free fields are bounded and scrubbed: no credential, address, path, identifier or second line in detail and error; test:reports/junit.xml::the error rate: answers at 500 or more over five minutes, shown by /api/health; test:reports/junit.xml::the probe alerts on an unavailable service and on an error rate above 5 % over at least 20 requests; test:reports/junit.xml::a daily job that did not complete is read by /api/health, without a tenant, and raises the hourly probe's alert until a run completes; test:reports/junit.xml::every response carries the request id, the version and the security headers; file:runward/governance/observability-schema.md#"Retention and the operational view" — the dashboard is the hoster's Serverless Containers dashboards with /api/health and the probe's runs; the logs are kept 7 days in Cockpit (the hoster's documented default, cited there) |
| checklist-pre-production-performance | proposed:deviated | ADR-0017 (adr:0017): no load test before the preview; the bounds are tested; a k6 run before the first third-party tenant |
| checklist-pre-production-resilience | proposed:applied | test:reports/junit.xml::send.yml: an unavailable service is retried with backoff 2 s, 8 s, 30 s, four attempts, then the CI is warned, not failed; test:reports/junit.xml::send.yml: a token endpoint that does not answer is cut at its own deadline (10 s) and retried like an unavailable service; test:reports/junit.xml::the issuer's keys: a failed read is the service's failure, and the next read is made, not refused for a minute; test:reports/junit.xml::an upload while the issuer's keys cannot be read is answered service-unavailable (503, retried by send.yml), and the next attempt reads them; test:reports/junit.xml::egress: after five failures in a row the circuit opens, refuses without a socket, then lets one trial through; test:reports/junit.xml::egress: the service's composition bounds the issuer and S3 fetches (deadline and circuit), through the ports themselves; test:reports/junit.xml::a daily job: a failing tenant is retried three times, journalled with its error, and the next tenants still run; adr:0008 |
| checklist-pre-production-security | proposed:applied | file:reports/eslint-security.sarif#security/detect-eval-with-expression; file:reports/eslint-security.sarif#security/detect-child-process; file:reports/eslint-security.sarif#security/detect-unsafe-regex; test:reports/junit.xml::database TLS: a certificate from another authority is refused (the client never sets rejectUnauthorized: false); adr:0005; adr:0006 |
| config-secrets-boundary | proposed:applied | file:reports/eslint-security.sarif#no-restricted-properties; test:reports/junit.xml::the service refuses to start half configured: exit 78, each missing variable named, no value echoed; adr:0008 |
| data-memory-provenance | proposed:n/a | the service calls no model: deterministic end to end and no memory; every upload's provenance is kept claim by claim in the journal (file:src/application/ingest.js#upload) |
| eval-loop | proposed:n/a | the service calls no model: deterministic end to end: the evaluation is the test pyramid and the six measures S1 to S6 (framing §3) |
| resilience-fail-open | proposed:applied | test:reports/junit.xml::the security log is written before the database commits: a failing write fails the gesture; adr:0007 |
| resilience-multi-provider-fallback | proposed:n/a | no model provider; the only provider-like dependency is the OIDC issuer, which is the customer's forge itself |
| resilience-retry-backoff | proposed:n/a | the service calls no model: there is no model call to retry; the calls the service makes have a deadline and a circuit breaker (src/adapters/system/egress.js) |
| routing-confidence-upgrade | proposed:n/a | the service calls no model: deterministic end to end |
| security-code-execution-sandbox | proposed:n/a | no model output becomes execution; the send workflow runs runward on GitHub's hosted runner sandbox, never with --hooks (file:scripts/check-workflows.mjs) |
| security-human-agent-trust | proposed:applied | test:reports/junit.xml::the hosted index never shows machine-established, even if an export claims it (PADR-0011 point 2, planted); test:reports/junit.xml::consent given in the declaration needs the per-gesture verification, and the box is empty by default; adr:0005 — what a CI declared is shown as declared, never as established, and every heavy gesture is approved on the action |
| security-mcp-server-pinning | proposed:n/a | no MCP server consumed or exposed in the floor |
| security-prompt-injection | proposed:n/a | the service calls no model: deterministic end to end; untrusted claims and exports are bounded and escaped (file:src/domain/workload.js#cleanClaim) |
| security-tool-change-reapproval | proposed:n/a | no agent tools; a change of the send workflow is a new release SHA that customers adopt explicitly, and a revoked SHA is refused (file:src/domain/workload.js#checkGenericClaims) |

## References

ADR-0003 to ADR-0012, ADR-0016, ADR-0017; OWASP ASVS; PADR-0010 to PADR-0020.
