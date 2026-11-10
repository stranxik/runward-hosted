# Redone task: runbook §13, a deploy's first gestures on a throwaway stack

- **Date**: 2026-11-10 (steps ran from 12:52:02Z to 12:53:50Z)
- **Doer**: an agent session (Claude Fable 5.2) that did not build this repository
- **Commit**: `0d94dc28781e880aa63d056d14b2039488c11791` (branch `fix/h0-gate`, PR #5), cloned from the public repository into a new folder
- **Where**: the author's home server (Docker). The twelve steps ran in one bash shell inside a throwaway `node:22` container (capped at 3.5 cores), joined by a dedicated Docker network to a throwaway `postgres:17-alpine` container (`POSTGRES_HOST_AUTH_METHOD=trust`, no published port)
- **Versions**: Node.js v22.23.4, PostgreSQL 17.11 (image digest `sha256:3540c0362c80…`), bash 5.2.15, jq 1.6, OpenSSL 3.0.22, curl from the `node:22` image
- **Rules followed**: everything from §13; no `git log`, `blame` or `diff` (only `clone`, `checkout`, `rev-parse`); no file of another session read

## Duration

| Part | Time |
|---|---|
| Steps 1 to 10 and 12, commands only | 8.7 s (7.99 s in the shell, 0.75 s for `docker stop`) |
| Step 11, reading the ADRs | 99.2 s |
| **Steps 1 to 12** | **108 s** |
| Prerequisites inside the container (`apt-get install jq`, `npm ci`) | 14.2 s |
| Clone, network, PostgreSQL image pull and start | 9 s |
| Wall clock, from reading §13 to the cleanup verified | about 5 min |

The steps were run once. Every command of steps 1 to 10 and 12 printed its expected line on that first run; nothing was retried or edited between runs.

## The twelve steps

"Verdict line" is the output as printed. Step commands were copied from §13 without change; the only value that differs is `PG` (see Deviations).

| # | Step | Verdict line, as printed | Matches "Verify"? | Time | Hesitations and guesses |
|---|---|---|---|---|---|
| 1 | Database and three login roles | `ok` six times | Yes | 0.90 s | None |
| 2 | Operator token and witness ids | `64 36` | Yes | 0.16 s | The `echo ${#TH} ${#W1}` is in the Verify line, not in the code block; I added it to the shell. The token was never printed |
| 3 | The operator's gateway | `{"ok":true}` | Yes | 1.03 s | None |
| 4 | `roles`, `migrate`, then a wrong token | `operator-call: roles answered HTTP 200 (gesture=roles ok=true exit=0)` / `operator-call: migrate answered HTTP 200 (gesture=migrate ok=true exit=0)` / `operator-call: migrate answered HTTP 401 (error=refused)` / `exit 1` | Yes | 0.98 s | None |
| 5 | The service on PostgreSQL | `{"event":"start","detail":{"store":"postgres","objects":"memory"}}` | Yes | 1.06 s | None |
| 6 | Observe | `{"ok":true,"store":"postgres","db":"ok","dailyJobs":{"retention":{"lastRun":null,"ok":null},"verify-chains":{"lastRun":null,"ok":null}}}` / `{"commit":"rehearsal","indexFormat":"runward-fleet-index/0","fleet":"0.46.0"}` | Yes | 0.16 s | None |
| 7 | The two witness tenants | `operator-call: open-bootstrap answered HTTP 200 (gesture=open-bootstrap ok=true exit=0)` twice, nothing else | Yes | 2.15 s | The Verify line abbreviates the printed line (it omits `operator-call: open-bootstrap answered`); read as the same line |
| 8 | The isolation suite | `operator-call: isolation answered HTTP 200 (gesture=isolation ok=true exit=0)` | Yes | 0.41 s | Same abbreviation. The line says the suite exited 0, not what it ran (see Gaps, 3) |
| 9 | The daily chain check by the schedule's path | `{"gesture":"verify-chains","ok":true,"exit":0}` / `{"lastRun":"2026-11-10T12:52:10.430Z","ok":true}` | Yes | 1.00 s | None |
| 10 | Trace one request by its id | `r-ff44aba48785` / `1` / `{"status":401,"refusal":"token-missing"}` | Yes | 0.12 s | None |
| 11 | A decision, from the ADRs alone | My answer: ADR-0016. Section Decision, "The schedule": a trigger cannot hold a secret except in clear in its configuration, so the two `/scheduled/` paths take no token and no argument and run only the two idempotent gestures (retention, verify-chains); every other path needs the token. Section Alternatives discarded gives the comparison (the token in the trigger's headers would be readable configuration). Section What would settle it, "Reverses": a trigger that cannot reach a private container's path (the schedule then moves to a CI cron that calls the gateway with the token), or the hoster forwarding a trigger without being able to authenticate it (the token then goes in a header from a sensitive variable and the ADR is superseded) | Yes, same record and sections | 99.2 s | **Not found blind.** I had read the whole of §13, Verify line of step 11 included, before starting, so I knew the expected record. The search itself was short (`grep -l scheduled` in `runward/adr/` returns ADR-0010 and ADR-0016; the passage is in ADR-0016), but this run does not prove that a doer finds it unaided (see Gaps, 1) |
| 12 | Stop everything | `000`; `rm -r "$R"` exit 0; `docker stop rw-rehearsal` printed `rw-rehearsal` | Yes | 0.77 s | None |

Result: 12 of 12 verdict lines match their "Verify" line. Step 11 matches, with the reservation stated in its row.

## Deviations from §13 as written

These are differences of my environment, not corrections the runbook needs.

- `PG=rw-rehearsal:5432` (the PostgreSQL container's name on a private Docker network) instead of `127.0.0.1:55432`, because the steps ran inside a container. The PostgreSQL container was started as in the §13 example, minus `-p`, plus `--network`.
- `jq` is not in the `node:22` image; it was installed inside the throwaway container (`apt-get install jq`). `npm ci` was run there too.
- Step 11 was done from another terminal on the same checkout while the shell of steps 1 to 10 waited with both processes still running; step 12 then ran in that same shell.
- One false start before step 1: the first `node:22` container could not write to the mounted folder (SELinux on the host, the mount needed `:Z`). It exited before any step ran; it was removed and started again with the label.
- Outside §13, before step 12, the shell counted the occurrences of the operator token in `gateway.log`, `service.log` and the run's own output: 0, 0 and 0.

## What I opened besides §13

- `runward/handover.md` (§2), because my brief asked for it: it gives the shape of this record. §13 alone says what to note (verdict line, time, guesses) and that the record goes to `handover.md` §2.
- `runward/adr/`, as step 11 requires.
- The last four lines of `gateway.log`, out of curiosity after step 10; no step required it.
- Not opened: `scripts/operator-call.sh`, `src/`, `db/`, any other section of the runbook.

## Gaps

1. **Step 11 gives its answer away.** The Verify line names the record and both sections two lines under the question, so anyone who reads the step before answering has the answer. Proposed correction (runbook §13, step 11): replace the Verify line by "Verify: compare with the expected answer in `runward/handover.md` §2, after writing yours", and move the expected answer there.
2. **Step 2's check is not in its code block.** `echo ${#TH} ${#W1}` exists only in the Verify sentence. Proposed correction (runbook §13, step 2): add `echo ${#TH} ${#W1}` as the last line of the block.
3. **Step 8's verdict does not say what was exercised.** `ok=true exit=0` came back in 0.41 s (the gateway's log says 330 ms, role `rw_app`); from the runbook alone I cannot tell how many isolation checks ran, and I did not verify it. Proposed correction (runbook §13, step 8): add to Verify a second reading that shows the suite's size, or state the expected duration and the `operator.gesture` log line to read (`role: rw_app`).
4. **Abbreviated verdict lines in steps 7 and 8.** Verify quotes `HTTP 200 (gesture=… ok=true exit=0)` while the printed line starts with `operator-call: <gesture> answered`; step 4 quotes it in full. Proposed correction (runbook §13, steps 7 and 8): quote the full line, as step 4 does.
5. **Running the steps inside a container is not covered.** The prerequisites give a host example only (`-p 127.0.0.1:55432:5432`, `PG=127.0.0.1:55432`). Proposed correction (runbook §13, prerequisites): one sentence, "if the steps themselves run in a container, put both on one Docker network and set `PG=<container name>:5432`; `jq` is not in the `node:22` image".
6. **Where the record goes is said in two ways.** §13 says the record goes to `runward/handover.md` §2; `handover.md` §2 says it is committed as its own file under `runward/` with a pointer from §2. Proposed correction (runbook §13, introduction): "the record is committed as `runward/redone-task.md` and pointed to from `runward/handover.md` §2".

No step required a guess about a command, a value or an expected output.

## Cleanup

Done and checked on 2026-11-10 at 13:54 (Paris time):

- Both processes stopped by step 12 (`000`), the run's temporary directory removed (`rm -r "$R"`, exit 0); it lived inside the throwaway container.
- Containers `rw-rehearsal` (PostgreSQL, `--rm`, stopped) and `rw-rehearsal-node` removed; network `rw-rehearsal-net` removed. `docker ps -a` and `docker network ls`, filtered on these names: 0 and 0.
- The checkout folder removed; `ls` on it answers "No such file or directory".
- Left in place: the `postgres:17-alpine` image, which this run pulled. Its removal was refused because a container that is not mine had started from it in the meantime; I did not force it.
- No other container, network or folder of the server was touched. The operator token was drawn inside the container, never printed, written nowhere, and is gone with it.
