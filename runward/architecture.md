# Architecture Note: runward hosted

**Date**: 2026-11-06 · **Phase**: architect · **Source**: the architecture note v2 of 2026-11-06 (author's private folder) and PADR-0010 to PADR-0020, restated here in English.

## 1. Context

A hosted view of runward missions: each declared repository's CI sends what runward wrote; the service assembles the index with the pinned runward-fleet and serves runward-fleet's own view behind passkeys. The system has **no model**: no LLM call, no model port. It never sees code, runs neither runward nor a test nor customer code (the send workflow runs runward in the customer's CI), raises no cell, and does not know the CLI.

## 2. Boundaries

- **Entry** (`src/http/`): HTTP and JSON, `/api/v0` in the path, additive only, tolerant reader; every write a POST, PATCH or DELETE checked same-origin; no GET writes; every answer carries `Runward-Request-Id` and `Runward-Version`.
- **Application** (`src/application/`): upload, order, assemble, sign in, links, declare and confirm, consent, withdraw and restore, journal, export, erase, operator gestures, witness reader.
- **Domain** (`src/domain/`): refusals, workload claims and upload order, identity rules, repositories and retention, the chained journal. Imports only itself and `node:crypto` (`test/unit/boundary.test.js`).
- **Adapters** (`src/adapters/`): PostgreSQL and in-memory stores, S3 and in-memory objects, GitHub OIDC, WebAuthn, runward-fleet (the anti-corruption layer), tar, clock, log, egress.
- **Operator entry** (`src/operator-gateway.js`, ADR-0016): a second process of the same image, in a private container of the private network, one authenticated route per gesture of the closed list, each gesture a child process holding one database role; it answers a status and a code, the results stay in the operator journal.

## 3. Ports

| Port | Direction | Intent | Contract version | Spec |
|---|---|---|---|---|
| EntryPort (HTTP) | primary | receive uploads from CI, gestures and reads from browsers | v0 | ../src/http/server.js |
| TenantStore and Ledger | secondary | persist under a tenant set by the server; append to the chained journal; resolve by exact key | v0 | ../src/adapters/store/tables.js |
| ExportStore, SecurityLog, Archive | secondary | keep bytes by content; write the security log before commit; keep a prepared archive 24 h | v0 | ../src/adapters/objects/objects.js |
| WorkloadVerifier | secondary | verify a CI's OIDC token, or name the refusal | v0 | ../src/adapters/oidc/github.js |
| HumanAuthenticator | secondary | passkey ceremonies, a challenge bound to a purpose and a gesture | v0 | ../src/adapters/webauthn/simplewebauthn.js |
| IndexAssembler | secondary | the fleet index by runward-fleet, or a named refusal | v0 | contracts/index-assembler.md |
| Clock, Log | secondary | the service time, declared; one JSON line per event | v0 | ../src/adapters/system/log.js |

Port contracts: `runward/contracts/index-assembler.md` (IndexAssembler) and `runward/contracts/port-contract.md` (the other secondary ports); the HTTP contract is `runward/contracts/api-contract.json`, compared with the served one by a test.

## 4. Default topology and triggers

| Default | Rationale | Evolution trigger |
|---|---|---|
| Modular hexagonal monolith | one deployable, pure domain plus adapters (ADR-0001) | more than sixty routes, or a module with its own scaling or release cycle |
| Single orchestrator | the application layer composes use cases; no agent | a genuinely parallelizable subtask (none known) |
| Tool registry + middleware chain | no agent tools: one entry middleware holds the host list, request id, headers, same origin, session, and the order of the route table, in one place (`src/http/server.js`); the rows live in `src/http/routes/`, one file per domain | a second entry (an MCP read access) |
| One core language, thin model SDK | no model SDK at all; Node.js because runward-fleet is JavaScript; three production dependencies | a measured need the table router cannot cover in under a hundred lines |
| Mono-instance, scale 0 to 1, state outside the process | all durable state in PostgreSQL and S3; held per instance, by design at one instance: the rate windows and the 130 minutes of their overflow counts (`src/http/limits.js`), the error window of `/api/health`, the issuer's key cache (`src/adapters/oidc/github.js`), the cookies that resolved in the last minute (bounded) and the circuits (`src/adapters/system/egress.js`), each lost on a restart | S2 or S6 fails at scale 0 (minimum scale 1), or a second instance: advisory locks already serialise per tenant; the per-instance windows, key cache and circuits then move to PostgreSQL, or an ADR keeps them per instance |

## Rule conformance

> Rows are proposed by an agent session and ratified by the author, never by the agent (AGENTS.md, ADR-0082 of runward). The gate refuses a proposed row until it is ratified.

| Rule | Status | Evidence |
|---|---|---|
| contracts-governance | applied | test:reports/junit.xml::the API contract served is the committed one: same routes, same refusals, same digest; test:reports/junit.xml::planted control: one more route, or a route opened to the public, changes the digest; file:runward/contracts/api-contract.json; adr:0003 |
| hexa-adapter-pattern | applied | file:reports/eslint.json#src/application/app.js; file:reports/eslint.json#src/adapters/store/memory.js; file:reports/eslint.json#src/adapters/store/postgres.js; file:reports/eslint.json#src/adapters/objects/objects.js |
| hexa-architecture | applied | file:reports/eslint.json#src/domain/workload.js; file:reports/eslint.json#src/main.js; test:reports/junit.xml::the hexagon is refused by the linter: each forbidden arrow, planted in its layer, is an error; adr:0001 |
| hexa-typescript-native | n/a | the service calls no model: there is no model SDK or chain framework to keep light; JavaScript ES modules without a framework (adr:0001) |
| process-adr-and-journal | applied | adr:0002; adr:0016; file:runward/JOURNAL.md; file:runward/adr/ADR-0018-runward-fleet-re-pinned-at-main-5a9cdf0-where-pr-496-merged-refines-adr-0002.md#Refines — an accepted record is never edited: ADR-0002, rewritten in place on 2026-11-10, is restored as accepted, and the re-pin is a new record that refines it (ADR-0018, proposed) |
| security-mcp-server-pinning | n/a | no MCP server is consumed or exposed in the floor; agent read access by MCP is deferred to its trigger (framing §6) |

## 5. What stays open

The WebAuthn library's behaviour in each browser (the ceremonies are the author's gestures); the private network between the serverless container and the managed base (to confirm at creation); the backup retention settable to 7 days in the console.

## 6. Legacy integration (if any)

runward-fleet is the upstream: its `runward-fleet-index/0` contract is read tolerantly and never extended here; `IndexAssembler` translates the service's records into its inventory.

## 7. Target, named

The control plane of PADR-0003 to PADR-0007 (framing §5).

## 8. Decisions

| Decision | ADR |
|---|---|
| One Node.js monolith, no framework, one network exit | ADR-0001 |
| runward-fleet pinned by a vendored tarball of a commit | ADR-0002 |
| runward-fleet re-pinned on main at main@d05b597, where PR #499 merged; the archive digest names the build | decided: ADR-0021, accepted 2026-11-11, refining ADR-0018 (accepted 2026-11-10, re-pinned at main@5a9cdf0); refined by ADR-0024, accepted 2026-11-11 (re-pinned at main@d052814, where the grouped decision reading merged; an index of an earlier archive is read as published until its next publication) |
| Upload by the OIDC token of the send workflow | ADR-0003 |
| The index by runward-fleet, the view imported | ADR-0004 |
| Passkeys and one link mechanism | ADR-0005 |
| Forced RLS, exact-key resolution | ADR-0006 |
| The chained journal and the security log | ADR-0007 |
| The deployment chain | ADR-0008 |
| Consent, retention, erasure | ADR-0009, refined by ADR-0020 (erasure empties the index versions built from the erased content) |
| Operating with one human | ADR-0010 |
| Members, invitation at its trigger | ADR-0011 |
| The witness reader | ADR-0012 |
| Licence and hosting | ADR-0013 |
| Design tokens in one file | ADR-0019 (the app's own layer), which supersedes ADR-0014 |
| The in-memory store as reference adapter | ADR-0015 |
| The operator's gateway to the private database | ADR-0016, refined by ADR-0023 (the grants compared by a gesture of their own, under rw_owner), accepted 2026-11-11 |
| No load test before the preview; the bounds are tested | ADR-0017 |
| The public site served by the app: the landing at `/` for everyone, the shell at `/app`, its `/#/` addresses kept | superseded: ADR-0022, accepted 2026-11-11, superseded by ADR-0028 the same day |
| The shell in the grammar of its public site: the scene as the ground, glass windows, one header; the haze drifts on the sign-in only | pending: ADR-0025 (refines ADR-0019, accepted 2026-11-10), proposed |
| The app's layer is the house's visual base; runward keeps its own signs; the house signs the foot | pending: ADR-0026, proposed |
| The public site is runward.dev; the app's origin carries the app only: the shell at `/`, the sign-in for a signed-out visitor, the former public pages answering 308 to runward.dev | decided: ADR-0028, accepted 2026-11-11 (supersedes ADR-0022) |
| A forge port: an upload is bound by the identity each forge gives (GitHub, gitlab.com, registered GitLab instances), several issuers in one process, and the level of evidence it reaches is shown per application | decided: ADR-0029, accepted 2026-11-11 after three passes of its review (refines ADR-0003 and ADR-0001); no code yet |
| Azure DevOps by an Entra access token for runward's application: a direction, its rules fixed after a real token is read | direction: ADR-0030, accepted 2026-11-11 as a direction; no code, no rule before a real Entra token is read |

### Ratification
- 2026-11-10 · rows: contracts-governance, hexa-adapter-pattern, hexa-architecture, hexa-typescript-native, process-adr-and-journal, security-mcp-server-pinning · by: Claude Fable 5.2 (independent reviewer) (declared, agent) · for: Thibault Souris (declared, accountable) · bound: contracts-governance@3819c661f85728cf, hexa-adapter-pattern@b76e0f90c6a7b5b3, hexa-architecture@611e39392ab4085f, hexa-typescript-native@c33865aec11fb9dd, process-adr-and-journal@6d0c6b5a4da8f56b, security-mcp-server-pinning@2e6d819f82f30657 · mode: agent
