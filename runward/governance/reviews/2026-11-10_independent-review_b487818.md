# Independent re-reading of the three refused rows, 2026-11-10 (commit b487818, branch `fix/h0-gate`, PR #5)

**Reviewer**: a second AI agent (Claude Fable 5.2, read-only reviewer agent) that wrote none of the rows. Thibault Souris, the author, is accountable for it.

*Integrating note*: this reading closes a sequence of three on 2026-11-10. At `7f00128`: 39 rows held, 7 were refused (`2026-11-10_independent-review_7f00128.md`). At `e60a0d4`, after the code and document fixes and the task redone blind: 43 held, 3 were refused, two of them because the charter and the threat model still named the approval of the environment `operateur` as in force, and one because two of the second doer's gaps were not folded back. That intermediate report was delivered in the session and is summarised here; its findings are the three refusals answered below. The adversarial code review of the same commit is `2026-11-10_code-review_e60a0d4.md`.

**Commit**: `b487818c298298042c94f4710570b2eaf173b55e`, a fresh clone. `e60a0d4` is its ancestor. The diff between the two touches five documents only: `AGENTS.md`, `runward/governance/threat-model.md`, `runward/handover.md`, `runward/runbook.md`, and the second code review added under `runward/governance/reviews/`. No code, test or report changed. I changed nothing in the repository and used `ratify --list` only, never `--accept`.

## What the gate said

`npx -y runward@0.46.0 check --strict`, exit 1:
- The 13 deliverables are filled.
- The only red is "46 proposed row(s) awaiting ratification".
- The 46 identifiers and proposed statuses are the same as at `e60a0d4` (26 applied, 1 deviated, 19 n/a).
- CI when read: `test`, `runward` and `infra` were all still queued.

## Mechanical checks

- **Pointers**: all 129 typed pointers of the 46 rows resolve.
- **Reports**: unchanged since `e60a0d4`, where I regenerated and compared them on the NAS (211 JUnit cases, 0 failure, 0 skip; lint and both scans clean). I did not re-run the suites at this commit, since no code, test or report moved.
- **Format check**: 190 text files, clean.
- **One row's evidence text changed**: `governance/threat-model.md:security-human-agent-trust`.
- **Runbook §13 at this commit**, on the NAS: the container variant's three new commands ran as written, and so did the timing helper, copied character for character from the prerequisites. Steps 1 to 10 and 12 printed every Verify line, each followed by its `step n: … ms` line. The one deviation is that I ran the steps through `docker exec` without a terminal, where the text says `docker exec -it`.

## Result

**46 rows hold (26 applied, 1 deviated, 19 n/a). None is refused. None is pending.**

## The three refusals, one by one

- **`handover.md:handover-agents-charter-final`: holds.**
  - `AGENTS.md:32` now names where secrets live as the topology does: the keychain, the environment `production`, the containers' secret environment and the encrypted OpenTofu state. It says the environment `operateur` is planned and holds nothing.
  - `AGENTS.md:47` now says the author runs an operator gesture himself from his workstation, that an agent session runs one only on his explicit instruction for that gesture, and that the environment's approval is not in force.
  - This agrees with `runward/handover.md:20`, `runward/execution-topology.md` and runbook §15.
  - The charter's verification commands were run as written at `e60a0d4` and have not changed.

- **`governance/threat-model.md:security-human-agent-trust`: holds.**
  - The guardrail of §3, T15 and the approval table of §4 now state the present control: the author's own act, or his explicit instruction to a session, then the two barriers at the gateway.
  - T15 names its residual plainly: an agent session on the workstation can read the keychain by name, so the instruction is the guard until the approval environment exists.
  - The row's note is narrowed to what its tests prove: every heavy gesture of a member is verified by a passkey; an operator gesture is the author's own act.

- **`handover.md:handover-redone-task-proof`: holds.**
  - G2 is written into §13: `docker network create`, the two `docker run` commands, then the clone and `npm ci` inside the container.
  - G4 is written into §13: the `lap` helper.
  - `runward/handover.md` §2 cites both and says the doer had guessed the commands from §16.
  - Both ran as written here.
  - What held at `e60a0d4` still holds: step 11 answered blind and exact against ADR-0016, and the restore drill as real backlog.

## Other rows this diff touches

- **`handover.md:handover-runbook-executable`**: holds. Runbook §3 now keeps the service stopped from before the restore until the replay has answered 200 (finding C10 of the second code review), and T24 says so.
- **The other rows of `governance/threat-model.md`**: their cited evidence did not move; they hold as at `e60a0d4`.

## Reservations

- **`governance/threat-model.md:checklist-pre-production-security`: the lock-out is still possible at a higher price.** This is the one the author should weigh before ratifying.
  - Finding C11 of the second code review: past 10,000 addresses in one window, every unseen address shares one counter (`src/http/limits.js`, `keyOf`), and a valid session or upload from an address not yet seen is refused 429.
  - I confirmed the mechanism by reading. The code review reproduced it on real sockets; I did not re-run it.
  - The row's cited test holds for its stated case (600 dead cookies from 20 addresses). The guard as worded in T35 ("refuse only the addresses that failed") and the residual in T32 understate this.
  - I hold the row because the attack needs about 170 requests a second from 10,000 addresses, which would drown a quarter-processor instance anyway. It is announced for a follow-up pull request before the first release.
- **`handover.md:handover-runbook-executable`**:
  - §3 names the stopped state ("minimum and maximum scale 0") but gives no command for it.
  - Line 45 still says "an operator workflow waits for its environment approval", which §15 corrects further down.
  - The rollback and the suspended approval remain unexecuted.
  - Finding C12: the `restore-replayed` note misstates the lost range when the gesture is run again with another `since`.
- **`floor.md:data-migrations-forward-only`**: finding C13. A contraction assembled at run time inside a function body passes the guard; the header of `scripts/migrate.mjs` overstates its reach. The cited tests claim only the spellings they list.
- **`handover.md:handover-redone-task-proof`**: the builder's absence stays declared, not verifiable. The receiving side that redid the task is agent sessions, not the author.
- **`architecture.md:process-adr-and-journal`**: ADR-0016, accepted, still says 03:37 and still describes the `operateur` workflow as calling the gateway. The journal explains the hour; a short refining record would keep the ADR and the system in step.

## ADR-0018

Unchanged, and my opinion is unchanged: recommended for acceptance. The author decides.

## What remains

Nothing was ratified by this review. All 46 rows are named for acceptance below, with the reservations above.

```json
{
  "commit": "b487818c298298042c94f4710570b2eaf173b55e",
  "accept": [
    "architecture.md:contracts-governance",
    "architecture.md:hexa-adapter-pattern",
    "architecture.md:hexa-architecture",
    "architecture.md:hexa-typescript-native",
    "architecture.md:process-adr-and-journal",
    "architecture.md:security-mcp-server-pinning",
    "execution-topology.md:topology-port-placement-mapped",
    "execution-topology.md:topology-sovereignty-by-data-class",
    "execution-topology.md:topology-trace-export-decision",
    "execution-topology.md:topology-usage-registry-present",
    "floor.md:async-post-turn-pipeline",
    "floor.md:checklist-day-zero-project",
    "floor.md:config-secrets-boundary",
    "floor.md:data-migrations-forward-only",
    "floor.md:frontier-deterministic-boundary",
    "floor.md:hexa-adapter-pattern",
    "floor.md:hexa-architecture",
    "floor.md:hexa-move-deterministic-out",
    "floor.md:provider-llm-auto-detection",
    "floor.md:provider-no-crash-missing-env",
    "floor.md:scaling-state-externalization",
    "floor.md:security-prompt-injection",
    "floor.md:state-event-sourcing",
    "floor.md:tools-registry-pattern",
    "floor.md:tools-scope-atomicity",
    "governance/threat-model.md:async-job-guardrails",
    "governance/threat-model.md:checklist-pre-production-observability",
    "governance/threat-model.md:checklist-pre-production-performance",
    "governance/threat-model.md:checklist-pre-production-resilience",
    "governance/threat-model.md:checklist-pre-production-security",
    "governance/threat-model.md:config-secrets-boundary",
    "governance/threat-model.md:data-memory-provenance",
    "governance/threat-model.md:eval-loop",
    "governance/threat-model.md:resilience-fail-open",
    "governance/threat-model.md:resilience-multi-provider-fallback",
    "governance/threat-model.md:resilience-retry-backoff",
    "governance/threat-model.md:routing-confidence-upgrade",
    "governance/threat-model.md:security-code-execution-sandbox",
    "governance/threat-model.md:security-human-agent-trust",
    "governance/threat-model.md:security-mcp-server-pinning",
    "governance/threat-model.md:security-prompt-injection",
    "governance/threat-model.md:security-tool-change-reapproval",
    "handover.md:handover-agents-charter-final",
    "handover.md:handover-redone-task-proof",
    "handover.md:handover-runbook-executable",
    "handover.md:handover-succession-named"
  ],
  "reject": [],
  "pending": [],
  "adr0018": "accept: unchanged since the previous readings; coherent with ADR-0002, vendor/runward-fleet.lock.json, package-lock.json, the archive and upstream; the author decides"
}
```
