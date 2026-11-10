# Redone task: runbook §13 and §16, by a session that did not build this repository

**Date**: 2026-11-10 (runs between 15:52 and 16:03 CET, 14:52 to 15:03 UTC)
**Executor**: an agent session (Claude Fable 5.2) that did not build this repository
**Commit**: `79544c78e81e1e696659b69de1e0089e19f809ca` (branch `fix/h0-gate`, PR #5), fetched by its full SHA (`git fetch --depth 1`), `git rev-parse HEAD` checked in each container
**Source of the procedures**: `runward/runbook.md` §13 and §16 at that commit, and what they cite. No git history, no earlier record (`runward/redone-task.md` was not opened), no file of the building session.

## Environment

- The author's home server (Docker): Linux x86_64, kernel 6.17, SELinux enforcing, Docker 29.0.4, 4 cores shared with other workloads (load average between 2.4 and 7.2 during the runs). No sudo, no change to the system, no container other than mine touched.
- Steps run inside a `node:22` container (Node.js v22.23.4, bash 5.2.15, curl 7.88.1, OpenSSL 3.0.22, jq 1.6 installed with apt as the runbook says). The digest of the `node:22` tag was not recorded.
- PostgreSQL: `postgres@sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac` (reports 17.11), trust authentication, no published port.
- S3 (§16 only): `chrislusf/seaweedfs@sha256:bb05d66d2963b1cc48073190781c3dd29e2c4c88a2ae2986bf58e38c86d89c6e`, `server -s3 -dir=/data`.
- §16 client tools: `psql`, `pg_dump`, `pg_restore` 17.11 (pgdg), installed with the runbook's one-line command, which worked as written.
- Names, all mine: networks `rwredo2-net`, `rwredo2-drill-net`; containers `rwredo2-pg13`, `rwredo2-node13`, `rwredo2-drill-pg`, `rwredo2-drill-s3`, `rwredo2-drill-node`; volumes `rwredo2-work13`, `rwredo2-drill-work`.
- How the steps were run: each section as one bash script in one bash shell inside the node container, from the repository's root. For §16 the script is the runbook's seventeen code blocks extracted mechanically from the file, with an `echo "=== step n"` before each. For §13 the commands were copied by hand between the same markers, plus a timing line after each step (the section has no `lap`). No token, key or link drawn for the runs was printed or written anywhere outside the run's throwaway directory, which each run removed.

## Summary

| Section | Runs | Result |
|---|---|---|
| §13 (12 steps) | 2 | Run 2: 12 of 12 conform. Run 1: steps 1 to 10 conform, step 12's output lost by an error of mine (see Deviation E1), so run 1 is not counted as complete. |
| §16 (17 steps) | 2 | Run 2: 17 of 17 conform. Run 1: 16 of 17 conform; **step 4 printed neither of its two Verify lines** (see Gap G1). |

Nothing in either section had to be repaired to get through, and no file of the repository was modified.

## §13: a rehearsal of a deploy's first gestures

Setup (network, PostgreSQL, node container, jq, fetch of the commit, `npm ci`): 20 s on run 2 (images already present). The table is run 2, the complete one. Run 1's steps 1 to 10 printed the same verdict lines (other request id and time), in 117 to 1684 ms per step.

| Step | Verdict lines printed | Conforms to Verify | Duration | Hesitations |
|---|---|---|---|---|
| 1 | `ok` six times | yes | 1268 ms | Verify says "each call prints `ok`"; six calls counted from the block |
| 2 | `64 36` | yes | 171 ms | none |
| 3 | `{"ok":true}` | yes | 1037 ms | none |
| 4 | `operator-call: roles answered HTTP 200 (gesture=roles ok=true exit=0)`; `operator-call: migrate answered HTTP 200 (gesture=migrate ok=true exit=0)`; `operator-call: migrate answered HTTP 401 (error=refused)`; `exit 1` | yes | 979 ms | none |
| 5 | `{"event":"start","detail":{"store":"postgres","objects":"memory"}}` | yes | 1060 ms | none |
| 6 | `{"ok":true,"store":"postgres","db":"ok","dailyJobs":{"retention":{"lastRun":null,"ok":null},"verify-chains":{"lastRun":null,"ok":null}}}`; `{"commit":"rehearsal","indexFormat":"runward-fleet-index/0","fleet":"0.46.0"}` | yes | 226 ms | none |
| 7 | `operator-call: open-bootstrap answered HTTP 200 (gesture=open-bootstrap ok=true exit=0)` twice, nothing else | yes | 2202 ms | none |
| 8 | `operator-call: isolation answered HTTP 200 (gesture=isolation ok=true exit=0)`; `{"status":200,"role":"rw_app","exit":0}` | yes | 731 ms | none |
| 9 | `{"gesture":"verify-chains","ok":true,"exit":0}`; `{"lastRun":"2026-11-10T14:57:23.918Z","ok":true}` | yes | 1045 ms | none |
| 10 | `r-435ee8f0f8d3`; `1`; `{"status":401,"refusal":"token-missing"}` | yes | 213 ms | none |
| 11 | a written answer, below | to be checked by the reviewer | about 2 min of reading, not instrumented | which two sections to name (see the answer) |
| 12 | `000` | yes | 69 ms | the removal of `$R` has no printed check; I added `ls "$R" 2>/dev/null \| wc -l`, which printed `0`, and `pgrep` found no `node src/` process left |

### Step 11: the answer, from `runward/adr/` alone

**What I read before answering**: the listing of `runward/adr/` (19 files); a search of that directory for `scheduled` (two records: ADR-0010, ADR-0016) and for `verify-chains` (ADR-0007, ADR-0016); ADR-0016 in full; the one matching line of ADR-0010 (it says only that the daily jobs "are scheduled at the hoster"). Nothing outside `runward/adr/`, and nothing of the runbook beyond §13 and §16.

**The record**: ADR-0016, "The operator's gestures reach the private database through a private gateway container, one role per gesture".

**Why the schedule may call `/scheduled/verify-chains` without the operator's token** (section *Decision*, item "The schedule"):

> "a trigger cannot hold a secret except in clear in its configuration, so these two paths take no token and no argument, and run only those two idempotent gestures; every other path needs the token."

**What observation would reverse it** (section *What would settle it*, item "Reverses"):

> "a trigger that cannot reach a private container's path (then the schedule moves to a CI cron calling the gateway with the token), or the hoster forwarding a trigger without being able to authenticate it (then the token goes in a header from a sensitive variable and this ADR is superseded)."

In my words: the hoster's trigger stores its headers as plain configuration, so a token placed there would be readable; the two scheduled paths are therefore left without token, accept no argument and run only two idempotent gestures, behind the hoster's own barrier (the container is private). Two observations reverse it: the trigger cannot reach the private container's path, or the hoster forwards a trigger call it cannot authenticate.

Hesitation: the same reason is stated a second time in *Alternatives discarded* ("The operator's token in the triggers' headers: the headers are plain configuration of the trigger, readable by anyone who reads the container, and plain in the state; two argument-free idempotent gestures are a smaller exposure than a token that opens the bootstrap"), and *Consequences* names the exposure accepted ("the schedule's two paths are reachable without the operator's token by whoever passes the hoster's barrier"). The step asks for two sections; I chose *Decision* and *What would settle it*.

## §16: a restore drill

Setup (network, PostgreSQL, SeaweedFS, node container in the S3's network namespace, jq and PostgreSQL 17 client, fetch of the commit, `npm ci`): 54 s on run 1, including the pull of the SeaweedFS image. Each run on a fresh PostgreSQL, a fresh SeaweedFS and a fresh node container. Durations are the runbook's own `lap` lines.

| Step | Verdict lines printed (identical in both runs unless said) | Conforms, run 1 | Conforms, run 2 | Duration run 1 / run 2 |
|---|---|---|---|---|
| 1 | `client ok` | yes | yes | 112 / 145 ms |
| 2 | `bucket 200`; `3`; `64 36 43` | yes | yes | 1409 / 1127 ms |
| 3 | `{"ok":true}`; `operator-call: roles answered HTTP 200 (gesture=roles ok=true exit=0)`; the same line for `migrate` | yes | yes | 2117 / 1872 ms |
| 4 | run 1: **nothing printed**. Run 2: `{"event":"start","detail":{"store":"postgres","objects":"s3"}}`; `{"ok":true,"db":"ok","objectStore":"ok"}` | **no** | yes | 1404 / 1559 ms |
| 5 | `operator-call: open-bootstrap answered HTTP 200 (gesture=open-bootstrap ok=true exit=0)` three times | yes | yes | 3736 / 3896 ms |
| 6 | `200 200 200 200 200`; `200 200 200 200`; `36 36 36 36`; `drill-a\|3\|2\|7`, `drill-b\|2\|1\|4`, `drill-c\|1\|1\|2`; `member-founded passkey-added passkey-added consent-given`, `member-founded passkey-added`, `member-founded` | yes | yes | 8810 / 6369 ms |
| 7 | `26`; `1` | yes | yes | 2683 / 2607 ms |
| 8 | twelve `200`; three `200`; `operator-call: reset-access answered HTTP 200 (gesture=reset-access ok=true exit=0)`; `drill-a\|2\|2\|14`, `drill-b\|2\|0\|6`, `drill-c\|0\|0\|3`; `passkey-removed passkey-restored passkey-removed consent-withdrawn passkey-added passkey-removed`, `repository-removed`, `access-reset` | yes | yes | 11554 / 8990 ms |
| 9 | `operator-call: restore-replay answered HTTP 200 (gesture=restore-replay ok=true exit=0)`; `journal-anchored` three times; `heads unchanged`; `pg_restore exit 0`; `drill-a\|3\|2\|7`, `drill-b\|2\|1\|4`, `drill-c\|1\|1\|2`; `A3 removed: false` | yes | yes | 5100 / 3701 ms |
| 10 | `operator-call: restore-replay answered HTTP 200 (gesture=restore-replay ok=true exit=0)` | yes | yes | 1792 / 1070 ms |
| 11 | `0`; `drill-a\|8\|restore-replayed\|2\|4\|0`, `drill-b\|5\|restore-replayed\|1\|1\|0`, `drill-c\|3\|restore-replayed\|1\|1\|0`; `A2 removed: false`; `A3 removed: true`; `drill/alpha\|f\|f`; `drill/beta\|f\|t`; `restore-replayed\|3\|0`; `drill-a\|false\|[]`, `drill-b\|false\|[]`, `drill-c\|true\|[]` | yes | yes | 1045 / 543 ms |
| 12 | `drill-a: the note is seq 8; the entries 8 to 14 of before the loss are gone`, `drill-b: the note is seq 5; the entries 5 to 6 of before the loss are gone`, `drill-c: the note is seq 3; the entries 3 to 3 of before the loss are gone`; `drill-a\|8\|8\|14\|7\|7\|14`, `drill-b\|5\|5\|6\|2\|4\|6`, `drill-c\|3\|3\|3\|1\|2\|3`; `closed headAfterRestore headBefore lost replayed since stranded`; `each note carries the head of its own tenant`; `3` | yes | yes | 753 / 420 ms |
| 13 | `operator-call: verify-chains answered HTTP 200 (gesture=verify-chains ok=true exit=0)`; `0\|true 8, true 5, true 3` | yes | yes | 1624 / 809 ms |
| 14 | `[401,"signed-out"]` twice; `[401,"passkey-unknown"]` twice; `[200,true]` twice; `{"seq":8,"what":"restore-replayed","who":"operateur"}`; `{"name":"drill/alpha","consent":false}`; `[200,true]`; `{"name":"drill/beta","state":"removed"}` | yes | yes | 5851 / 3734 ms |
| 15 | `[401,"passkey-unknown"]`; `drill-c\|0\|0`; `operator-call: open-bootstrap answered HTTP 200 (gesture=open-bootstrap ok=true exit=0)`; `200`; `[401,"passkey-unknown"]`; `drill-c\|1\|1` | yes | yes | 3469 / 2133 ms |
| 16 | `operator-call: isolation answered HTTP 200 (gesture=isolation ok=true exit=0)`; `{"ok":true,"db":"ok","objectStore":"ok","verifyChains":true}` | yes | yes | 936 / 483 ms |
| 17 | `000`; `total: 52586 ms` (run 1), `total: 39584 ms` (run 2); `0` | yes | yes | not lapped by the runbook |

The restore itself (steps 9 and 10): 6.9 s on run 1, 4.8 s on run 2. No hesitation on any step's commands: every block ran as written. The branch of step 10 for a refused replay ("go to step 17") was not exercised, the replay having answered 200 both times. The defect named in step 15 (a `[200,true]` on its first or fourth line) did not appear in either run.

Run 2 carried one addition of mine, placed after step 4's `lap` so that it changes nothing the step prints: a loop that waits for `/api/health` to answer, then repeats step 4's two verification lines. It printed `harness: service answered within 40 ms after the end of step 4` and the two expected lines. That wait is counted in run 2's lap of step 5.

## Gaps and deviations, each with a proposed correction

**G1. §16 step 4 can print nothing (seen on run 1 of 2).** Both Verify lines were absent: `head -1 "$R/service.log" | jq` and `curl -s … | jq` printed nothing, no error either. Step 5 onward then passed, so the service did start. I did not establish the cause: step 17 had removed `$R` and its `service.log` before I looked. What I observed is consistent with a service not yet listening after the fixed `sleep 1` of `serve` (the host was loaded, and here the service also reaches the object store at start): `curl -s` is silent on a refused connection and `jq` prints nothing on an empty input. A reader following the Verify literally must stop at step 4 on such a run.
Proposed correction: in `serve`, replace `sleep 1` by a bounded wait on the service, as step 2 already does for the two servers, for example `for i in $(seq 50); do curl -s -o /dev/null http://127.0.0.1:8787/api/health && break; sleep 0.2; done`; the same for the gateway's `sleep 1` in §16 step 3 and in §13 steps 3 and 5, which carry the same fixed wait (they passed on all four runs here). And say in step 4's Verify that an empty output means "not started yet, run the two read lines again", not a defect.

**G2. §13 gives no commands for its container variant.** The prerequisites say to put the node container and the server on one Docker network, without `-p`, with `PG=rw-rehearsal:5432`, but write no `docker network create`, no `docker run` for the node container, no clone. I guessed them from §16's prerequisites: a dedicated network, a `node:22` container running `sleep infinity`, the repository fetched inside a named volume (so no `:Z` mount was needed and no folder was created on the host).
Proposed correction: write the three commands in §13 as §16 does.

**G3. §13's PostgreSQL image: a choice I had to make.** §13's example is `postgres:17-alpine`; my instructions asked for the digests of `ci.yml`. I used the digest written in §16's prerequisites and did not open `ci.yml`. So the claim "at the digests of `ci.yml`" rests on §16's text, not on my reading of the workflow.
Proposed correction: give §13 the same pinned digest as §16, or say that the tag is intended there.

**G4. §13 asks for each step's duration and gives no way to print it.** §16 has `lap`; §13 has none. I added a timing line after each step.
Proposed correction: define `lap` in §13's prerequisites and end each step with it.

**G5. §13 step 12 and the clean-up of the container variant.** The step prints a check for the stopped service (`000`) but none for `rm -r "$R"`, and the clean-up names only `docker stop rw-rehearsal`, which removes the server only if it was started with `--rm` as in the example; the node container, its volume and the network of the container variant are not mentioned.
Proposed correction: end step 12 with `ls "$R" 2>/dev/null | wc -l` (expects `0`) as §16 step 17 does, and list the removal of the node container, the volume and the network, with the two count commands of §16.

**G6. §13 step 11 interrupts "one bash shell".** It is a reading step between step 10 and step 12, which needs `$SV`, `$GW` and `$R` from the same shell. Interactively this is nothing; scripted, the shell has to be held open. My script waited for a file before step 12.
Proposed correction: none needed, or move the reading step after "Stop everything".

**G7. §16's clean-up does not mention the pulled image.** The SeaweedFS image was not on the host and was pulled by the prerequisites' command. The runbook's clean-up removes containers, volumes and network only. I removed the image as well (the PostgreSQL and `node:22` images were already there and were left).
Proposed correction: one sentence saying the images stay unless removed with `docker rmi`.

**G8. Names.** §16's final check filters on `rw-drill`; with other names the filter must be adapted. I filtered on my own prefix. No correction needed, noted for exactness.

**E1. An error of mine, not of the runbook: §13 run 1 lost step 12's output.** After releasing step 12, the command with which I meant to read the log had a quoting error and failed, and the same command line then removed the containers and the volume that held the log. Step 12 very probably ran, but I did not see its verdict line, so I do not report it. I recreated the stack and ran §13 again in full; the table above is that second run.

**What I opened outside §13 and §16.** In the repository: `runward/adr/` only, as step 11 asks (the listing, two searches, ADR-0016 in full, one line of ADR-0010). The scripts the steps call (`scripts/operator-call.sh`, `scripts/drill-client.mjs`, `src/…`) were executed, not read. The files the sections cite for reference (`db/roles.sql`, `ci.yml`, `src/adapters/system/egress.js`, `scripts/isolation-deployed.mjs`, the test files, §3, §7, §8, §10, §12 of the runbook) were not opened; no step needed them. Outside the repository: the author's own note on how to reach his server, as instructed.

## Clean-up

- Each run removed its throwaway directory `$R` itself (§13 step 12, §16 step 17: `0` printed) and left no `node src/` process.
- Removed: the five containers with `docker rm -f -v`, the two named volumes, the two networks, and the SeaweedFS image pulled for the run.
- Verified after removal: `docker ps -a --filter name=rwredo2 -q | wc -l`, `docker volume ls -q --filter name=rwredo2 | wc -l` and `docker network ls -q --filter name=rwredo2 | wc -l` all print `0`; no SeaweedFS image left. The host's totals are back to what they were before the first command: 17 containers, 44 volumes, 9 networks. No folder was created on the host.
- The repository was not modified and nothing was pushed.
- Left on the executor's own machine, beside this record: the copy of the runbook the sections were read from, the three harness scripts and the captured output of the two §16 runs. They hold no token, key or link.
