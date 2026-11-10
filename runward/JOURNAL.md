# Working journal

One entry per working session (process-adr-and-journal). Minor decisions and progress live here; a structural decision graduates to an ADR in `runward/adr/`. The commits of each day carry the detail.

## 2026-11-06 - the floor, end to end

- Done: the mission scaffolded with runward 0.46.0; the domain, the ports and the adapters; the upload path; the routes and the shell; the PostgreSQL isolation suite, the migrations and the operator gestures; the send workflow, the CI and the infrastructure description; runward-fleet re-pinned at 2ab48025; the defects the local witness found, each with its guard.
- Decided: ADR-0001 to ADR-0015 (proposed; 0002, 0014 and 0015 accepted on 2026-11-08).
- Blocked / to dig: the resources at the hoster are created by the infrastructure branch, not here.

## 2026-11-08 - the review findings, each with a test that fails if it comes back

- Done: TLS to PostgreSQL in verify-full against the instance's own certificate (an IP checked against the IP SANs), proved with a local authority and a local TLS server; the migration guard reads statements as the server does and refuses any contraction, gap or reordering; a deadline and a circuit breaker on every call out; rate limits on the public routes, per address and for the instance; the daily jobs journal their failures, isolate tenants and retry a bounded number of times; the API contract committed and compared; the lint, the security scans and the JUnit report committed and checked fresh in CI.
- Decided: ADR-0017 (no load test before the preview; the bounds are tested). The rows that concern a model (hexa-move-deterministic-out, resilience-retry-backoff, state-event-sourcing, hexa-typescript-native) are n/a: the service calls no model.
- Blocked / to dig: `scripts/roles.mjs` (infrastructure branch) must call `migrationTls` at integration, `test/unit/tls.test.js` refuses it otherwise; the number of proxies in front of the container (RW_TRUST_PROXY) is checked on the first deployment.

## 2026-11-10 - the CI test job ends, the deploy's merge is proven, runward-fleet pinned on main

- Done: the TLS test's fake server answers after the handshake (the test job hung until GitHub cancelled it at 6 h); the container deploy's environment merge proven against a stand-in of the hoster; runward-fleet re-pinned at main@5a9cdf0, the commit where PR #496 merged (same files, same tarball, same bytes; ADR-0002 updated).
- Decided: nothing structural (ADR-0002 updated in place: its own trigger fired).
- Blocked / to dig: phase 2 waits for the first image (push-image.yml runs from main only, after PR #1 merges) and the operator's token.

## 2026-11-10 - the independent review's findings, each fixed with its test; the hand-over written

- Done: the issuer's keys (a failed read is answered 503 and retried, never `token-unreadable`; a planted control re-creates the defect); the migration guard reads escape strings and quoted identifiers as the server does; the requests not yet authenticated are counted before an RSA check or a database read; the composition test goes through the verifier and the S3 port, and `send.yml`'s token request has a deadline; the operator's gestures answer a status and a code, and `operator-call.sh` prints only closed fields; the last outcome of each daily job is read by `/api/health` and alerted on by the probe (migration 0004, `rw.daily_jobs()`); the log's free fields are bounded and scrubbed; the statement deadline has its test; a pre-commit hook, wired by `npm install`. The operator's gateway is in the execution topology, the usage registry and the threat model (T30 to T33); the log retention (Cockpit, 7 days, the hoster's documented default) and the operational view are written down; the port contracts are filled; the runbook gains the seven gestures, the rehearsal of a deploy's first gestures (§13, run once by its builder on the NAS), the bench and the approvals; `AGENTS.md` is the final charter; `runward/handover.md` is written.
- Decided: the in-place update of ADR-0002 recorded above is undone: ADR-0002 is restored as accepted on 2026-11-08, and the re-pin on `main` is ADR-0018 (proposed), which refines it. No other structural decision: every manifest row stays a proposal.
- Blocked / to dig: the redone task waits for a doer who did not build the repository (runbook §13, handover §2); the rows wait for the author's ratification; the verify pass (`runward/governance/verify-findings.md`) comes once the gate is green, on another model.
- Next: the redone task's record in `runward/handover.md` §2; ratification; then phase 2 (the first image, the operator's token).

## 2026-11-10 - the two independent reviews published

- Done: the reports of the two independent reviews of the 42 proposed rows are in `runward/governance/reviews/`: 2026-11-08 at `3ac3b8d` (17 rows rejected, six of them on five real defects, fixed the same day, each with a test) and 2026-11-10 at `a4ede14` (9 rows rejected, one new defect on the issuer's keys, three reservations, all addressed on `fix/h0-gate`). Each review was made by an AI agent that wrote none of the rows; Thibault Souris is accountable for both.
- Decided: nothing structural.
- Next: a third independent review at `0d94dc2`, before any ratification.

## 2026-11-10 - the hand-over's task redone by a doer who did not build the repository

- Done: an agent session that did not build this repository redid runbook §13 from §13 alone, on the author's home server: 12 of 12 steps as written, on the first run (`runward/redone-task.md`). Its six gaps are folded back into §13: the key to step 11 after step 12, step 2's check in its block, what step 8's `exit=0` covers, the full verdict lines of steps 7 and 8, the steps run inside a container, the record's destination said one way. `runward/handover.md` §2 holds the record.
- Decided: nothing structural.
- Next: the third independent review, then the ratification.

## 2026-11-10 - the code review and the third review: seven rows refused, the kit told as it is

- Done: the adversarial code review of `0d94dc2` (one blocking finding, five to fix, three notes) and the third independent review of the 46 rows (39 hold, 7 refused) are in `runward/governance/reviews/`. The places of the secret class are written as they are, the encrypted OpenTofu state among them; the usage registry names the deploy chain, the author's workstation and the private operator repository; that repository is said to be empty, as it is on 2026-11-10, and the gestures to run from the author's workstation; the per-instance state is named in the architecture note; the rehearsal keeps no key to its step 11, and its claim to be real backlog is qualified.
- Correction to the entry of 2026-11-06, which lists ADR-0001 to ADR-0015 as proposed: ADR-0001 and ADR-0003 to ADR-0013 were committed as accepted (`5660736`), restating decisions the author had recorded in his private product decision records, which are not in this repository; only ADR-0002, ADR-0014 and ADR-0015 were proposed, then accepted on 2026-11-08.
- Decided: nothing structural.
- Blocked / to dig: the code fixes of both reviews; the restore drill that runbook §3 promised before the floor and that was never done; the task redone again, its step 11 blind; then a fresh reading of the refused rows.

## 2026-11-10 - the findings of the code review and of the third review, each fixed with its test

- Done: on `fix/h0-gate`, 21 commits close C1 to C9 of the code review and the third review's code findings. A security definer function can no longer be shadowed through `pg_temp` (0004 fixed in place, 0005 for the 14 functions of 0001, the `roles` gesture takes TEMPORARY from PUBLIC where it may). The instance's rate budgets count failures and refuse only the addresses that failed. The migration guard reads `$` inside a name, escape strings continued after a newline and non-ASCII columns as the server does. A token that cannot be read is 401, `GET //` is 404. `/api/health` reads its witness object back. A sign-in during a maintenance is refused. No secret passes in a command line, and a guard refuses it. A daily job killed at its deadline gets a note. `npm run operateur:amorcage` prints the gateway command that opens the link. The charter's commands run as written (`scripts/on-nas.sh`, `scripts/reference-env.sh`). Each fix has a test that fails on the old code. The reports were regenerated in the reference environment: 192 JUnit cases, none red. The rows, the threat model (T32 rewritten, T34 to T40), the runbook (§8, §10, §12, §14) and the topology follow.
- Decided: nothing structural. The daily chain check moves from 03:37 to 03:53, after retention's 14-minute deadline. ADR-0016, accepted, still says 03:37 and is not edited in place: its decision (two scheduled, argument-free gestures) is unchanged, only the hour moved.
- Blocked / to dig: whether the hoster lets the `roles` gesture take TEMPORARY from PUBLIC is read at the first `roles` against it. The restore fixes are on their own branch.

## 2026-11-10 - the restore drill, written and run; restore-replay fixed

- Done: the restore drill that §3 asked for before the floor, and that had never been run, is written as runbook §16 and run on a throwaway stack: real passkey ceremonies, real sessions, access gestures in the object store, a backup, a loss, the replay. It found that an access reset after the backup came back after the restore, along with five more defects. `restore-replay` now replays every gesture that withdraws an access, each tenant in its own transaction, retried and noted. Each tenant's head before the loss comes from an anchor written while the database could still be read (`restore-replay --anchor`), and the note says which entries are lost, by their seq. An unreadable security log refuses the gesture whole. Each fix has a test that fails on the old code; `scripts/drill-client.mjs` stands for the browser.
- Decided: nothing structural. The argument `--head-before` is gone: one head could not be right for every tenant.
- Blocked / to dig: after a replayed erasure, the served index stays the old one until the tenant's next gesture (republishing it needs a grant to rw_maint); objects written after the backup stay without a row; whether retention's erasures should write a security event so that they can be replayed.

## 2026-11-10 - the hand-over's task redone blind, with the restore drill

- Done: a second agent session that did not build this repository redid runbook §13 and §16 from those sections alone, at `79544c7`, without reading the first record: 12 of 12 and 17 of 17 steps as written, step 11 answered blind and right (ADR-0016, Decision and What would settle it). Its gaps are folded back into the runbook: bounded waits on the service instead of a fixed second, §13's server at the digest of `ci.yml`, §13's clean-up checked and complete. The first record stays as `runward/redone-task-1.md`.
- Decided: nothing structural.
- Next: the independent review of the refused rows and of the corrected code, then the ratification.

## 2026-11-10 - the app's own design layer

- Done: `web/couche-runward-app.css` replaces `web/tokens.css`: light by default, dark as an option, Geist served by the app from a closed list of files, the state hues told apart by shape, word and hue, no green. The token test audits the layer against the family's contract in both themes, with broken layers planted on purpose; a new test proves the layer and the fonts are served, and nothing outside the list.
- Decided: ADR-0019, proposed: the app's own layer, which supersedes ADR-0014 once accepted. The author agreed to its direction and validated the mock-up of all states on 2026-11-10.

## 2026-11-10 - ADR-0019 accepted

- Done: the author accepted ADR-0019 in chat, in answer to a list that named it; ADR-0014 is marked superseded by it, and the architecture note's row says so.
- Decided: ADR-0019, the app's own design layer, accepted.
- Next: nothing on this boundary until its reevaluation on 2026-11-19.

## 2026-11-10 - runward-fleet re-pinned at main@d05b597, measured: the index changes under the same version

- Done: runward-fleet packed at main@d05b597, where PR #499 of runward merged (the decision reading, `decide` and `renderDecision`), twice to the same sha256; the lock, `package.json` and `package-lock.json` name it; the 22 files proved against GitHub. Measured before deciding: from the same `fleet.json` and exports the two pins give different index bytes (fields added, none changed or removed), even for an empty fleet, and the version stays 0.46.0; an export archive of the old pin, replayed by the new one, was said `different` because the replay matched on the version. `scripts/replay-export.mjs` now matches on the archive digest recorded on each index (`other-archive`, exit 2 when nothing could be rebuilt), with a test and a planted control. The app's router leaves the views' new `decision` route out; a test holds it and checks the new exports are importable.
- Decided: ADR-0021, proposed: the pin at main@d05b597, the archive digest names the build, a published index is never rebuilt by a re-pin, a later re-pin is measured before it is recorded. It refines ADR-0018.
- Noted, not patched (vendored code): the Sources view credits Inter and Departure Mono while the app serves Geist and Geist Mono; it gains a section on the rules of the decision reading, which the app does not show yet.
- Blocked / to dig: `replay.json`, the export's README and the screens still say that the version named rebuilds an index; the entry carries the archive digest but not the commit (the table is in ADR-0021). The runbook (section 6) and the hand-over (section 4) still describe the re-pin of ADR-0018; they follow once ADR-0021 is accepted. Showing the decision reading in the app is another lot.

## 2026-11-10 - the review of the re-pin, its six findings answered: the tarball, the label and the install are each checked

- Done: the adversarial review of `3afe41d` (`runward/governance/reviews/2026-11-10_code-review_3afe41d.md`; nothing blocking, C40 to C42 to fix, C43 to C45 noted) is answered on the branch of the re-pin. C40: `scripts/verify-runward-fleet.mjs` reads the tarball's entries itself and refuses an entry outside `package/`, a link, a name met twice; the lock pins the 22 files with their sha256; online, those names are the ones npm packs at the commit and each file is the commit's. The review's tarball (a second root over `src/build.js`, `LICENSE` missing, the lock set to its digests) is refused in both modes. C41: the replay leaves an index to another archive only when the lock knows that digest and the export's verified journal names it on the publishing entry; anything else is `label-refused`, never a pass; whether an index can be rebuilt is read from the archive. C42: `fleetPin` refuses an install that is not the pinned archive. Replaying the review's K7 showed that the integrity npm recorded does not see files written over the install, so `fleetPin` compares both that integrity and every installed file with the lock's list. C43: the witness reader says same, different and not rebuilt here, with counts and the cause of a red; another archive after the pinned one is red as a rollback. C44: tests for the three exits of the replay (the script is spawned), the witness reader's rule, the router's own `resolve`, and `/api/version` against the tarball npm installed. C45: ADR-0021's sentences corrected. Nineteen controls planted, one per guard, each red.
- Decided: nothing new; ADR-0021, still proposed, now carries the label's rule, the install's check, the rollback among its triggers and the exception of an erasure (ADR-0020, in PR #8). The confirmation of a repository journals the archive with the index it publishes, as the other publications did. `main` (`c94995d`, ADR-0019 accepted) is merged in.
- Blocked / to dig: a service that rewrites its whole journal and `replay.json` together can still present an older changed index as an earlier archive's; the journal's head anchored outside the service is what would close it. The offline mode of the check does not compare with the commit, and says so. The witness reader has never run against the deployed service (`RW_READER_ENABLED` is off).
