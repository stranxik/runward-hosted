# Mission Contract: runward hosted

**Date**: 2026-11-06 · **Sponsor**: Thibault Souris · **Operator(s)**: Thibault Souris; agent sessions act under their own identity, never his (ADR-0110 of runward) · **Indicative horizon**: floor in weeks, after the paid resources are approved

## Principle

A deliverable is judged by its acceptance against an observable criterion (framing §3, SC-1 to SC-6), not by its form.

## Engagements

| Engagement | Deliverables | Definition of Done |
|---|---|---|
| **Framing** | runward/framing.md, the PADRs ratified on 2026-11-06 | the author validated S1 to S6 and Q1 to Q12 (2026-11-06) |
| **Executable floor** | this repository: the service, the send workflow, the CI, the two infrastructure descriptions, the runbook | S1 to S6 measured on the deployed service and published in runward/floor.md |
| **Staged iteration** | one ADR per trigger of framing §6 | each increment measured, each complexity traced to its trigger |
| **Handover** | runward/handover.md, the runbook | a task redone without the builder, dated |

## Acceptance of the whole mission

1. The service holds in production on the maintainer's real repositories.
2. S1 to S6 are measured and reached, or their gap is explained.
3. Governance is in place: journal, isolation proof, probe, rollback.
4. The runbook lets the author operate it alone.

## Typical roadmap and decision gates

```
framing (done) --> floor built (this repository) --> resources approved --> deployed --> S1..S6 measured
                                                     gate: author's price approval     gate: floor proven?
```

## The contract, to fill with the sponsor

| Field | To fill in |
|---|---|
| **Problem** | framing §1 |
| **Success criterion** | framing §3, SC-1 to SC-6 |
| **Floor** | framing §4 |
| **Target** | framing §5 |
| **Engagements retained** | framing, executable floor, staged iteration |
| **Milestones & gates** | resources approved by the author; deploy enabled (RW_DEPLOY_ENABLED); seven days of S1 |
| **Deliverables & DoD** | engagements table above |
| **Hard constraints** | framing §7 |
| **Risks owned by the sponsor** | no paid resource yet; one human (R5) |
