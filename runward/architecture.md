# Architecture Note: runward hosted

**Date**: 2026-11-06 · **Phase**: architect · **Source**: the architecture note v2 of 2026-11-06 (author's private folder) and PADR-0010 to PADR-0020, restated here in English.

## 1. Context

A hosted view of runward missions: each declared repository's CI sends what runward wrote; the service assembles the index with the pinned runward-fleet and serves runward-fleet's own view behind passkeys. The system has **no model**: no LLM call, no model port. It never sees code, runs neither runward nor a test nor customer code (the send workflow runs runward in the customer's CI), raises no cell, and does not know the CLI.

## 2. Boundaries

- **Entry** (`src/http/`): HTTP and JSON, `/api/v0` in the path, additive only, tolerant reader; every write a POST, PATCH or DELETE checked same-origin; no GET writes; every answer carries `Runward-Request-Id` and `Runward-Version`.
- **Application** (`src/application/`): upload, order, assemble, sign in, links, declare and confirm, consent, withdraw and restore, journal, export, erase, operator gestures, witness reader.
- **Domain** (`src/domain/`): refusals, workload claims and upload order, identity rules, repositories and retention, the chained journal. Imports only itself and `node:crypto` (`test/unit/boundary.test.js`).
- **Adapters** (`src/adapters/`): PostgreSQL and in-memory stores, S3 and in-memory objects, GitHub OIDC, WebAuthn, runward-fleet (the anti-corruption layer), tar, clock, log, egress.

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

Port contracts: `runward/contracts/index-assembler.md`.

## 4. Default topology and triggers

| Default | Rationale | Evolution trigger |
|---|---|---|
| Modular hexagonal monolith | one deployable, pure domain plus adapters (ADR-0001) | more than sixty routes, or a module with its own scaling or release cycle |
| Single orchestrator | the application layer composes use cases; no agent | a genuinely parallelizable subtask (none known) |
| Tool registry + middleware chain | no agent tools: the route table and one entry middleware hold the host list, request id, headers, same origin, session, in one place (`src/http/server.js`) | a second entry (an MCP read access) |
| One core language, thin model SDK | no model SDK at all; Node.js because runward-fleet is JavaScript; three production dependencies | a measured need the table router cannot cover in under a hundred lines |
| Mono-instance, scale 0 to 1, state outside the process | all state in PostgreSQL and S3 | S2 or S6 fails at scale 0 (minimum scale 1), or a second instance (advisory locks already serialise per tenant) |

## Rule conformance

> Rows are proposed by an agent session and ratified by the author, never by the agent (AGENTS.md, ADR-0082 of runward). The gate refuses a proposed row until it is ratified.

| Rule | Status | Evidence |
|---|---|---|
| contracts-governance | proposed:applied | file:src/http/server.js#apiContract; file:src/domain/refusals.js#REFUSALS; adr:0003 |
| hexa-adapter-pattern | proposed:applied | file:src/application/app.js#PORTS; file:src/adapters/store/memory.js#memoryStore; file:src/adapters/store/postgres.js#postgresStore |
| hexa-architecture | proposed:applied | test:test/unit/boundary.test.js; adr:0001 |
| hexa-typescript-native | proposed:deviated | adr:0001 (JavaScript ES modules: runward-fleet, which the product imports, is JavaScript; no framework, no chain library) |
| process-adr-and-journal | proposed:applied | adr:0001; adr:0003; adr:0006 |
| security-mcp-server-pinning | proposed:n/a | no MCP server is consumed or exposed in the floor; agent read access by MCP is deferred to its trigger (framing §6) |

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
| runward-fleet pinned by a vendored tarball of a commit | pending: ADR-0002, proposed |
| Upload by the OIDC token of the send workflow | ADR-0003 |
| The index by runward-fleet, the view imported | ADR-0004 |
| Passkeys and one link mechanism | ADR-0005 |
| Forced RLS, exact-key resolution | ADR-0006 |
| The chained journal and the security log | ADR-0007 |
| The deployment chain | ADR-0008 |
| Consent, retention, erasure | ADR-0009 |
| Operating with one human | ADR-0010 |
| Members, invitation at its trigger | ADR-0011 |
| The witness reader | ADR-0012 |
| Licence and hosting | ADR-0013 |
| Design tokens in one file | pending: ADR-0014, proposed |
| The in-memory store as reference adapter | pending: ADR-0015, proposed |
| The operator's gateway to the private database | pending: ADR-0016, proposed |
