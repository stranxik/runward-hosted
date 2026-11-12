# ADR-0032: What the smoke calls a failure of health: a 503 that does not settle within a bounded window, confirmed, at the expected commit (refines ADR-0008)

**Date**: 2026-11-12
**Status**: proposed
**Refines**: ADR-0008 (the deployment chain), which stays in force for everything this record does not change
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: reality-check (the logs of the two failed runs, the hoster's container logs of both instances, the deadlines read in the code, the hoster's documentation), challenge (an adversarial review of the first implementation, `4f46dd3`), durable position

## Context

The numbers 0027 and 0031 are taken by records proposed in open pull requests (#22, #26); this one is 0032 so they do not collide.

ADR-0008 says the deploy "smokes ... and rolls back on any failure". The smoke asked `/api/health` once, first, and any answer but 200 was a failure. Two deploys were rolled back that way while nothing was wrong with what they carried:

| Run | Instance start | First `/api/health` | What it answered |
|---|---|---|---|
| 43103305995 (`1b605b0`) | 2026-11-11 21:37:49 UTC | 21:38:09 | 503 after 3.0 s, `db` down, the object store ok |
| 43126674423 (`6f12981`) | 2026-11-12 00:25:31 UTC | 00:25:55 | 503 after 10.06 s, the object store down (the egress deadline of 10 s), `db` ok |

In both, the request was the instance's first use of the database and of the object store; the next use answered; the rerun passed. The hoster documents, for a container attached to a private network in its Paris region, resources out of reach in an instance's first seconds, and asks for retries. The database's error was kept by nothing: the documented cause fits, it is not a recorded one (runbook §7).

The service now asks both dependencies before it binds its port (`src/main.js#warm`), which removes the case as observed. What stays to decide is the gate: an instance may still start serving with a dependency down, and a gate that fails on one such answer rolls back sound revisions, while a gate that waits without rules passes unsound ones.

The decision is taken at the deploy chain's boundary: what the smoke accepts as "health is sound" before the chain goes on to the real send.

## Decision

For `/api/health`, the smoke's failure is no longer "the first answer is not 200". It is any of these:

- **an answer that is not the app's verdict**: any status but 200 or 503, a 503 whose body is not the app's (`ok` false), an error of the call. One ask, a fault;
- **a 503 of the app that does not settle**: the app's "a dependency is down" is asked again, with a pause that doubles from 1 s to 8 s, and no ask starts later than 45 s after the first (each ask is cut at 30 s: the window plus one ask in flight at the most). A dependency down for that whole window is a fault;
- **a settling that is not confirmed**: an ok that follows a 503 counts only when two more answers, 1 s apart, are ok in a row inside the same window; a 503 among them starts the count again; the window ending first is a fault. `/api/version` is then read again and must say the expected commit;
- **an answer of another commit**: `/api/version` is read before health, and a version that is not the expected commit is a fault at once, health being asked once. `/api/health` carries its `commit` (an added field), and every health answer, ok or down, that names another commit or none is a fault at once.

A health that is ok at the first ask is asked once, as before. The window may be shortened by `RW_SMOKE_SETTLE_MS`, never lengthened. Every other check of the smoke, and the rollback on any failure, are as ADR-0008 wrote them.

## Alternatives discarded

- **Keeping the single ask, the warm-up alone answering the case**: the warm-up is bounded (15 s) and binds whatever its outcome; the hoster's documentation speaks of a network that can take longer to be reachable. A sound revision would still be rolled back, less often.
- **Asking again without confirmation** (the first implementation): a dependency that comes and goes passed on the one ask that found it up, where it failed before; and an ok of the revision served before could have settled the question during the hoster's switch. Found by the review of `4f46dd3`.
- **A longer window, or one the workflow sets**: a real outage must still fail the deploy within about a minute, and a knob that lengthens is a way to switch the gate off.
- **A sleep before the smoke**: it slows every deploy and proves nothing about the answer that follows.
- **The hoster's health check on `/api/health`** (requests held until 200): its documented answer, and the better one at the routing level. It changes a paid resource's description (`infra/scaleway/main.tf`) and is the author's to decide; it would not replace the smoke's own rule. Tempered rather than eliminated.

## Consequences

- **Positive**: a sound revision whose instance started with a dependency out of reach for a few seconds is no longer rolled back; an outage, a dependency that comes and goes, and an answer of another revision still fail the deploy; the run's log says when health had to settle, and the service's log says why (`warm`, `health.dependency`).
- **Negative, accepted**: a deploy whose health is down takes up to 45 s, plus one ask in flight, longer to fail; `/api/health` says the commit it runs, which `/api/version` already said to anyone; a revision of before this record does not say its commit in health, so the smoke of this record fails on it (it is run against the revision it ships with).
- **On other boundaries**: the API contract's routes are unchanged (one added field in a public body); `runward/runbook.md` §1, §7 and §10; the probe (ADR-0011) reads health as before.

## What would settle it

- **Confirms**: `test/unit/smoke.test.js` (the pauses and the confirmation; planted: down for the whole window; an ok then a relapse; another revision's ok; only the app's 503 asked again; the window never lengthened; the script on the real application); the next deploys from `main`: none rolled back on a health 503 while production is sound minutes later, and each new instance's `warm` line in the container's log.
- **Reverses**: a deploy that passed the smoke while `health.dependency` shows a dependency down at that time; or the hoster's health check adopted and shown to make the window idle, which would bring the single ask back.

## Reevaluation trigger (mandatory, dated)

Reopen on 2027-02-12, or earlier when one of these is observed:

- a deploy rolled back on a health that settled after the window, production sound minutes later;
- a deploy that passed with a line `health answered 503` three times in a week: the warm-up no longer covers the start, and the cause is to be read again;
- the hoster documents a limit for binding the port, or its health check is set on the container.

**Trigger set on**: 2026-11-12 · **Watched via**: the deploy runs' logs (the smoke's lines), the container's `warm` and `health.dependency` log lines

## References

- ADR-0008 (refined), ADR-0011
- `scripts/smoke.mjs` (`settledHealth`, `HEALTH_SETTLE`), `src/main.js` (`warm`, the health body), `.github/workflows/deploy.yml` (step 5), `runward/runbook.md` §7
- Deploy runs 43103305995 and 43126674423 of this repository; the hoster's documentation, "My container cannot connect to Private Network resources at startup" and "My container gets transient connection errors when connecting to Private Network resources" (read 2026-11-12)
