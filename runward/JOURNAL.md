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

## 2026-11-10 - the follow-up of C11 to C13, then of C13 to C19

- Done: the send workflow takes a `runner` input; its three jobs have deadlines; the image smoke reads GitHub's OIDC token over five tries. An adversarial review of `d569c95` (`runward/governance/reviews/2026-11-10_code-review_d569c95.md`) found nothing blocking and seven findings, all answered on this branch: the workflow guard reads `runs-on` from a closed list of hosted labels (C16); past the limiter's bound a key is counted with its prefix, and untracked calls are logged, exposed in `/api/health` and alerted by the probe (C14); the send job looks for Node.js 22 before it runs (C15); no `execute` passes inside a body and `set schema` is refused (C13); the lost-anchor bound is pinned by a test (C19); `restore-replay --anchor` is refused while a restore waits for its replay (C17); the residual of a GitHub-hosted runner built from the caller's image is recorded (C18, T41).
- Decided: nothing structural. T41 needs a record: it goes with the record of a client's own runner per declared repository (option C, which amends ADR-0003), planned.
- Next: an independent review of these fixes; the merge; then the first release, whose SHA of `send.yml` the service will accept.

## 2026-11-10 - two defects of the deployment chain, found at the first deploy

- Done: on `fix/deploy-smoke-tls-and-privilege-drift`. The smoke's refused-host check could not pass behind the hoster: Node took the TLS server name from the `Host` header, and the hoster's router answers 404 itself for a host it does not know. The smoke now keeps the server name on the origin, sends as `Host` the container's default hostname at the hoster (`RW_SERVICE_HOST`), and accepts only the app's own 421 `host-not-allowed`; an https origin without that host is refused, and `deploy.yml` refuses before it builds (`test/unit/smoke.test.js`, a local TLS stand-in; `scripts/check-workflows.mjs`). In `infra/scaleway/main.tf`, the privileges of `rw_app` and `rw_maint` are set at creation and ignored afterwards, and the containers' memory is the value the hoster stores (`test/unit/infra.test.js`; runbook §7, §11, §12).
- Decided: nothing structural. A later change of the level of `rw_app` or `rw_maint` at the hoster no longer shows in a plan. At this point of the branch nothing read their table rights: `roles` checked their attributes and CONNECT, the isolation suite that no row crosses between the witness tenants (review finding C28; closed by the next entry).
- Next: the author sets the repository variable `RW_SERVICE_HOST`, then reads a plan against the real state: it must propose nothing.

## 2026-11-10 - the review of the deploy fixes: the grants compared at each deploy, the workflow rule read by job, the service's host checked at the hoster

- Done: on `fix/deploy-smoke-tls-and-privilege-drift`, the findings of `runward/governance/reviews/2026-11-10_code-review_22a983b.md`.
  - C28: `scripts/roles.mjs --grants`, run as `rw_admin` through the gateway right after `migrate` at each deploy, compares what `rw_app` and `rw_maint` may do in effect (their own grants, PUBLIC's, a membership's; on a table or on one of its columns) on the tables of `rw` and `rw_meta`, on those two schemas and on the database (CONNECT, CREATE) with the grant lines of `db/schema.snapshot.txt`, which now holds the schema and database lines too. One more or one fewer stops the deploy before the service switches; the one line said names tables, roles and privileges, never a row. A snapshot without lines for a role is a refusal. `test/pg/isolation.test.js` plants nine drifts, each refused and named. The comment of `infra/scaleway/main.tf` and runbook §7, §8, §11 say what is checked and what is not (the schema `public`, functions, sequences, TEMPORARY).
  - C30: the workflow rule reads jobs and their `needs`: every job that holds a secret refuses an empty `vars.RW_SERVICE_HOST` among its own steps first, or needs a job that does; a refusing step with `if:` or `continue-on-error:` is none; no secret in the workflow-level `env`; the smoke is matched through npm scripts too. The review's N4, N5, N8, N9 and N10 are planted and refused (`test/unit/smoke.test.js`). N6 (the second refusal removed) is not planted: the smoke itself refuses the origin's own host, now with a trailing dot too.
  - C31: `deploy.yml` gives the container the hoster returned to `scripts/service-host-check.sh`, which refuses when `vars.RW_SERVICE_HOST` is not that container's `domain_name` (without case, without one trailing dot), before the step writes its outputs, so a refusal builds nothing and rolls nothing back. The field's name is the one of the hoster's published SDK; its value was not read from the live API here, so an answer without it is a refusal.
- Decided: nothing structural. The gateway's gesture `roles` takes one boolean argument, `grants`; the list of gestures is unchanged.
- Blocked / to dig: the first deploy with this branch reads, against the hoster, two things no test here can: that the container's `domain_name` is the bare host name `vars.RW_SERVICE_HOST` holds, and that the effective grants of the deployed base are the snapshot's (a preset of the hoster that had reached the schema `rw`, or a right given to PUBLIC, stops the deploy at `roles` with grants, which is the point; the gateway's log line says which). Both fail before the service switches.
- Next: the author reads the first deploy's two lines; this branch and `fix/e1-erase-index-versions` conflict in `reports/junit.xml`, `db/schema.snapshot.txt` and this journal: the second to merge is rebased and its reports and snapshot regenerated in the reference environment.

## 2026-11-10 - erasure reaches the earlier versions of the index

- Done: erasing content now empties every published version of the index built from it (its digests, `seq` and `fleet.json` stay), on request, at retention, at the replay of an erasure after a restore (at `8fae95e`, an erasure on request only: corrected in the next entry), and for what an earlier erasure left whole; the export archive no longer packs such a version, and a prepared archive is removed. Migration `0006_fleet_index_erasure.sql` (column, constraint, trigger `fleet_index_written_once`) and a bounded `UPDATE` for `rw_maint`. `test/unit/erasure.test.js` (7 cases) and `test/pg/erasure.test.js` (3 cases) search a content marker everywhere, with a positive control and another tenant unchanged; on the old code they redden. The point "to dig" of the restore entry on the served index after a replayed erasure is answered.
- Decided: ADR-0020, proposed: erasure empties every index version built from the erased content; it refines ADR-0009.
- Next: an independent review of the change, then the author's decision on ADR-0020.

## 2026-11-10 - the review of the erasure change, answered

- Done: the three should-fix findings of the independent review of `8fae95e` (`runward/governance/reviews/2026-11-10_code-review_8fae95e.md`) and three of its notes.
  - C21: an erasure takes the tenant lock before its first read (on request, and in each tenant's retention transaction), and a gesture that republishes takes it before it assembles. Four PostgreSQL cases force a transaction in flight during an erasure on two real connections: an upload of another repository, an upload of the erased one, a change of language, a restore at the end of its window.
  - C22: the retention pass writes the `content-erased` security event an erasure on request writes, so `restore-replay` acts on it; the archive counts an export as held once its bytes were read, so a restored base that counts bytes the object store no longer has packs no version built from them, and `replay.json` does not call it replayable. The entry above said the replay empties the versions again: at `8fae95e` that held for an erasure on request only; it now holds for both.
  - C23: the rule reads the versions not yet erased, their number and their `fleet.json` only, through a narrow store method in both adapters. `publish` and `latestIndex` still read every version whole, as on main: not changed here.
  - C24: the trigger of `0006` dates an erasure itself. C26: the 30-day erasure writes one entry, which names the repository, its digests and the versions; the tests assert it. C25: runbook §7 and ADR-0020 say what a rollback to an image of before `0006` serves for an erased last version.
  - Evidence, in the reference environment: `npm test` 212 of 212, `npm run test:pg` 30 of 30. The new cases fail on the code of `a116a9e` (4 unit, 7 PostgreSQL), and ten planted controls, one per fix, each redden their case (the review's M11 among them).
- Decided: nothing new. ADR-0020 stays proposed; its text is revised to say what the code now does.
- Next: the author's decision on ADR-0020. This branch and the deploy-smoke branch both change `reports/junit.xml` and this journal (C27): the second to merge is rebased and its reports regenerated.
- Blocked / to dig: `publish` and `latestIndex` read every version of a tenant whole on each upload and each index read (C23, second half); `eraseIn` removes the bytes from the object store before it writes its security event, where the retention pass now writes the event first.

## 2026-11-10 - ADR-0020 accepted

- Done: the author accepted ADR-0020 in chat, after the review of `8fae95e` and its fixes; the architecture note, the runbook and T24 name it as in force.
- Decided: ADR-0020 accepted.
- Next: the merge, after #6 and #9, with the reports and the schema snapshot regenerated on the merged tree.

## 2026-11-10 - the follow-up of the second adversarial review (C30 to C39)

- Done: the review of `144211b` (`runward/governance/reviews/2026-11-10_code-review_144211b.md`) found nothing blocking, three findings to fix and seven notes; this branch answers them. The migration guard reads a dollar-quoted body three times (raw, comments turned into a space, and as the server reads SQL, nested bodies included), lets `truncate` pass only as the event of a `create trigger`, and reads `U&"..."` as a name; the review's ten statements are refused, and so are five spellings found next to them (`drop"c"`, `alter"c"type`, `uescape`, a literal handed to `do` or `as` inside a body, a comment the other reading hides) (C30). The workflow guard reads a call's `with:` and send.yml's `runner` input from closed lists, accepts a job's `uses` only for a workflow of this directory, and refuses a foreign line break and a continued label (C31, C32, C33). The probe opens its issue on the first probe that reads an untracked call, since that count ends with the instance; the refusals on a prefix's allowance are counted and their cost is written in T32 (C34, C35). `--anchor` reads each log from its newest object back, its check is retried and noted, and a test holds the date of the replay note (C36, C37). T41's bound is GitHub's wording (C39). The false refusals of C38 stay, said in the guard's header. Each fix has a planted control that turns its test red.
- Decided: nothing structural. Not done, on purpose: refusing `--anchor` when the security log holds an event later than the journal's last entry (C36). A security event is written before its transaction commits, so a gesture that failed after the write leaves such an event with no restore behind it, and the anchor would be refused, for every tenant, at the moment it is needed. The limit is in runbook §8 instead.
- Blocked / to dig: an alert at the hoster on the log line `limits.untracked`, which would not depend on the instance (whether Cockpit gives a rule on a log line at no cost is not read yet); an attribute of a composite type changing type is not refused by the migration guard; whether GitHub matches a reusable workflow's input names without case was not measured, the guard refuses every case.
