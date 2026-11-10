# Agent charter: runward hosted

Finalized at hand-over on 2026-11-10 (`runward/handover.md`), from the scaffold runward wrote on 2026-11-06 and from what this mission learned since. Any agent that works in this repository follows it. The owner is Thibault Souris, author and operator: he decides, he approves, he holds the keys. The method is runward's (`runward/workflows/`); the state of the mission is in `runward/`.

## What this system is, in one paragraph

A hosted fleet view of runward: each declared repository's CI runs runward and sends what runward wrote through `.github/workflows/send.yml` (a GitHub Actions OIDC token, no secret); the service keeps every upload in a per-tenant chained journal and serves the index that the pinned runward-fleet builds; people sign in with passkeys only. It calls no model. Two containers at Scaleway, Paris: the service (public) and the operator's gateway (private, ADR-0016), with a private PostgreSQL and an S3 bucket. The repository is public: what is written here is read by anyone.

## How work is proven here (exact commands)

| What | Command | Where it runs |
|---|---|---|
| The gate | `npx -y runward@0.46.0 check --strict` | anywhere; CI runs the same version, integrity checked (`ci.yml`, job `runward`) |
| Unit, application, HTTP | `npm test` | CI; on the author's Mac, on the NAS: `~/.claude/skills/nas/scripts/verifier-sur-nas.sh . 'npm test'` |
| PostgreSQL (isolation, catalog, planted controls, snapshot) | `PG_ADMIN_URL=postgres://postgres@<throwaway server>/postgres npm run test:pg` | CI; the NAS with a throwaway PostgreSQL 17 at the digest of `ci.yml` |
| The hexagon, the security scan, the format | `npm run lint` | anywhere (the pre-commit hook runs it on what is staged) |
| The committed reports describe the tree | `npm run test:reports` (check), `npm run test:reports:write` (rewrite, in the reference environment only: Linux, Node.js 22, PostgreSQL, jq) | CI checks; the NAS rewrites |
| The workflows' guards | `node scripts/check-workflows.mjs` | anywhere |
| runward-fleet is the code at its pinned commit | `node scripts/verify-runward-fleet.mjs` | CI (online), `--offline` anywhere |
| The behavioural proof of the floor | `npm test && PG_ADMIN_URL=… npm run test:pg` (runward/floor.md §2) | as above |

A claim of "done" names the command that proved it and its result. A change that touches what a manifest row cites regenerates `reports/` in the reference environment, and `npm run test:reports` says so.

## Never, without the author

These are rules, not advice. Each was learned in this mission.

1. **Never ratify a row or accept an ADR.** Rows are written `proposed:<status>`; ADRs `proposed`. The author ratifies (`runward ratify`), or an agent he names, under its own name, never on a row it or he proposed (ADR-0082 of runward).
2. **Never edit an accepted ADR.** A changed decision is a new ADR that refines or supersedes it (`process-adr-and-journal`; ADR-0002 was rewritten in place once, and restored: ADR-0018).
3. **Never create, change or destroy a paid resource** (`infra/scaleway/main.tf`) without the author's explicit approval of that resource; the budget is 20 EUR a month, the alert 15 EUR. `tofu plan` is free; `tofu apply` is not.
4. **Never deploy by hand.** A deploy is a push to `main` through `deploy.yml`, after the ci run of that commit is green; a rollback is `rollback.yml` by digest (runbook §7).
5. **Never print, write or log a secret value**: no token, password, key or connection URL with a password in a command line, a file, a log, a report, a commit or a screenshot. Secrets live in the author's keychain and in the GitHub environments `production` and `operateur`; a session reads them by name inside a command (runbook §9). The operator's token is never shown, even to the author.
6. **Never return what the operator's gestures produce outside the private network**: the gateway answers a status and a code, `scripts/operator-call.sh` prints its closed fields only; a result stays in the operator journal (T31).
7. **Never weaken a guard to make it pass**: no test deleted or loosened, no rule switched off, no `--no-verify` without saying so in the commit, no report edited by hand. A red that is not understood is opened and explained, never called "expected".
8. **Never show `machine-established`** or raise a CI-declared value: the hosted index says what a CI declared, as declared (PADR-0011 point 2).
9. **Never name a third party** (client, employer, candidate) in this public repository; the public text is in English.
10. **Never run a full suite on the author's Mac** (8 GB): suites run in CI or on the NAS (`verifier-sur-nas.sh`); the Mac keeps targeted tests.

## What an agent may do alone

Read anything in the repository and in the hoster's console; write code, tests and documentation on a branch; run targeted tests locally and the suites on the NAS; open a pull request; propose rows and ADRs; draft the runbook's procedures and run them on a throwaway stack (runbook §13). The judgment boundaries:

| Decides | Who |
|---|---|
| a structural choice (a port, a placement, a dependency, a data class, a guard) | the author, on an ADR the agent writes as proposed |
| a paid resource, a release of `send.yml`, a key, a deploy switch (`RW_DEPLOY_ENABLED`, `RW_PROBE_ENABLED`) | the author |
| an operator gesture (bootstrap, recovery, reset of access, maintenance, restore-replay) | the author, by approving the run of the environment `operateur` (runbook §15) |
| which tenant's data is touched | never an agent: tenant data (exports, passkeys, sessions, the journal) is read through the product, under its own guards, never by hand |

## Pull requests and commits

- Every change goes through a branch and a pull request; nothing is pushed to `main` directly. The ci run must be green (`test`, `runward`, `infra`, `image`); a red job is opened, not re-run blindly.
- Conventional commits in English (`fix:`, `feat:`, `test:`, `docs:`, `build:`), the why in the body, the evidence named (the command and its result).
- `npm install` wires the pre-commit hook (`.githooks/pre-commit`: the format, the lint of staged sources, the workflows' guards, the unit tests that reach what is staged).
- A pull request that changes a manifest row, a guard or a workflow says so in its description; the author reviews and merges.

## The loop, at the point of action

1. `runward rules --for <paths>` before touching a file; `runward explain <rule>` for its text.
2. Each rule accounted for in the deliverable's `Rule conformance` table, as a proposal with a typed pointer (`file:`, `test:`, `adr:`), the gate checking it once ratified.
3. `npx -y runward@0.46.0 check --strict` before ending a turn; a red you could fix is fixed.
4. Once the gate is green, the verify workflow (`runward/workflows/verify.md`), ideally on another model, records its findings in `runward/governance/verify-findings.md`; it never gates.

## Where the mission's state is

| File | What it holds |
|---|---|
| `runward/framing.md` | the problem, the six measures S1 to S6, floor and target |
| `runward/architecture.md` | the boundaries, the ports, the decisions table |
| `runward/execution-topology.md` | where each port runs, the data classes, the usage registry |
| `runward/floor.md` | the floor's scope and its proof (not yet measured on a deployment) |
| `runward/adr/` | the decision journal (ADR-0001 to ADR-0018) and `runward/JOURNAL.md`, one entry per session |
| `runward/governance/` | the threat model (T1 to T33), the observability schema (retention, the operational view), the evaluation rubric |
| `runward/runbook.md` | the operations: the seven gestures, the deploy, the operator's gestures, the rehearsal (§13) |
| `runward/handover.md` | the kit, the redone task, the succession |
