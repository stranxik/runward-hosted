# Framing Note: runward hosted, preview up to the floor

**Date**: 2026-11-06 · **Sponsor**: Thibault Souris (the author) · **Entry mode**: derived from an existing system (runward-fleet, ADR-0121 of runward) · **Stopping tier**: floor

This note restates, in English, the framing note (v2) and the author's decisions of 2026-11-06, kept in the author's private architecture folder. The product decisions are the ratified PADR-0009 to PADR-0020; this mission's ADRs apply them (`runward/adr/`).

## 1. Problem

What runward proves on a repository is read in that repository's CI and nowhere else across several repositories, unless someone gathers the exports of N repositories in the job that builds a runward-fleet page, which nobody does; and a page published on Pages is public, or private on a paid plan. The maintainer governs several missions and has no single, private, current view of what each proves, which one is refused and why, which one is silent.

## 2. Value

Each CI sends its own exports, authenticated by its workload identity, with no secret to hold; the product assembles the index with runward-fleet's MIT builder and serves runward-fleet's own view behind a sign-in; every upload is journaled, append only; the export replays the same view at home, byte for byte. The maintainer decides, by looking, which mission to repair first and which one is silent.

## 3. Observable success criterion

The six measures are made on the service deployed at Scaleway, published in the floor note with their value even when it disappoints. Thresholds written before the measure.

### SC-1

**Metric**: share of accepted uploads whose indexSha256 anchored in the client job is the index served and the index runward-fleet rebuilds from the export, over 7 consecutive days
**Unit**: %
**Baseline**: unknown
**Threshold (success)**: = 100
**Measured on**: at least 20 accepted uploads from at least 3 repositories of the maintainer, on the deployed service
**Measured by**: [tbd]

### SC-2

**Metric**: median delay from the merge on main to the served index that carries the upload
**Unit**: minutes
**Baseline**: unknown
**Threshold (success)**: <= 10
**Measured on**: real merges of the maintainer's repositories, first upload of a pending repository excluded
**Measured by**: [tbd]

### SC-3

**Metric**: median time from declaring a new repository to its first view, following only the app's instructions
**Unit**: minutes
**Baseline**: unknown
**Threshold (success)**: <= 5
**Measured on**: 3 trials in the existing account, each published
**Measured by**: [tbd]

### SC-4

**Metric**: rows read or written outside their tenant, two real witness tenants, on the deployed base, after each deploy
**Unit**: count
**Baseline**: unknown
**Threshold (success)**: = 0
**Measured on**: the deployed base, with a planted positive control that fails
**Measured by**: [tbd]

### SC-5

**Metric**: share of deploys whose served revision, read from the hoster's API, carries the image digest built for a commit whose gate is green, and whose /api/version says that commit
**Unit**: %
**Baseline**: unknown
**Threshold (success)**: = 100
**Measured on**: every deploy, plus one timed rollback
**Measured by**: [tbd]

### SC-6

**Metric**: data reads at the opening of a screen
**Unit**: count per screen
**Baseline**: unknown
**Threshold (success)**: <= 4
**Measured on**: every screen, by the browser witness in CI on the deployed service; the monthly bill stays within 20 EUR excluding tax
**Measured by**: [tbd]

## 4. Floor

One OCI container (a modular monolith), one PostgreSQL, one S3 bucket. Uploads by the OIDC token of the product's send workflow, called by SHA; the index assembled by the pinned runward-fleet without a trust policy and served as `index.json` to the same `views.js`; passkeys only, with bootstrap, two passkeys, fresh and per-gesture verification, revocable sessions and a recovery with a delay; declarations awaiting their first upload; consent per repository; forced row level security with two witness tenants; an append-only chained journal; an export that replays; `/api/version`, `/api/health`, JSON logs with a request id, a deploy chain on a green verdict, a written rollback, two infrastructure targets, an hourly probe, a restore drilled once.

## 5. Target (named, not built)

The control plane of PADR-0003 to PADR-0007: approval queue for sampled and per-act modes, a vault with signed receipts and published heads, a portfolio view, fleet policy distribution, an exportable proof report, qualified hosting.

## 6. Named deferrals

| Deferred capability | Lean default in place | Trigger to revisit |
|---|---|---|
| Signed receipts and heads published outside the service | chained journal, head copied into each client job summary | first tenant who is not the maintainer, or the entity registered |
| Digests-only mode (PADR-0002 default) | content consented per repository, dated derogation | first third-party tenant |
| Inviting a second member | the member model in the schema, the link mechanism handles invitations | a second human in a tenant |
| Magic link by e-mail | passkeys, phone by QR code | a human with no passkey device, observed |
| Agent read access (MCP) | none | a measured need of a session that must read the fleet |
| Exporter by chunks | one archive, 512 MB cap | an archive above 256 MB |
| GitLab tokens | GitHub only | a first GitLab repository declared |
| Canary, several revisions | one revision, rollback by digest | first third-party tenant |
| Billing | none | entity registered and the lawyer's opinion |

## 7. Hard constraints

The main path stays at the customer (the CLI and runward-fleet suffice alone, nothing in them knows the product); OCI, PostgreSQL, S3, no hoster service and nothing outside the Union in the data path; two targets validated; one interface (runward-fleet's view, nothing raised, no field added); the product never sees the code and runs neither runward nor a test nor the customer's code; no euro before the legal entity; FSL-1.1-MIT; every paid resource priced and approved by the author before creation; three identities never mixed; the identity of runward's design (no indigo, one gold, no red or green); the words the product never says.

## 8. Presumed boundaries

Ports: ExportStore, SecurityLog, Ledger, TenantStore, WorkloadVerifier, HumanAuthenticator, IndexAssembler, Clock, Archive, Log (architecture note §2). One language chosen for a local reason: Node.js, because runward-fleet is JavaScript (ADR-0001).

## 9. Definition of Ready check

| Condition | Status | If missing: named risk |
|---|---|---|
| Real problem, identified sponsor | met | — |
| Observable success criterion | met | — |
| Floor-first principle accepted | met | — |
| Access to the real process and people | met | — |
| Usable data or a path to it | met | — |
| Access to technical infrastructure | risk | no paid resource exists yet: the six measures wait for the author's approval of the resources listed in runward/runbook.md §11 |
| Hard constraints known | met | — |
| Human available to decide and approve | risk | one human decides, operates and approves (R5): everything that can be automated is |
