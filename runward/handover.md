# Hand-over Note: runward hosted

**Date**: 2026-11-10 · **Phase**: handover · **From**: the agent sessions that built the floor, under the author's direction · **To**: Thibault Souris (author and operator), and any agent session after them, which reads `AGENTS.md`

The kit is written and indexed below. The redone task (runbook §13) was redone on 2026-11-10 by an agent session that did not build this repository, from §13 alone: 12 of 12 steps as written; the six gaps it found are folded back into §13 (§2). Every row of the manifest below is a proposal.

## 1. The kit

| Artifact | Where | State | Exercised by the receiving side? |
|---|---|---|---|
| Recovery runbook | `runbook.md` (the seven gestures in §0; the rehearsal in §13) | §13 redone by the receiving side on 2026-11-10, 12 of 12 steps as written; the other sections untested by it | yes, §13: §2 |
| Agent charter (finalized) | `AGENTS.md` | finalized at hand-over, 2026-11-10 | read by every later session |
| Architecture note + decision journal | `architecture.md` · `adr/` (ADR-0001 to ADR-0018) · `JOURNAL.md` | current; ADR-0018 proposed | — |
| Execution topology and usage registry | `execution-topology.md` | current (revised 2026-11-10: the operator's gateway) | — |
| Threat model, observability schema, evaluation rubric | `governance/` | current (2026-11-10: T30 to T33; the retention and the operational view) | — |
| Port contracts | `contracts/` (`index-assembler.md`, `port-contract.md`, `api-contract.json`) | current | — |
| Evaluation bench | `npm test`, `npm run test:pg`, `npm run test:reports` (runbook §14); S1 to S6 on the deployed service | ready (the suites run in CI at each push); untested for S1 to S6 (no deployment yet) | the suites, in CI |
| Evidence pack | `reports/` (JUnit, lint, security scans, regenerated in the reference environment); `runward compliance` on demand | ready | CI checks it fresh at each push |
| Infrastructure | `infra/scaleway/main.tf` (phase 1 applied 2026-11-08; phase 2 waits for the first image); `infra/kubernetes/` (validated in CI, never applied) | partly applied | — |
| The private operator repository | `stranxik/runward-hosted-ops` (planned: its workflows and the environment `operateur`) | empty on 2026-11-10: no workflow, no environment, no secret; the gestures run from the author's workstation (runbook §8) | — |

## 2. The redone task (the proof)

- **Task**: a deploy's first gestures, on a throwaway stack, from runbook §13 alone: the database roles and the migrations through the operator's gateway, the service started on PostgreSQL, the two witness tenants opened, the isolation suite and the daily chain check through the gateway, `/api/health` read, one request traced by its request id, one decision found in the ADRs, everything stopped. It rehearses locally the sequence that runbook §12 step 5 and step 7 run against the hoster; ADR-0016 is settled only by those calls against the hoster, at the first deploy. Its builder ran the commands of §13 once on 2026-11-10 (the NAS, Node.js 22.23.4, PostgreSQL 17.11): every verification line read as written, 8 seconds in all. That is the builder checking his own procedure, not the proof.
- **Date / doer**: 2026-11-10, an agent session (Claude Fable 5.2) that did not build this repository, briefed with §13 and this note only, the builder out of the loop.
- **Evidence**: file:runward/redone-task.md — the twelve steps at commit `0d94dc2`, each with its verdict line as printed, its match with Verify and its time: 12 of 12 as written, on the first run; 108 s for steps 1 to 12 (8.7 s of commands, 99 s reading the ADRs), on the author's home server (Node.js 22.23.4, PostgreSQL 17.11).
- **Gaps found**: six, none of them a guess about a command, a value or an expected output; each is folded back into runbook §13 in the same change. (1) Step 11 gave its answer under its question: the key now comes after step 12, to read after answering. This doer had read it before answering, so this run does not prove that the decision is found from the ADRs unaided. (2) Step 2's check was only in its Verify line: it is now in its block. (3) Step 8 did not say what `exit=0` covers: it now does (13 tenant tables from each witness, the refused cross-tenant write, no RLS bypass, exit 2 on an empty base), with the gateway's own line for it. (4) Steps 7 and 8 quoted an abbreviated verdict line: they quote it in full. (5) Running the steps inside a container was not covered: the prerequisites now cover it. (6) The record's destination was said two ways: §13 now says `runward/redone-task.md`, pointed to from here.

How the record is received: the doer reports, for each of the twelve steps of §13, the verdict line printed, the time taken, and every guess; the record is committed under `runward/` (for example `runward/redone-task.md`) and the three lines above are replaced by its date, its doer, a `file:` pointer to it and the gaps, each gap closed in the runbook or the charter in the same change.

## 3. Succession

- **Owner after departure**: Thibault Souris, author and operator. He owns the incidents (the probe's issues, the advisories), the cost (budget 20 EUR a month excluding tax, billing alert at 15 EUR), the keys (below) and the open triggers of the decision journal: ADR-0002 and ADR-0018 (an attested release of runward-fleet, or a change of it on `main`), ADR-0010 (one human), ADR-0011 (a second member), ADR-0013 (a first buyer who requires qualified hosting), ADR-0016 (Serverless Jobs in a private network, a gesture past 900 s, a second operator), ADR-0017 (a k6 run before the first third-party tenant).
- **Escalation path**: one human operates this service (ADR-0010): there is no second person to call, the escalation is to the providers. Security: the advisory form of this repository, the `Contact` of `/.well-known/security.txt`, read by the owner. The hoster: Scaleway support, from the console (runbook §5). GitHub (Actions, OIDC, environments): GitHub Support. runward-fleet, upstream: the issues of `stranxik/runward`, the same owner.
- **Review cadence**: the owner re-reads the usage registry (`execution-topology.md`) and the triggers of the ADRs once a month, the first time on 2026-12-10, and at each event that names a trigger; each review is a dated entry of `JOURNAL.md` and a new "Last review" date in the registry. The evidence seal does not exist yet: `runward check --freeze` after the first green crossing, then at each crossing.
- **Credentials boundary**: the keys live in the owner's macOS keychain (the provisioning key of the project `runward`, the state passphrase, the database roles' passwords, the bucket's key, the operator's token), in the GitHub environment `production` (this repository: `SCW_SECRET_KEY`, `RW_OPERATOR_TOKEN`), in the containers' secret environment and in the encrypted OpenTofu state, outside any repository (the environment `operateur` of the private repository is planned and holds nothing on 2026-11-10); the owner rotates them (runbook §9). The builder held no credential of its own: each session read the owner's keychain entries by name inside a command and wrote none down, so no access was issued to it and none had to be revoked on 2026-11-10; a session that is no longer trusted is answered by rotating the provisioning key (runbook §9).

## 4. Provider-swap drill

The service calls no model, so there is no model provider to swap. Its two analogues:

- **The pinned view, runward-fleet**: re-pinned on 2026-11-10 from `2ab48025` (an integration branch) to `main@5a9cdf0` (ADR-0018): the same tarball, every file proved against GitHub by `scripts/verify-runward-fleet.mjs`, the export replay test and the served views re-run, green. The commands are in runbook §6.
- **The hoster**: never drilled. The same image runs on PostgreSQL and S3 anywhere (`infra/kubernetes/runward-hosted.yaml`, validated by kubeconform in CI, never applied). The trigger that will force the drill: a first buyer who requires qualified hosting (ADR-0013).

## Rule conformance

> Rows are proposed by an agent session and ratified by the author, never by the agent (AGENTS.md, ADR-0082 of runward). The gate refuses a proposed row until it is ratified.

| Rule | Status | Evidence |
|---|---|---|
| handover-agents-charter-final | proposed:applied | file:AGENTS.md#"Never, without the author" — finalized on 2026-11-10 from the scaffold: the exact verification commands (the gate, the suites, the reports, where each runs), the ten never-rules this mission learned, the judgment boundaries, the pull request rules |
| handover-redone-task-proof | proposed:applied | file:runward/handover.md#"2. The redone task (the proof)"; file:runward/redone-task.md — redone on 2026-11-10 by an agent session that did not build this repository, from runbook §13 alone: 12 of 12 steps as written; six gaps, each folded back into §13 in the same change |
| handover-runbook-executable | proposed:applied | file:runward/runbook.md#"0. The seven gestures, where they are"; file:runward/runbook.md#"13. A rehearsal of a deploy's first gestures"; file:scripts/operator-call.sh — each gesture with its command and what to read to verify it; the rehearsal's twelve steps ran as written on a throwaway stack on 2026-11-10, by its builder and then by a doer who did not build the repository (file:runward/redone-task.md) |
| handover-succession-named | proposed:applied | file:runward/handover.md#"3. Succession" — owner Thibault Souris; escalation to the providers (one human, ADR-0010); a monthly review from 2026-12-10; no access issued to the builder, so none to revoke |

## Cross-references

- `workflows/handover.md`: the phase this note closes.
- `runbook.md`: the operational half of the kit; this note indexes, the runbook operates.
- `AGENTS.md`: the charter the next agent inherits.
- `adr/`: the open re-evaluation triggers the owner now watches.
