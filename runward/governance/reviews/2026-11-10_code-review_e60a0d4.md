# Adversarial code review: runward-hosted PR #5, `fix/h0-gate`, corrected commit

Reviewer: a second AI agent (Claude Fable 5.2, read-only reviewer agent) that wrote none of this code. Thibault Souris, the author, is accountable for it.

- **Commit**: `e60a0d48135a22f168b1ae4c40c7d603ed15e56c`, diff `0d94dc2..e60a0d4`.
- **Outcome**: nothing blocks production. C1 to C9 are closed and each closure was reproduced. Two new findings should be fixed (C10, C11) and two are notes (C12, C13).
- **Advisory only**: this review gates nothing. I did not run `runward check --strict`; that verdict stays with the gate.

## Method

- Read the diff in full for code, migrations, scripts and workflows, plus the merge `b73f8a4` and its combined diff on `src/operator.js`. Docs were read only where they state a procedure (runbook §3 and §16, threat row T24).
- Everything ran on the NAS in the repository's own reference environment (`scripts/reference-env.sh`): Node.js v22.23.4, jq 1.7.1, a throwaway PostgreSQL 17.11. Nothing was run on the Mac.
- Baseline at this commit, clean tree: `npm test` 191/191; `npm run test:pg` 20/20; `npm run lint` exit 0; `node scripts/check-workflows.mjs` exit 0; `npm run test:reports` exit 0.
- The round-one reproductions were rerun against the new code, then new attacks were tried with a throwaway script, never committed.
- Eight planted controls checked that the new tests fail on the old behaviour.
- Cleanup: the clone and the NAS copy are removed; no review container is left.

## Round-one findings: status

| Id | Status | Evidence on `e60a0d4` |
|---|---|---|
| C1 | closed | All 15 definer functions read `search_path=pg_catalog, rw, pg_temp`. Eleven of them, called as `rw_app` with planted `pg_temp` domains and tables, raised 0 notices. `roles()` returns `{"temporaryRevoked":true}`, `rw_app` gets `permission denied to create temporary tables`, and `migrate` still runs after it. |
| C2 | closed for the reproduced case; residual in C11 | After 600 junk cookies from 20 addresses, a valid session from another address answers 200. After 1,200 junk uploads, an upload from a new address has its token read (401). |
| C3 | closed | The round-one text and five variants now return `drop: drop table public.victim`: continued after a `--` comment, after a comment line, `a$b$`, `e` after a quoted name, `U&''`. |
| C4 | closed | 365 days × 1,000 tenants: 7 to 9 ms a call as `rw_app` (34 ms cold), against 1,409 to 1,606 ms before. |
| C5 | closed | 25 tokens with a `null` header answer `401 token-unreadable`; `health.errors` shows 0 server errors. `GET //`, `//host/…`, `/\\host/` and an absolute target answer 404. |
| C6 | closed | `dailyJobs: null` with `db: ok` gives `ok:false` with a reason. |
| C7 | closed | 200 junk cookies at once from one address, store at 20 ms: 30 answer 401, 170 answer 429, 30 store transactions. |
| C8 | closed | `scrub()` on 100,000 characters: 4 ms. |
| C9 | closed | `alter column café type …` is refused as a type change. |

## New findings

### C10 — should-fix — `db/migrations/0001_floor.sql:234-235`, `src/application/identity.js` (`refuseInMaintenance`), `runward/runbook.md` §3

The sign-in refusal under maintenance (`57662bb`) does not cover the window it was written for, because the maintenance flag is a row of the database being restored.

- **Failure scenario**: the operator sets maintenance on, restores the day's backup, and the flag reverts to the backup's value (off). Until `restore-replay` runs, a passkey removed after the backup signs in and a link redeemed after it opens again. A session closed after the backup, an intruder's closed by `reset-access` included, is open again and reads tenant data; maintenance never refuses reads.
- **Procedure gap**: runbook §3, the production procedure, says anchor, restore, replay. It does not say to stop the service. Only the drill (§16 step 9) stops it.
- **Not verified**: whether the hoster's restore forces the service down.
- **Reproduction** (NAS, memory store, restore emulated as the unit tests do, with the maintenance row included): `under maintenance: maintenance | after the database is replaced by the backup: sign-in open`.
- **Suggested fix**: in §3, keep the service stopped (scale to zero) from before the restore until the replay has answered 200, as §16 does. Or hold the flag outside the restored database (an environment variable of the container).

### C11 — should-fix — `src/http/limits.js:70` and `:76` (`failureLimiter`, `keyOf` and the per-address check)

The C2 lockout remains through the bounded address table. Past 10,000 addresses in a window, every unseen address shares the `(overflow)` counter, and that counter is spent after 30 failures.

- **Failure scenario**: 10,030 junk cookies a minute, one per address (about 170 requests a second). A valid session from any address not yet in the table is then refused 429, unless its cookie resolved in the last 60 s. The same holds for uploads after 10,060 junk calls; `send.yml` gives up after four attempts.
- **Cost to the attacker**: 10,000 distinct source addresses a minute instead of 20. That is trivial from one IPv6 /64 if the hoster forwards IPv6 client addresses, which I could not check; otherwise it needs a botnet.
- **Reproduction** (NAS, real sockets, default limits, `trustProxy: 1`): `flood sent in 7659 ms; a valid session from an address not seen in this window answers 429 too-many-requests`; `machine route, 10,060 addresses one junk upload each: an upload from a new address answers 429 too-many-requests`.
- **Suggested fix**: for the two failure budgets, do not fold unseen addresses into one spent counter; serve them at the cost of one lookup, or evict. Key IPv6 addresses by their /64.

### C12 — note — `src/application/operator.js:147-151` (`restoredHead`) and `:160-168` (`anchoredHead`)

The `restore-replayed` note misstates the lost range when the gesture is run again with a different `since`. The first run's note is then counted as part of the restored journal.

- **Failure scenario**: the operator reruns with an earlier `since` because the first one missed gestures. The second note, permanent in each tenant's chained journal, says fewer entries were lost, or an open range, although the anchor is present. The first note is correct.
- **Related, not reproduced (hypothesis)**: a second restore from the same backup after a new anchor would make the latest anchor describe the post-replay journal and understate the original loss.
- **Reproduction** (NAS, memory store): backup head seq 2, 3 entries lost (seq 3..5): first note `{"from":3,"to":5,"count":3}`, second note `{"from":4,"to":5,"count":2}`; backup head seq 2, 1 entry lost (seq 3..3): first note `{"from":3,"to":3,"count":1}`, second note `{"from":4,"to":null,"count":null}`.
- **Suggested fix**: take the restored head as the entry before the first `restore-replayed` of any `since` that follows the last anchor, and carry the earlier note's range forward.

### C13 — note — `scripts/migrate.mjs` (`CONTRACTING`)

The guard is lexical, so a contraction assembled at run time inside a dollar-quoted body passes. This predates the branch and is a limit of the approach; the header's "a contracting word in it … is refused" overstates it.

- **Reproduction** (NAS): `do $$ begin execute 'dr' || 'op table public.victim'; end $$;` gives `contracting() = null`.
- **Suggested fix**: refuse `execute` inside a migration's bodies, or say in the header that dynamic SQL is out of the guard's reach.

## Planted controls

Each control reverts one fix in a throwaway copy, runs the test file, and restores the tree.

| Control | Mutation | Tests that went red |
|---|---|---|
| K1 | no reservation while the session is read (`limits.js`) | "a burst of dead cookies sent at once…" |
| K2 | the instance budget refuses everyone | "the budget of failures…", "the instance's budgets refuse only what failed…" |
| K3 | `0004` with the old `search_path`, one cast unqualified | the catalog test and the schema snapshot; the behavioural test stayed green |
| K3b | same, both casts unqualified | those two plus the behavioural test (`spy runs as rw_resolve (session rw_app)`) |
| K4 | no continuation of a literal (`migrate.mjs`) | "an escape string continued after a newline…" |
| K5 | `access-reset` not replayed | unit: the access-reset case and "every kind the security log receives…"; PostgreSQL: the §16 drill case |
| K6 | no sign-in refusal under maintenance | "under maintenance no one signs in…" |
| K7 | no object check on the token header | "a token whose header or claims are not a JSON object…" |

K3 shows the behavioural test exercises only the `else '[]'` cast. A regression on the `coalesce` cast alone would be caught by the catalog test, not by behaviour. That is acceptable as two nets, and worth knowing.

## Checked with no finding

- **`search_path` and `revoke temporary`**: covered in the status table. `isolation-deployed.mjs` checks the same setting on a deployed base. The revoke is attempted and its result reported, never assumed.
- **`0004` edited in place**: safe only because it is applied nowhere real. Any rehearsal database that ran the old file will refuse it as "changed after it was applied".
- **Failure budgets**: every path settles its entry (session found, not found, or the read threw). A cookie that resolved recently skips the budget but never the session read, and the PostgreSQL-free tests confirm a session closed a moment ago is refused at once.
- **Lexer**: words are read whole, so `$` inside a name opens nothing. A `$` glued to a number refuses the file. Continuation follows the server's rule (white space with a newline, `--` comments included); block comments do not continue a literal, as on the server.
- **`restore-replay` inputs**: the gateway accepts `anchor` (boolean), `since` (ULID) and `recoveryHash` (64 hex) only. `--anchor` with any other argument is refused, and `--head-before` is refused with its reason.
- **`restore-replay` isolation and atomicity**: each tenant's events come from its own prefix and act through its own transaction under RLS; every log is read before the first write, and an unreadable one refuses the gesture whole; a failed tenant is rolled back and recorded while the next ones run; the PostgreSQL test passes under `rw_maint`.
- **`restore-replay` replay rules**: idempotent on a gesture inside the backup's margin (the "reset inside the margin" case passes). Erasure replay skips uploads received after the erasure.
- **Merge `b73f8a4`**: the resolution in `src/operator.js` joins the job note and the restore arguments without dropping either. `restore-replay` is not a scheduled gesture, so it gets no job note.
- **Job note and schedule**: the note is written on deadline, on exit without a status line, and on busy. Deadline (14 min), kill grace (5 s) and note (30 s) fit under the hoster's 900 s; `verify-chains` now starts 30 minutes after retention.
- **Secrets out of argv**: `operator-call.sh`, `container-deploy.sh` and `deploy.yml` pass headers through `-H @<(printf …)`. The guard in `check-workflows.mjs` exits 0, and its tests pass now that jq is present.
- **Object store health**: the witness is written then read back, single-flight, cached 30 s (5 s on failure). The bucket has no versioning (`infra/scaleway/main.tf:223`), so the repeated write does not accumulate versions. Not run against a real S3.
- **`operator-link.mjs`**: arguments go through the gateway's own `argvOf` before printing, and a quote in an argument refuses the print.
- **Not run**: `scripts/on-nas.sh`, and the §16 drill end to end.

```json
{"commit":"e60a0d48135a22f168b1ae4c40c7d603ed15e56c","blocking":[],"should_fix":["C10","C11"],"notes":["C12","C13"]}
```

*Follow-up, by the integrating session*: C10 is answered in runbook §3 and T24 (the service stays stopped between the restore and the replay). C11, C12 and C13 go to a follow-up pull request before the first release.
