# Adversarial code review: runward-hosted PR #5, `fix/h0-gate`

Reviewer: a second AI agent (Claude Fable 5.2, read-only reviewer agent) that wrote none of this code. Thibault Souris, the author, is accountable for it.

- **Commit**: `0d94dc28781e880aa63d056d14b2039488c11791`, diff `a4ede14..0d94dc2`.
- **Outcome**: one finding blocks production (C1, a reproduced escalation to `rw_resolve` through the new `rw.daily_jobs()`); five should be fixed; three are notes.
- **Advisory only**: this review gates nothing. I did not run `runward check --strict`; that verdict stays with the gate.

## Method

- Read the eight priority commits in full, with their callers, tests, `db/grants.sql` and `0001_floor.sql`. Docs, hooks and reports were read only where they change behaviour.
- Every suspected defect was reproduced with a throwaway script in a scratch clone, never committed.
- Runs were on the NAS through `verifier-sur-nas.sh`: Node.js v22.23.4, and a throwaway PostgreSQL 17.11 at the `ci.yml` digest.
- One targeted test ran on the Mac under **Node 24.22.1**: `node --test test/unit/operator-gateway.test.js`, because the NAS image has no `jq`.
- Baseline at this commit on the NAS:
  - `npm test`: 134 pass, 7 fail. The failures I opened are `container-deploy` and `operator-call.sh` cases that exit 127 without `jq`; the gateway file passes 9/9 on the Mac. The `container-deploy` cases were not rerun with `jq`.
  - `npm run test:pg`: 14/14.
  - `npm run lint`: exit 0.
  - `node scripts/check-workflows.mjs`: exit 0.
- Cleanup: the clone, the NAS copy and the PostgreSQL container are removed. The container's anonymous Docker volume may remain on the NAS, since I removed it without `-v`.

## Findings

### C1 — blocking — `db/migrations/0004_daily_jobs_outcome.sql:6` (and `:7`, `:12`)

`rw.daily_jobs()` is the first security definer function whose body names a non-keyword type (`'{}'::jsonb`). With `search_path = rw, pg_catalog`, PostgreSQL looks for types in `pg_temp` first, so the caller can shadow `jsonb`.

- **Failure scenario**: a session as `rw_app` creates `pg_temp.jsonb` as a domain whose CHECK calls its own function, then calls `rw.daily_jobs()`. The function runs as `rw_resolve`, which reads `tenant`, `session`, `passkey`, `link` and `forge_repository` across tenants, and writes `service_state`, `oidc_jti` and `rate_counter`.
- **Precondition**: SQL execution as `rw_app`. I found no injection path in the service, so this is a breach of the database boundary, not a remote exploit today.
- **Why blocking**: the branch introduces it. The 14 functions of `0001` name no non-keyword type in their bodies, and `0001_floor.sql:239` states "a caller cannot shadow a name". `0004` is still editable, since it is applied nowhere yet.
- **Reproduction** (NAS, PostgreSQL 17.11, two real tenants made through the application):
  ```
  rw_app by itself (no app.tenant): {"u":"rw_app","tenants":"0","sessions":"0"}
  control, no temp type: {} notices: 0
  with pg_temp.jsonb: {} notices: ["spy runs as current_user=rw_resolve (session_user=rw_app): tenants=2 sessions=2 first tenant=8dab28a3-…"]
  ```
  Statements run as `rw_app`: `create function pg_temp.spy(pg_catalog.jsonb) returns boolean …`, `create domain pg_temp.jsonb as pg_catalog.jsonb check (pg_temp.spy(value))`, `select rw.daily_jobs()`.
- **Suggested fix**: in `0004`, `set search_path = pg_catalog, rw, pg_temp` (or write `pg_catalog.jsonb`), with a `test/pg` case that plants the temp type. Then a follow-up migration doing the same `alter function … set search_path` on the 14 others, and `revoke temporary on database … from public`.

### C2 — should-fix — `src/http/server.js:218` and `:203`, `src/http/limits.js:28`

The instance-wide budgets added by `5ab1204` refuse valid callers too.

- **Failure scenario**: 600 requests a minute with junk cookies from 20 addresses spend the `signedOut` global budget. Every request carrying a cookie then gets 429 before its session is resolved, public routes included, for as long as the flood lasts. Likewise 1,200 junk `POST /api/v0/exports` a minute refuse every tenant's upload; `send.yml` gives up after four attempts in about 40 s.
- **Regression**: before this branch a valid session or token was never refused by someone else's traffic.
- **Reproduction** (NAS, real sockets, default `RATE_LIMITS`, `trustProxy: 1`):
  ```
  valid session before: 200
  after 600 junk cookies from 20 addresses: valid session answers 429 too-many-requests retry-after 50
  the same valid cookie on a public route: 429
  after 1200 junk uploads from 20 addresses: an upload from a new address answers 429 too-many-requests
  ```
- **Suggested fix**: let the global scope refuse only what failed. Keep per-address `peek` for cookies, and exempt cookies that resolved recently (a short in-process cache of valid token hashes).

### C3 — should-fix — `scripts/migrate.mjs:39`

The lexer reads a continued escape string as a standard string, so a DROP after it is hidden from the guard. PostgreSQL keeps reading with backslash escapes when a string continues after a newline.

- **Failure scenario**: a migration containing `select E'a'⏎'\' ' ; drop table public.victim; select '';` passes `contracting()` and `planMigrations()`, and PostgreSQL drops the table. Same class as the two cases `9408cad` closed.
- **Reach**: it needs deliberately crafted SQL in a merged migration.
- **Reproduction** (NAS):
  ```
  statements(): ["select E''\n'' ''"] contracting(): null
  control, same drop in plain sight: drop: drop table public.victim
  planMigrations accepts it as 0005: [ '0005_hidden.sql' ]
  P1 … executed as migrate() executes a file (rw_owner, one transaction, unsafe)
  before: victim
  after : null
  ```
- **Suggested fix**: after a closing quote, if only whitespace containing a newline precedes the next `'`, continue in the same mode. Simpler: refuse any file where a literal is followed by whitespace-with-newline and a quote.

### C4 — should-fix — `db/migrations/0004_daily_jobs_outcome.sql:9-16`, `src/main.js:95-103`

`rw.daily_jobs()` evaluates the `ok` sub-plan on every retained row of both jobs, not on the two rows it keeps, and `/api/health` calls it on every request.

- **Failure scenario**: the cost grows with days × tenants on a public, uncached route that shares a pool of 4 connections. Past 10 s the statement times out, `dailyJobs` becomes `null`, and C6 makes the alert silent.
- **Reproduction** (NAS, 365 days of both jobs, called as `rw_app`, PostgreSQL capped at 1.5 CPU):

  | Tenants per report | Time per call |
  |---|---|
  | 10 | 7 to 8 ms |
  | 100 | 231 to 263 ms |
  | 1,000 | 1,409 to 1,606 ms |

  The plan shows `SubPlan 1 … Function Scan on jsonb_array_elements (loops=730)` under `Seq Scan on operator_journal`.
- **Suggested fix**: pick the last row per job first (`order by seq desc limit 1` per job, with an index on `(what, seq desc)`) and compute `ok` on those two rows. Or cache `dailyJobs` in the service for 60 s.

### C5 — should-fix — `src/adapters/oidc/github.js:75` (through `src/application/ingest.js:26-29`)

A token whose header decodes to JSON `null` throws a `TypeError` with no code, which the upload answers 503 `service-unavailable` and logs as `oidc.keys-unavailable`.

- **Failure scenario**: any unauthenticated caller sends `Bearer bnVsbA.bnVsbA.x`. The 503s enter the error window, and on a quiet service 20 of them fail the hourly probe; two probes in a row open the "service unavailable" issue.
- **Scope**: the line predates the branch, but `eef9156` states that only an unreadable key set is the service's failure.
- **Reproduction** (NAS, real sockets):
  ```
  25 junk tokens answered: { '503 service-unavailable': 25 }
  control (header {}): 401 token-unreadable
  health.errors: {"windowSeconds":300,"requests":26,"serverErrors":25,"rate":0.9615}
  probe verdict: {"ok":false,"reasons":["error rate 96.2 % over the last 5 minutes (25 of 26)"]}
  ```
- **Suggested fix**: refuse `token-unreadable` unless header and claims are non-null objects. In `verifyToken`, map only `KeysUnavailable` to 503.

### C6 — should-fix — `scripts/probe-verdict.mjs:21`, `src/main.js:99`

The daily-jobs alert fails open: when `rw.daily_jobs()` cannot be read, `/api/health` says `dailyJobs: null` with `db: ok`, and the probe reads `null` as nothing to report.

- **Failure scenario**: grants not applied, function missing after a partial deploy, or the statement timeout of C4. The alert this branch adds then stays silent for good. A job that never ran since deployment is also silent for good; that one is by design, but a mis-wired schedule is never noticed.
- **Reproduction** (NAS):
  ```
  dailyJobs null: {"ok":true,"reasons":[]}
  never ran: {"ok":true,"reasons":[]}
  ```
- **Suggested fix**: when `health.db === "ok"` and `dailyJobs` is `null`, push a reason. Consider alerting on `lastRun: null` once the deployment is older than a day.

### C7 — note — `src/http/server.js:218-220`

The `signedOut` budget is checked with `peek`, then awaited, then counted, so concurrent requests all pass before any is counted.

- **Failure scenario**: a burst of junk cookies from one address reads the database more often than the budget of 30 allows; the excess is bounded only by concurrency.
- **Reproduction** (NAS, real sockets, a store answering in 20 ms, 200 junk cookies from one address):
  ```
  sequential (control): statuses {"401":30,"429":170}; store transactions for these cookies: 30
  concurrent: statuses {"401":66,"429":134}; store transactions for these cookies: 66
  ```
- **Suggested fix**: `take` before the await and give the unit back when the session resolves, or count in-flight lookups per address.

### C8 — note — `src/adapters/system/log.js:27-30`

`scrub()` runs its patterns on the whole string before cutting it, and one of them is quadratic on a long run without `@`.

- **Failure scenario**: none today. Every current caller slices to 300 characters or less before logging; the largest I found is an 8 KB JSON key at the gateway, behind the operator token. A future caller passing a large string would block the event loop, although the header says the bound holds "whoever the caller".
- **Reproduction** (NAS, `scrub("a".repeat(n))`): n=20,000 takes 524 ms; n=50,000 takes 3,284 ms; n=100,000 takes 13,280 ms.
- **Suggested fix**: cut the input to a few times `max` before applying the patterns.

### C9 — note — `scripts/migrate.mjs:64`

The type-change pattern uses ASCII `\w+` for the column name, so a non-ASCII unquoted column is not caught. The pattern predates the branch, and the schema has only ASCII names.

- **Reproduction** (NAS):
  ```
  "alter table public.victim alter column café type integer using 1;" contracting(): null | control ascii: type change: …
  ```
- **Suggested fix**: match the name with the lexer's `identChar` class.

## Checked with no finding

- **OIDC key cache (`eef9156`)**: read in full, and `test/unit/oidc.test.js` passes on the NAS. The single in-flight read, the 5 s retry floor, the minute counted only from a usable read and wholesale key replacement all hold. An unknown key id cannot force more than one read a minute, and `KeysUnavailable` carries no code, so it maps to 503.
- **Migration lexer, other shapes (`9408cad`)**: reasoned against PostgreSQL's scanner for `E` after an identifier character, `U&''`, typed literals, `""` in identifiers, dollar tags (non-ASCII included) and nested comments. Dollar bodies stay raw, so they can only over-refuse. The whole-file refusal on `standard_conforming_strings` and `backslash_quote` holds.
- **Order in `server.js` (`5ab1204`)**: host check, then rate limits, then same-origin, then session, then maintenance, then body. Machine routes are counted before any token work, and with `RW_TRUST_PROXY = "1"` (`infra/scaleway/main.tf:196`) the client cannot choose the counted `X-Forwarded-For` entry.
- **Egress composition test and `send.yml` (`3d257bc`)**: the test now goes through the verifier and the S3 port. The 10 s deadline on the token request is caught by the retry loop, and 429 and 5xx are retried with a fresh token each time. `check-workflows.mjs` exits 0.
- **What leaves the gateway (`6309a9a`, `6704a60`)**: every answer is `{gesture, ok, exit}` or `{error: <code>}`. The child prints a status only, and `incompleteReason` names no tenant. `operator-call.sh` prints closed fields even from an older gateway that answers more; 9/9 on the Mac with `jq`.
- **Migration `0004`, apart from C1 and C4**:
  - Every relation is schema-qualified, and `rw_app` cannot create in `rw`.
  - Ownership goes to `rw_resolve`, execute is revoked from public and granted to `rw_app` only; `rw_app` has no direct right on `operator_journal`.
  - The output holds `at` and `ok` only; the pg test confirms no tenant id, error text or head reaches `rw_app`.
  - The memory and PostgreSQL adapters agree on `ok`.
- **`statement_timeout`**: the pg test confirms `10s` on the store's connections against a control of `0`.
- **`probe.yml`**: the verdict reaches the shell through `env`, never interpolated into the script.
- **Log bounding (`28aecdf`)**: the field allow-list, key dropping, depth, item and size bounds hold; `test/unit/observability.test.js` passes. No current caller uses a detail key that the secret filter would drop by mistake.
- **Pre-commit hook (`8643c44`)**: `prepare` is a no-op under `npm ci --ignore-scripts`, which is what CI and the Dockerfile use. No runtime behaviour changes.

```json
{"commit":"0d94dc28781e880aa63d056d14b2039488c11791","blocking":["C1"],"should_fix":["C2","C3","C4","C5","C6"],"notes":["C7","C8","C9"]}
```
