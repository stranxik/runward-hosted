# Execution Topology

**Date**: 2026-11-06

## The two visions, behind the same ports

The application domain is the hosted service; the execution topology is one container at the hoster, a managed PostgreSQL and an S3 bucket in the same region, the OIDC issuer's keys as the only destination outside the hoster.

## The port → placement map

| Port | Adapter (what runs) | Location family | Data class(es) crossing it | Sovereignty level | ADR | Re-evaluation trigger |
|---|---|---|---|---|---|---|
| TenantStore and Ledger | PostgreSQL managed (DB-DEV-S), private network | Managed infrastructure service | internal business, personal (names in received exports) | raised | ADR-0013 | a buyer requires qualified hosting |
| ExportStore, SecurityLog, Archive | S3 bucket, same region, no versioning | Managed infrastructure service | personal (exports), internal | raised | ADR-0013 | a first third-party tenant: a key per tenant |
| EntryPort (HTTP) | `node:http`, in-app | In-app | personal (sessions), internal business | raised | — | a second entry (MCP) |
| WorkloadVerifier | in-app, reads GitHub's public keys | In-app | public reference (public keys) | standard | ADR-0003 | GitLab declared |
| HumanAuthenticator | in-app library | In-app | personal (public keys of passkeys) | raised | ADR-0005 | a second human |
| IndexAssembler | in-app, runward-fleet pinned | In-app | internal business | raised | ADR-0004 | runward-fleet changes its contract |
| Clock, Log | standard output, read at the hoster | Existing infrastructure | internal: no body, token, name or path | raised | ADR-0013 | a third-party trace export requested: its own ADR |

Secrets (database role, S3 keys, the deploy key) are environment variables of the container or of the GitHub environment `production`, never in the image or a file.

## Protection level by data class

One level per class of data, whatever port it crosses; a port that several classes cross holds the highest of their levels (the map above).

| Data class | Examples | Level | Where it may live | ADR |
|---|---|---|---|---|
| public reference | the OIDC issuer's public keys, the published send workflow commits | standard | anywhere it is published | ADR-0003 |
| internal business | the fleet index, missions, repository declarations, the operator journal | raised | the hoster in Paris (fr-par), in the Union | ADR-0013 |
| personal | passkey public keys, sessions, members, names inside consented exports | raised | the hoster in Paris (fr-par), in the Union; erased on demand or 30 days after a removal | ADR-0009, ADR-0013 |
| secret | the database roles' passwords, the object storage keys, the deploy key | high | the hoster's secret environment and the GitHub environment `production` only; never in the image, a file, a log or a report | ADR-0008 |

## Usage registry

| Deployment | Risk class | Data classes touched | Action scopes | Owner / responsible | Last review |
|---|---|---|---|---|---|
| runward-hosted / preview (app.runward.dev) | medium | internal business, personal (consented exports) | read for members; append for workloads; gestures per passkey | Thibault Souris | 2026-11-06 |
| send.yml / customer CI | low | the customer's own export | upload of runward's output only | Thibault Souris | 2026-11-06 |
| temoin.yml / witness reader | low | the authorized fleet's index and archive | read only | Thibault Souris | 2026-11-06 |

## Rule conformance

> Rows are proposed by an agent session and ratified by the author, never by the agent (AGENTS.md, ADR-0082 of runward). The gate refuses a proposed row until it is ratified.

| Rule | Status | Evidence |
|---|---|---|
| topology-port-placement-mapped | proposed:applied | file:infra/scaleway/main.tf; file:src/main.js#compose; adr:0013 |
| topology-sovereignty-by-data-class | proposed:applied | adr:0013; adr:0009; file:runward/execution-topology.md#Protection level by data class |
| topology-trace-export-decision | proposed:applied | file:src/adapters/system/log.js#jsonLog; adr:0013 (no third-party telemetry; the log never carries a body, a token, a name or a path) |
| topology-usage-registry-present | proposed:applied | file:runward/execution-topology.md#Usage registry |

## Cross-references

`runward/architecture.md`, `infra/`, ADR-0008, ADR-0013.
