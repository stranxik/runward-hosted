# Independent review of the 46 proposed conformance rows, 2026-11-10 (commits 0d94dc2 and 7f00128, branch `fix/h0-gate`, PR #5)

**Reviewer**: a second AI agent (Claude Fable 5.2, read-only reviewer agent) that wrote none of the rows. Thibault Souris, the author, is accountable for it.

**Commits**:
- The 42 rows of architecture, topology, floor and governance were read at `0d94dc28781e880aa63d056d14b2039488c11791`.
- The four hand-over rows were read at `7f0012883651a7ee83fed6cdb4886ef67f413d89`.
- The diff between the two touches six documents only (`runward/JOURNAL.md`, `runward/handover.md`, `runward/redone-task.md`, `runward/runbook.md`, and the two earlier reports copied byte for byte under `runward/governance/reviews/`). No code, test or report changed, so every verdict below stands at `7f00128`.
- I changed nothing in the repository and used `ratify --list` only, never `--accept`.

**The result is amended by the addendum at the end of this report**, which takes the adversarial code review of the same commit into account (`2026-11-10_code-review_0d94dc2.md`): 39 rows hold, 7 do not.

*Assembly note*: the reviewer delivered this report and its addendum as two messages the same afternoon. The integrating session put them in one file. Its only additions are this note, the sentence above, and the marks "(rejected in the addendum)" in the reservations.

## What the gate said

`npx -y runward@0.46.0 check --strict`, exit 1 at both commits:
- At `0d94dc2`: 46 rows `proposed:*` (26 applied, 1 deviated, 19 n/a) and the hand-over note "placeholders remain".
- At `7f00128`: "✓ Hand-over note", 46 proposed rows awaiting ratification.
- The gate verifies nothing mechanically while every row is a proposal ("0 applied · 0 deviated · 0 n/a"), and there is no evidence seal.
- CI at `7f00128` when read: `test` success, `runward` failure (as designed), `image` and `infra` still queued. At `0d94dc2` the three other jobs were cancelled by the later push.

## Mechanical checks

- **Pointers**: all 98 typed pointers of the 46 rows resolve at `0d94dc2`, and all 99 at `7f00128`.
- **`reports/junit.xml`**: 155 cases, 0 failure, 0 skip, written by Node.js v22.23.4 on Linux.
- **`reports/eslint.json`**: 33 files, 0 error, 0 warning, nothing suppressed.
- **`reports/eslint-security.sarif`**: 0 result, 11 rules.
- **`reports/secretlint.sarif`**: 0 result, with 4 rules proven live in `secretlint-control.json`.
- **Full suites on the NAS** (Node.js 22.23.4, throwaway PostgreSQL 17.11 at the digest of `ci.yml`, jq 1.7.1):
  - `npm test`: 141 of 141.
  - `npm run test:pg`: 14 of 14.
  - `npm run test:reports`: fresh ("the committed reports describe this tree").
  - `npm run lint`: clean.
  - `check-workflows`: clean.
  - `verify-runward-fleet` online: 22 files identical at `5a9cdf08`.
  - `npm audit --omit=dev`: 0 vulnerability.
- **Targeted tests on the Mac** (Node.js v24.22.1, where the repository pins 22): 47 cases of nine files, green.
- **My own planted controls**: 11 of 11 killed. They cover the verifier or the S3 adapter given the raw fetch, the machine limiter removed, the dead-cookie refusal removed, the cookie-less session route not counted, the gateway answering the child's output or the refusal's reason, the probe ignoring a failed job or the error rate, a failing tenant stopping the job, and the refresh minute stamped on a failed key read.
- **The 19 n/a rows**: exact. There is no model SDK in `package.json` or among the 28 production packages of the lockfile. `src/` has two `fetch` sites, both bound to the egress. The vendored package has no dependency.

## Result (superseded by the addendum)

**42 rows hold (22 applied, 1 deviated, 19 n/a). 4 do not. None is pending.**

- The deviated row rests on ADR-0017, accepted on 2026-11-09, which says plainly that bounds are not a measure.
- Two new defects were reproduced. One causes a rejection; the other is a reservation.

## New defect, reproduced (rejection)

An anonymous caller can raise the probe's error-rate alert at will.

- **Malformed token**: `src/adapters/oidc/github.js:75` reads `header.alg` on a header that decodes to JSON `null`. The `TypeError` has no refusal code, so `src/application/ingest.js:26-29` answers 503 `service-unavailable` and logs `oidc.keys-unavailable`, with no key read made.
- **Malformed request line**: `GET //` throws "Invalid URL" at `src/http/server.js:163`, before any limiter, and is answered 503.
- **Both are counted as server errors** by `send()` (`server.js:135`).
- **Reproduction** on the local in-memory witness: 25 requests `POST /api/v0/exports` with `authorization: Bearer bnVsbA.e30.AAAA`. `/api/health` then read `{"requests":30,"serverErrors":27,"rate":0.9}` and `scripts/probe-verdict.mjs` answered "probe: error rate 90.0 %", exit 1.
- **Consequence**: two such hours open the issue "service unavailable or erring" in this public repository. It is the mirror of the defect of `a4ede14`: the caller's fault is charged to the service.
- **Direction**: a header or claims that are not an object are `token-unreadable`; an unparsable request line is a 4xx; each with its test.

## Rejected rows (4, before the addendum)

- **`execution-topology.md:topology-sovereignty-by-data-class`**
  - The table it cites says the secret class lives in "the hoster's secret environment, the GitHub environment `production` and the author's keychain only; never in the image, a file, a log or a report".
  - The repository contradicts it twice:
    - `runward/handover.md:36` also names the environment `operateur` of the private repository.
    - `runward/runbook.md` §11 and ADR-0016 say the connection URLs and the S3 keys are "kept in the state", the encrypted OpenTofu state file.
  - The sentence under the placement map repeats the omission.
  - This is the CRITICAL row about where the highest class may live, and it states something the kit itself denies.

- **`governance/threat-model.md:checklist-pre-production-observability`**
  - The defect above: the alert this row claims ("error rates tracked and alerted") is forgeable by anyone, without authentication.
  - The log line names a key outage that did not happen.

- **`handover.md:handover-agents-charter-final`**
  - The rule asks for exact verification commands; two of the charter's are not.
  - `AGENTS.md:14` gives `verifier-sur-nas.sh . 'npm test'` for the NAS. Run as written, it is red: the `operator-gateway` cases exit 127 because `jq` is not in the `node:22` image. With jq on the PATH it is 141 of 141.
  - `AGENTS.md:15` says "the NAS with a throwaway PostgreSQL 17" and gives no command. I had to borrow an earlier session's script to run it.
  - `runward/runbook.md` §14 carries the same NAS command. The doer's gap 5 fixed jq in §13 only.
  - The redone task did not run the charter's commands, so nothing on the receiving side had caught it.

- **`handover.md:handover-redone-task-proof`**
  - The record is credible. I re-ran the amended §13 of `7f00128`, its command blocks extracted mechanically, on the NAS: every Verify line of steps 1 to 10 and 12 printed as written, the new step 8 line included, and the token appeared 0 times in the logs.
  - The proof is still short of the rule on three counts:
    - **The decision leg is unproven.** By the doer's own account he had read step 11's answer before answering. The corrected §13 has not been redone by a receiving-side doer.
    - **"Real backlog" is not supported.** What ADR-0016 lists as settling it is the first calls against the hoster (verify-full against the private address, the hoster's barrier). A local process settles none of it. The task is a rehearsal written by the builder for the occasion.
    - **The builder's absence is declared, not verifiable.** The receiving side named in the note, the author, has redone nothing.
  - What would make it hold: a fresh doer redoes the amended §13 with step 11 blind, and §2 drops or qualifies the backlog sentence. Better, the task is the restore drill, which is real backlog (below).

## Reservations (rows that hold)

- **`floor.md:data-migrations-forward-only`** (rejected in the addendum): the guard is bypassed by a third spelling.
  - `scripts/migrate.mjs:45-48` reads `$b$` as a dollar-quote opening even inside an identifier.
  - `create table rw.t (a$b$ text default '$b$'); drop table rw.ledger; select '1';` passes `contracting()` (null).
  - On PostgreSQL 17.11 it dropped `rw.ledger`: the table existed before and was gone after, and the column was named `a$b$`.
  - The test name "in any spelling" overclaims. The schema snapshot test is the second net.
  - Direction: a `$` that follows an identifier character opens nothing, as in the server's scanner.

- **`floor.md:scaling-state-externalization`**: the rate windows, the error window, the key cache and the circuits are per instance (`src/http/limits.js`, `egress.js`). That is correct at `max_scale` 1, but `architecture.md` §4 says "all state in PostgreSQL and S3" and the second-instance trigger does not name them.

- **`governance/threat-model.md:checklist-pre-production-security`** (rejected in the addendum):
  - The instance-wide budgets can be spent by anyone. 600 dead cookies a minute make `signedOut.peek` (`server.js:218`) refuse every cookie-bearing request, valid sessions included, before the database is read. The same holds for `machine` and uploads.
  - `scripts/operator-call.sh:17` and `scripts/container-deploy.sh` pass the Scaleway key and the operator's token in curl's argv, where never-rule 5 of `AGENTS.md` forbids a token in a command line.

- **`execution-topology.md:topology-usage-registry-present`**: the registry lists `send.yml` and `temoin.yml` as deployments, but neither `deploy.yml` (which holds the key that replaces both containers' image) nor the private operator repository's workflows (which hold the operator's token and receive tenant and member identifiers as inputs).

- **`governance/threat-model.md:async-job-guardrails`** (rejected in the addendum):
  - A job killed at its deadline, or one that cannot reach the database, writes no note. It is seen only by the 26-hour rule.
  - `verify-chains` fires exactly at the end of retention's 14-minute deadline, and a 409 that day is silent until then.

- **`architecture.md:process-adr-and-journal`**: the journal entry of 2026-11-06 says ADR-0001 to ADR-0015 were proposed, while the files of 0001 and 0003 to 0013 have read `accepted` since their first commit, as restatements of decisions kept in the author's private folder. That cannot be checked from the repository.

- **`handover.md:handover-runbook-executable`**: §13 ran as written for two readers that did not build it (the doer and this review). Restore-replay, the rollback and the suspended approval have never been executed by anyone, and §14's NAS command needs the jq fix.

- **`handover.md:handover-succession-named`**: the succession runs from the author's agent sessions to the author. "No access issued" is declared, and one human remains the whole escalation (ADR-0010).

- **Comments out of date**: `eslint.config.js` and the header of `eslint.security.config.js` still say two composition roots; there are three.

- **Public identifiers**: `runward/runbook.md` §12 publishes the hoster's project and organisation identifiers and a path of the author's private folder. They are not secrets.

## ADR-0018 (proposed): recommended for acceptance

It is coherent with ADR-0002, the lock and the archive:
- **ADR-0002** is byte-identical to its accepted text of `3ac3b8d` (empty diff), and its own trigger names the re-pack at the merged commit.
- **Upstream**: PR #496 of runward is merged, its merge commit is `5a9cdf08a76977f9b671662f562e98d332ccc95e`, and `main` is at that commit.
- **The archive** is the same git blob as the previous one (`5a24760e`), sha256 `99e941a5…`. Its sha512 integrity is the one in `vendor/runward-fleet.lock.json` and in `package-lock.json`.
- **The online check** read 22 files identical at `5a9cdf08`.
- `architecture.md` lists it as pending and `contracts/index-assembler.md` names it.

The author decides.

## Follow-up of the two earlier reports

**2026-11-08 (`3ac3b8d`)**
- The five defects stay fixed and held by tests: database TLS, timeouts and circuit, rate limits and audit, the jobs' journal.
- The migration guard is the exception: fixed for the spellings named, bypassed by a new one (reservation above).
- Ten of the eleven evidence rejections are settled.
- The eleventh, the sovereignty row, now has one level per class but is rejected again on the secret class.

**2026-11-10 (`a4ede14`)**
- **OIDC key defect**: fixed. The builder's planted control and mine both see it.
- **ADR-0002**: restored; the re-pin is ADR-0018.
- **Operator's gateway**: now in the map, the registry and the threat model (T30 to T33).
- **Gestures' output**: a status and a code only; both of my mutants were killed.
- **Pre-commit hook**: wired and tested in a throwaway clone.
- **Failed daily job**: read by `/api/health` and alerted on by the probe, a broken chain included.
- **Dashboard and retention**: written down. I read the hoster's 7-day default in its public documentation source.
- **Three reservations**:
  - Escape strings and quoted identifiers: fixed.
  - Unauthenticated requests: counted before their costly work.
  - Composition test: goes through the two ports, and `send.yml`'s token request has a 10 s deadline.
- **Hand-over**: the note, the charter and the redone task exist and are judged above.
- **Still open: the restore drill.** It was listed as not started, it has still not been done, and `runward/runbook.md` §3 itself asks for it "before declaring the floor".

---

# Addendum, 2026-11-10 (same commits)

This addendum supersedes the result, the rejection list and the verdict list of the report above. Everything else in that report stands (the gate, the mechanical checks, the reservations, ADR-0018, the follow-up). It takes into account the adversarial code review at `0d94dc28781e880aa63d056d14b2039488c11791` (`2026-11-10_code-review_0d94dc2.md`).

## What I could and could not confirm of the code review

My clone was already deleted when its findings arrived, so I re-ran none of them. Their standing against my own work:

| Finding | Standing |
|---|---|
| C1, `rw.daily_jobs()` shadowed through `pg_temp` | Not re-run by me. Consistent with the migration text I read (`set search_path = rw, pg_catalog`, `'{}'::jsonb`) and with PostgreSQL searching `pg_temp` first for types. The code review reproduced it on PostgreSQL 17.11. |
| C2, instance-wide budgets refuse valid callers | Same finding as my reservation on `server.js:218`; the code review reproduced it on real sockets. |
| C3, a continued escape string hides a DROP | Not re-run by me. Same class as the bypass I reproduced on PostgreSQL 17.11 (`a$b$` read as a dollar-quote opening, `scripts/migrate.mjs:45-48`). Two independent spellings now pass the guard. |
| C4, `daily_jobs` cost grows on `/api/health` | Not re-run by me. |
| C5, a token with a `null` header answered 503 | Reproduced independently in my review, end to end (error rate 90 %, probe verdict failing). |
| C6, the daily-jobs alert is silent when `dailyJobs` is `null` | Confirmed by reading: `scripts/probe-verdict.mjs:21` iterates `health?.dailyJobs ?? {}`, and `src/main.js:99` returns `null` on any error. |

One correction to my report: without `jq`, `npm test` on the NAS fails on the `operator-call.sh` and the `container-deploy` cases (seven in the code review's run), not only the gateway file. With `jq` it is 141 of 141.

## Amended result

**39 rows hold (19 applied, 1 deviated, 19 n/a). 7 do not. None is pending.**

Three rows move from held to rejected, on the rule that a row whose evidence is contradicted does not pass at this commit.

## Rows newly rejected (3)

- **`governance/threat-model.md:checklist-pre-production-security`**
  - The row cites ADR-0006 for tenant isolation. C1 lets a session as `rw_app` run as `rw_resolve`, which reads tenants, sessions, passkeys and links across tenants. It needs SQL execution as `rw_app`, so it is a breach of the database boundary, not a remote exploit today.
  - "Rate limiting configured and tested" is contradicted by C2: the budgets refuse valid sessions and valid uploads when someone else floods.

- **`governance/threat-model.md:async-job-guardrails`**
  - The row's last test says a job that did not complete "raises the hourly probe's alert until a run completes". C6 shows the alert fails open whenever `rw.daily_jobs()` cannot be read (grants missing, function missing, statement timeout).
  - C4 gives a path to that timeout as the operator journal grows.

- **`floor.md:data-migrations-forward-only`**
  - The cited test claims a contracting statement "is refused wherever it sits, in any spelling". Two spellings pass the guard and drop a table on PostgreSQL 17.11: mine (`a$b$`) and C3 (an escape string continued after a newline).
  - I held this as a reservation in the report; with a second independent bypass it no longer holds.

## Rows already rejected (4, unchanged)

- `execution-topology.md:topology-sovereignty-by-data-class`
- `governance/threat-model.md:checklist-pre-production-observability` (C5 is the same defect; C6 adds to it)
- `handover.md:handover-agents-charter-final`
- `handover.md:handover-redone-task-proof`

## Rows examined against the code review and still held

- **`governance/threat-model.md:checklist-pre-production-resilience`**: its cited tests (deadlines, circuit, key read, retries, shutdown) are not contradicted. Reservation: under C2 a flood makes `send.yml` give up after four attempts, and under C4 the health check slows as the journal grows.
- **`floor.md:scaling-state-externalization`** and **`governance/threat-model.md:resilience-fail-open`**: they cite ADR-0006 and ADR-0007 for shared state and the security log; C1 does not touch what they claim.
- **`floor.md:config-secrets-boundary`** and **`governance/threat-model.md:config-secrets-boundary`**: untouched.

## What remains

Nothing was ratified. Seven rows wait for the corrected commit, where only the rows touched need a fresh reading. The restore drill is still not done.

```json
{
  "commit": "7f0012883651a7ee83fed6cdb4886ef67f413d89",
  "accept": [
    "architecture.md:contracts-governance",
    "architecture.md:hexa-adapter-pattern",
    "architecture.md:hexa-architecture",
    "architecture.md:hexa-typescript-native",
    "architecture.md:process-adr-and-journal",
    "architecture.md:security-mcp-server-pinning",
    "execution-topology.md:topology-port-placement-mapped",
    "execution-topology.md:topology-trace-export-decision",
    "execution-topology.md:topology-usage-registry-present",
    "floor.md:async-post-turn-pipeline",
    "floor.md:checklist-day-zero-project",
    "floor.md:config-secrets-boundary",
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
    "governance/threat-model.md:checklist-pre-production-performance",
    "governance/threat-model.md:checklist-pre-production-resilience",
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
    "handover.md:handover-runbook-executable",
    "handover.md:handover-succession-named"
  ],
  "reject": [
    {
      "row": "execution-topology.md:topology-sovereignty-by-data-class",
      "reason": "The cited table says the secret class lives in the hoster's secret environment, the GitHub environment production and the author's keychain only, never in a file; runward/handover.md:36 also names the environment operateur of the private repository, and runward/runbook.md §11 and ADR-0016 say the connection URLs and the S3 keys are kept in the encrypted OpenTofu state file."
    },
    {
      "row": "governance/threat-model.md:checklist-pre-production-observability",
      "reason": "Reproduced: an anonymous token whose header decodes to JSON null (src/adapters/oidc/github.js:75) and GET // (src/http/server.js:163) are answered 503 and counted as server errors; 25 such requests gave an error rate of 90 % in /api/health and a failing probe verdict, so the error-rate alert is forgeable by anyone (code review C5); the daily-jobs alert is silent when dailyJobs is null (C6)."
    },
    {
      "row": "governance/threat-model.md:checklist-pre-production-security",
      "reason": "Tenant isolation, cited through ADR-0006, is contradicted by code review C1 (rw.daily_jobs() is security definer and names the type jsonb unqualified: a session as rw_app shadows it through pg_temp and runs as rw_resolve, which reads other tenants; reproduced by the code review, not re-run here); the rate limits refuse valid sessions and uploads under someone else's flood (C2, src/http/server.js:218 and :203)."
    },
    {
      "row": "governance/threat-model.md:async-job-guardrails",
      "reason": "The cited alert on a daily job that did not complete fails open: when rw.daily_jobs() cannot be read, /api/health says dailyJobs null (src/main.js:99) and scripts/probe-verdict.mjs:21 reads null as nothing to report (code review C6, confirmed by reading); the function's cost grows with the operator journal towards the statement timeout (C4)."
    },
    {
      "row": "floor.md:data-migrations-forward-only",
      "reason": "The cited test claims a contracting statement is refused in any spelling; two spellings pass the guard and drop a table on PostgreSQL 17.11: an identifier holding $ read as a dollar-quote opening (scripts/migrate.mjs:45-48, reproduced in this review) and an escape string continued after a newline (code review C3, scripts/migrate.mjs:39)."
    },
    {
      "row": "handover.md:handover-agents-charter-final",
      "reason": "The charter's verification commands are not exact: AGENTS.md:14 (verifier-sur-nas.sh . 'npm test') is red as written on the NAS, the operator-call.sh and container-deploy cases exiting 127 because jq is not in the node:22 image (141 of 141 with jq), and AGENTS.md:15 names a throwaway PostgreSQL on the NAS without a command; runbook §14 carries the same NAS command."
    },
    {
      "row": "handover.md:handover-redone-task-proof",
      "reason": "The record is credible (the amended §13 re-ran as written in this review), but the decision leg is unproven by the doer's own account (step 11's answer was read before answering) and the corrected §13 has not been redone by a receiving-side doer; the task is a rehearsal written by the builder, and the 'real backlog' claim settles nothing of ADR-0016, whose confirmation is against the hoster; the builder's absence is declared, not verifiable."
    }
  ],
  "pending": [],
  "adr0018": "accept: coherent with ADR-0002 (restored byte for byte, its own trigger fired), with vendor/runward-fleet.lock.json and package-lock.json (same sha256 and sha512), with the archive (same git blob as the previous pin) and with upstream (PR #496 merged at 5a9cdf08, the head of main; 22 files identical online); the author decides"
}
```
