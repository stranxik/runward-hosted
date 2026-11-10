# Hand-over Note: runward hosted

**Date**: 2026-11-10 · **Phase**: handover · **From**: the agent sessions that built the floor, under the author's direction · **To**: Thibault Souris (author and operator), and any agent session after them, which reads `AGENTS.md`

The kit is written and indexed below. The redone task (runbook §13, the rehearsal, and §16, the restore drill) was redone twice on 2026-11-10 by agent sessions that did not build this repository, from those sections alone; the second time with step 11 answered blind and the restore drill added: 12 of 12 and 17 of 17 steps as written. Every gap found is folded back into the runbook (§2). Every row of the manifest below is a proposal.

## 1. The kit

| Artifact | Where | State | Exercised by the receiving side? |
|---|---|---|---|
| Recovery runbook | `runbook.md` (the seven gestures in §0; the rehearsal in §13; the restore drill in §16) | §13 and §16 redone by the receiving side on 2026-11-10, every step as written; the other sections untested by it | yes, §13 and §16: §2 |
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

- **Task**: two procedures, from the runbook alone. §13: a deploy's first gestures on a throwaway stack (the database roles and the migrations through the operator's gateway, the service on PostgreSQL, the two witness tenants, the isolation suite and the daily chain check through the gateway, `/api/health`, one request traced by its id, one decision found in the ADRs, everything stopped); it rehearses locally the sequence that runbook §12 step 5 and step 7 run against the hoster, and ADR-0016 is settled only by those calls against the hoster, at the first deploy. §16: the restore drill that §3 asks for, real backlog: three tenants used through the real service, a backup, accesses withdrawn after it, the database lost and restored, the replay, and its effects read.
- **Date / doer**: 2026-11-10, twice, each time an agent session (Claude Fable 5.2) that did not build this repository, briefed with the sections and this note only, the builder out of the loop. The second doer did not read the first record.
- **Evidence**: file:runward/redone-task.md — the second run, at commit `79544c7`: §13 12 of 12 as written, step 11 answered blind from `runward/adr/` (ADR-0016, sections Decision and What would settle it, the two sentences quoted; checked by the reviewer of the record against the ADR); §16 17 of 17 as written (39.6 s); on the author's home server. file:runward/redone-task-1.md — the first run, at `0d94dc2`: §13 12 of 12, its step 11 read with its answer, which is why the second run was asked for.
- **Gaps found**: the first run's six gaps are folded into §13 (the answer to step 11 left the runbook, a check moved into its block, what `exit=0` covers, full verdict lines, the container variant, the record's destination). The second run's: a fixed one-second wait could leave §16 step 4 silent on a loaded host, now a bounded wait on the service in §13 and §16; §13's server pinned at the digest of `ci.yml`; §13 step 12 checks the throwaway directory and names the container variant's clean-up; the pulled images are said to stay. None needed a guess about a command's output.

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
| handover-agents-charter-final | proposed:applied | file:AGENTS.md#"Never, without the author"; test:reports/junit.xml::"the charter: every script it names exists and can be run, and its shell scripts parse"; test:reports/junit.xml::"the charter: the suites' NAS commands go through the reference environment, never the bare image; the PostgreSQL row gives its command"; test:reports/junit.xml::"the reference environment is the CI test job's: the PostgreSQL digest read from ci.yml, the Node.js major from .nvmrc, jq pinned by sha256" — finalized on 2026-11-10 from the scaffold: the exact verification commands (the gate, the suites, the reports, where each runs), the ten never-rules this mission learned, the judgment boundaries, the pull request rules |
| handover-redone-task-proof | proposed:applied | file:runward/handover.md#"2. The redone task (the proof)"; file:runward/redone-task.md — §13 and §16 redone on 2026-11-10 by an agent session that did not build this repository, from those sections alone: 12 of 12 and 17 of 17 steps as written, step 11 answered blind; the gaps folded back into the runbook; file:runward/redone-task-1.md, the first run |
| handover-runbook-executable | proposed:applied | file:runward/runbook.md#"0. The seven gestures, where they are"; file:runward/runbook.md#"13. A rehearsal of a deploy's first gestures"; file:scripts/operator-call.sh — each gesture with its command and what to read to verify it; the rehearsal's twelve steps ran as written on a throwaway stack on 2026-11-10, by its builder and then by a doer who did not build the repository (file:runward/redone-task.md) |
| handover-succession-named | proposed:applied | file:runward/handover.md#"3. Succession" — owner Thibault Souris; escalation to the providers (one human, ADR-0010); a monthly review from 2026-12-10; no access issued to the builder, so none to revoke |

## Cross-references

- `workflows/handover.md`: the phase this note closes.
- `runbook.md`: the operational half of the kit; this note indexes, the runbook operates.
- `AGENTS.md`: the charter the next agent inherits.
- `adr/`: the open re-evaluation triggers the owner now watches.
