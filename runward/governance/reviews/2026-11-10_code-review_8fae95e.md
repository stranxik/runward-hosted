# Code review of PR #8 at 8fae95e: erasure empties every index version built from the erased content

Reviewer: a second AI agent (Claude Fable 5.2, read-only reviewer agent) that wrote none of this code. Thibault Souris, the author, is accountable for it.

*Integrating note*: the reviewer's role is read-only, so it returned this report in its final message and the integrating session saved it here unchanged.

Date: 2026-11-10. Base: `9e7fadf`. Head: `8fae95ec7de524ba4b220a9c1c44a3cccd9e197a` (branch `fix/e1-erase-index-versions`). Diff read with `git diff 9e7fadf...8fae95e`, `reports/junit.xml` ignored. Advisory: this review gates nothing.

## Method

- Read the whole diff, then the code around it: `src/application/{context,operator,reading,repositories,ingest}.js`, `src/adapters/store/{postgres,memory,tables}.js`, `src/adapters/fleet/assembler.js`, `src/http/server.js`, `scripts/migrate.mjs`, `db/grants.sql`, `db/migrations/0001_floor.sql` (policies), ADR-0020, and the threat model and runbook changes.
- Baseline at the head, in the reference environment (NAS, Node 22.23.4, jq 1.7.1, throwaway PostgreSQL 17.11), through `LOCAL_OK=1 scripts/on-nas.sh`:
  - `npm test`: exit 0;
  - `npm run test:pg`: exit 0;
  - `npm run lint`: exit 0;
  - `node scripts/check-workflows.mjs`: exit 0;
  - `npm run test:reports`: exit 0 (231 cases).
- Probes written in a throwaway clone and run in the same environment:
  - three unit probes on the in-memory store;
  - three PostgreSQL probes under `rw_app` and `rw_maint`: a forced interleaving of two transactions, extra attempts against the trigger, and a cost measurement.
- Eighteen planted controls (mutations of the head), each run against `test/unit/{erasure,restore-replay,repositories,jobs}.test.js` and `test/pg/{erasure,restore-replay}.test.js`.

## Findings

### C21 (should-fix): an upload in flight during an erasure leaves a version built from the erased content, whole, until the next daily pass

- **Where**: `src/application/context.js:108-120` (`eraseIndexVersions` takes no tenant lock); `src/application/repositories.js:167-186` (`eraseIn` reaches the lock only in `republish`, after the versions were emptied); `src/application/operator.js:280-313` (`retention`, same).
- **Failure scenario**:
  1. Tenant A has repositories `keep` and `gone`. An upload for `keep` is in its transaction: it holds the tenant lock (`ingest.js:108`) and has assembled the next version from the current set, which includes `gone`'s current upload.
  2. The owner erases `gone`. The erase transaction marks the uploads erased and empties the versions it can see (the upload's version is not committed, so not visible), then waits for the lock in `publish`.
  3. The upload commits its version, built from the erased content. The erase then publishes the next one and answers.
  4. The table now holds a version with the erased content's projection. The `content-erased` entry names the emptied versions without it.
- **What bounds it**: that version is not the one served, and the archive does not pack it (state rule in `reading.js:126`). The retention job's late pass empties it within 24 hours, with a second journal entry.
- **Reproduction** (PostgreSQL, `rw_app`, real concurrency, the interleaving forced by a store proxy):
  - `RACE content-erased entry: {"indexVersions":[3,4,5],"indexVersion":7}`
  - `RACE versions: [[1,34949,false],[2,34960,false],[3,0,true],[4,0,true],[5,0,true],[6,66476,false],[7,36074,false]]`
  - `RACE erased content still in rw.fleet_index after the erasure answered: ["version 6: GONE-RUN-2"]`
  - after `retention` as `rw_maint`: `[[1,false]]`, then `[]`.
- **Not reproduced**: if the erase's own `republish` is refused (`built.ok` false), no later version is published and that version would be the served one. I did not construct this case.
- **Suggested fix**: take the tenant lock before reading the state: `await tx.lockTenant()` first in `eraseIndexVersions`, or first in `eraseIn` and in the per-tenant transaction of `retention`. Under READ COMMITTED the erase then waits for the upload and sees its version. Add the interleaving as a PostgreSQL test.

### C22 (should-fix): after a restore from a backup that predates a retention erasure, the replay empties nothing and a fresh archive packs the erased content again

- **Where**:
  - `src/application/operator.js:291-303`: the retention erasure appends to the journal but writes no security-log event, so `restoreReplay` has nothing to replay for it.
  - `src/application/reading.js:115-126`: `seen.add(name)` at line 118 comes before the check that the bytes exist at line 120, so an upload row that is not erased counts as held even when its bytes are gone.
- **Failure scenario**:
  1. A repository is removed; 30 days later the retention job erases its uploads and empties the versions built from them.
  2. The database is restored from a backup taken before that pass. The versions are back whole and the upload rows are not erased; the object store no longer has the bytes.
  3. `restore-replay` replays 0 gestures for the tenant. The service restarts.
  4. Until the next daily pass, an export of the tenant packs `versions/<n>/index.json` for those versions, and `replay.json` calls them replayable.
- **Reproduction** (unit, in-memory store, the backup snapshot technique of `test/unit/erasure.test.js:171`):
  - `R2 retention: [[3,3],[0,0]]`, `R2 after retention: []`
  - `R2 replay: [[0,false],[0,false]]`
  - `R2 left after restore+replay: ["fleet_index version 4 bytes: GONE-RUN-1","object archives: GONE-RUN-1","archive versions/4/index.json: GONE-RUN-1","fleet_index version 5 bytes: GONE-RUN-2","object archives: GONE-RUN-2","archive versions/5/index.json: GONE-RUN-2"]`
  - `R2 replay.json: [[1,true,false],…,[6,true,false]]`
  - `R2 next retention: [[3,3,false],[0,0,false]]`, then `[]`.
- **The archive half on its own** (object bytes deleted, rows untouched): the archive holds `versions/3..5/index.json` and no `exports/org-gone/…`, all marked `replayable: true`.
- **Scope**: the missing security event predates this PR. ADR-0020 and the JOURNAL say the replay empties the versions again; that holds for an erasure on request only.
- **Suggested fix**, any of:
  - `retention` writes the same `content-erased` security event as `eraseIn`, so the replay acts;
  - `buildArchive` counts an export as held only once its bytes were read (this also corrects `replayable`);
  - runbook §3 and §16 run `retention` after `restore-replay` and before the service restarts.

  The first two together close it without a procedure.

### C23 (should-fix): the daily pass reads every version of a tenant whole, bytes included; its cost grows without bound and its failure blocks that tenant's retention

- **Where**: `src/application/context.js:111` (`tx.list("fleet_index")`), which is `select *` in `src/adapters/store/postgres.js:70`, under `statement_timeout: 10_000` (`postgres.js:46`). Called once per expired repository and once more per tenant on every pass (`operator.js:302`, `:310`).
- **Failure scenario**: every accepted upload publishes a version. A tenant with a few thousand versions makes the daily job load all of them into the gateway's process, which is capped at 512 MiB (`infra/scaleway/main.tf`). If the job is killed, or the statement times out, the tenant's whole retention transaction fails, including the 30-day erasure ADR-0009 promises, and it fails again every day.
- **Measurement** (PostgreSQL 17.11 on the NAS, index of 34,969 bytes, the two-mission fixture):

  | Versions | In the table | One retention pass | Resident memory of the job |
  |---|---|---|---|
  | 2,000 | 68 MiB | 1,578 ms | +140 MiB |
  | 10,000 | 340 MiB | 6,971 ms | +628 MiB |

  A larger fleet has a larger index and reaches this sooner.
- **Scope**: the same unbounded read already exists on main in `publish` and `latestIndex` (`context.js:78`, `:92`), on every upload and every index read. The PR extends it to the daily job, which did not read `rw.fleet_index` before.
- **Suggested fix**: the rule needs `version`, `manifest` and `erased_at` only. Read those columns, for rows where `erased_at is null`, through a narrow store method. In a later change, do the same for `publish` and `latestIndex` (the last row only).

### C24 (note): `erased_at` is not held to a real instant

- **Where**: `db/migrations/0006_fleet_index_erasure.sql:23-28`.
- **Reproduction**: as `rw_app` and as `rw_maint`, `update rw.fleet_index set bytes = ''::bytea, erased_at = '1970-01-01'` and `… erased_at = 'infinity'` each answer `1 row(s)`.
- **Consequence**: an erasure can be back-dated by either role.
- **Not verified**: an `infinity` value may be read by the adapter as an invalid date, which `latestIndex` would take for "not erased" and serve as an empty index. I did not run this.
- **Suggested fix**: the trigger sets `new.erased_at := now()` when it accepts an erasure, or the check refuses a non-finite value.

### C25 (note): a rollback of the service to the previous image serves an erased last version as an empty 200

- **Where**: `runward/runbook.md:84` ("the previous image runs on the new schema") against `9e7fadf:src/application/context.js:88-90` and `src/http/server.js:27-29`.
- **Failure scenario**: a tenant's last version is erased and nothing was published since (after retention or a replay). The service is rolled back to the image before this PR; the gateway keeps the new code. The old `latestIndex` returns that row, and the route answers 200 with zero bytes and the old digest as ETag. The old `publish` calls an identical rebuild "unchanged". The old archive packs an empty `index.json`.
- **Evidence**: read from the code, not run. The planted control M6 (the same behaviour put back into the head) fails the unit and PostgreSQL restore cases.
- **Suggested fix**: say so in runbook §7, or accept it in ADR-0020's consequences.

### C26 (note): no test tells the erasure at the 30-day pass from the late pass

- **Where**: `src/application/operator.js:302`.
- **Evidence**: planted control M11 (that call replaced by `[]`) survives, unit 0/46 and PostgreSQL 0/5. The late pass at line 310 empties the same versions in the same transaction; only the journal differs (one entry naming the repository with `indexVersions: []`, then one without an object).
- **Suggested fix**: assert the entry that names the repository carries the versions, or drop the inner call and keep one path.

### C27 (note): this branch and PR #9 conflict

- **Where**: `reports/junit.xml`, `runward/JOURNAL.md`.
- **Evidence**: `git merge-tree --write-tree 8fae95e 22a983b` reports a content conflict in both files.
- **Consequence**: the second to merge is rebased and its reports regenerated in the reference environment.

## Planted controls

Each control was applied to the head, the six test files run, and the file restored. "Killed" means at least one case failed.

| Control | Result |
|---|---|
| M1 the application code of main (`context`, `operator`, `reading`, `repositories` at `9e7fadf`) | killed: unit 4/46, PostgreSQL 3/5 |
| M2 migration without the trigger | killed (pg 1) |
| M3 trigger without "an erasure is not undone" | killed (pg 1) |
| M4 migration without the check constraint | killed (pg 1) |
| M5 grants without `rw_maint`'s `UPDATE` | killed (pg 3) |
| M6 `latestIndex` serves an erased last version | killed (unit 1, pg 1) |
| M7 `publish` takes an erased last version for "unchanged" | killed (pg 1, the drill only) |
| M8 archive reads `erased_at` only, not the state | killed (unit 1, pg 1) |
| M9 replay does not empty the versions | killed (unit 1, pg 1) |
| M10 retention without the late pass | killed (unit 1, pg 1) |
| M11 no emptying at the 30-day erasure itself | **survived** (C26) |
| M12 emptied versions do not take the live archives | killed (unit 1, pg 1) |
| M13 erasure on request does not empty the versions | killed (unit 2, pg 2) |
| M14 the rule counts erased uploads as held | killed (unit 4, pg 3) |
| M15 trigger lets bytes be rewritten | killed (pg 1) |
| M16 memory store without its guard | killed (unit 1) |
| M17 trigger lets the other columns move | killed (pg 1) |
| M18 the rule's `every` turned into `some` | killed (unit 3, pg 2) |

On M1, the ADR says 5 of 7 unit cases fail on the old code. I measured 4 with the new `memory.js` and `tables.js` kept; the fifth is the store's own guard (M16).

## Checked with no finding

- **Trigger and grant.**
  - As `rw_app` and `rw_maint`, a change of `tenant_id`, `version`, `fleet_version`, `fleet_archive_sha256` or `manifest_sha256` is refused, and so is `insert … on conflict do update set bytes`.
  - Neither role can disable the trigger, set `session_replication_role`, replace the function or call it directly.
  - `rw_maint` cannot insert.
  - Another tenant's rows are out of reach under the forced row-level security, and without a tenant no row is touched (the PR's own third PostgreSQL case, and M2 to M5, M15, M17).
- **Expansion only.** `migrate()` applied `0006` in every PostgreSQL run, so `planMigrations` and `contracting()` accepted it: a nullable column, a check, a function, a trigger. Main's service code never updates `rw.fleet_index`, so the old image keeps working on the new schema during a deploy, apart from C25.
- **Served index.** No erased version is served (404, M6). The route sends `cache-control: no-store`, and there is no in-process cache and no per-version route.
- **Journal and upload rows.** A quarantined upload's refusal text does not carry the content: after erasure, a marker placed in a private path was found nowhere (journal, `upload.claims`, repository row, objects, archive).
- **Objects.** The bucket has no versioning (`main.tf:223`). Prepared archives go with the emptied versions (M12).
- **Backups.** Daily, kept 7 days. ADR-0020 states the residual.
- **Idempotence and tenant scope.** A second pass erases nothing, each tenant is its own transaction, and the other tenant's versions are byte-identical before and after (the PR's cases, re-run).
- **Rule coverage.** A version built from the repository's first, unmarked upload is emptied too (M18).
- **Future columns.** The trigger names its columns one by one, so a later column that projects content is not covered until it is added. ADR-0020 already says so.

```json
{"commit":"8fae95ec7de524ba4b220a9c1c44a3cccd9e197a","blocking":[],"should_fix":["C21","C22","C23"],"notes":["C24","C25","C26","C27"]}
```
