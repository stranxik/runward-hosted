# ADR-0023: The grants of the service's roles are compared by a gesture of their own, under rw_owner (refines ADR-0016)

**Date**: 2026-11-11
**Status**: accepted 2026-11-11 by the author in chat ("j'accepte l'adr", in answer to a list that named this record); written by an agent session
**Refines**: ADR-0016 (accepted 2026-11-08), which stays in force for everything this record does not change
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: reality-check (the gateway's log line of the failed deploy, the privileges declared in `infra/scaleway/main.tf`, the queries of the comparison read one by one, the shape replayed on a throwaway PostgreSQL), challenge, durable position

## Context

The number 0022 is taken by a record proposed in an open pull request (#14); this one is 0023 so the two do not collide.

Since the review of 2026-11-10 (finding C28) each deploy compares, right after `migrate`, what `rw_app` and `rw_maint` may do in effect with the grant lines of `db/schema.snapshot.txt`, and stops before the service switches when they differ. It was written as an argument of the gesture `roles`, under `rw_admin`. ADR-0016 fixes the gateway's routes as a closed list and gives each gesture one database role.

Two deploys stopped on that comparison on 2026-11-11, neither for a drift:

| Run | What the gateway's log said | Cause |
|---|---|---|
| 42930736032 | `68 fewer (rw.archive rw_app INSERT, ...)` | the administrator's URL names the hoster's default database `rdb`; `pg_class` and `pg_namespace` hold the objects of the session's database only, and `rdb` has no schema `rw` |
| 43018993884 | `roles: cannot connect to the service database runward_hosted as rw_admin: permission denied for database "runward_hosted"` (2026-11-11T12:21:35.504Z) | the comparison opened a session of its own on the service database with the administrator's credentials; the hoster lets a user connect only to a database it holds a privilege on, and `infra/scaleway/main.tf` declares one for `rw_owner` (`all`), `rw_app` and `rw_maint`, none for `rw_admin` |

In both runs `roles` and `migrate` had answered 200 and the deploy stopped before the service switched; after the second, the rollback succeeded and the service kept serving the previous digest.

The comparison needs a session on the service database, and nothing else: every query it runs asks what another role holds (`has_table_privilege`, `has_any_column_privilege`, `has_schema_privilege`, `has_database_privilege`, each with the role as an argument) over `pg_roles`, `pg_class` and `pg_namespace`, which any role may read. It needs no right of the administrator.

The decision is taken at the process boundary of ADR-0016: which child of the gateway runs the comparison, under which role.

## Decision

The comparison is a gesture of its own, `grants`, run by the gateway under `rw_owner`, and `roles` takes no argument:

- `POST /gestures/grants` runs `scripts/grants.mjs`; its child receives `MIGRATE_URL`, the URL of `rw_owner`, and no other credential. No argument, a deadline of 2 minutes, not reachable by the schedule's paths. The closed list of ADR-0016 gains this one route;
- it reads, and writes nothing. It compares only in the service database: a URL that names another database than `RW_DATABASE` is refused before any connection, and a session whose `current_database()` is not `RW_DATABASE` is refused before the catalog is read. A refusal for where it is never carries a count of grants;
- `roles` keeps what it did under `rw_admin` from the default database (the role `rw_resolve`, the membership, the attributes, CONNECT, TEMPORARY). Its argument `grants` and the flag `--grants` are removed: the gateway answers 400 to a call that carries it, the script exits 2, nothing runs;
- `rw_admin` is granted nothing on the service database. No resource of `infra/scaleway/main.tf` changes;
- `deploy.yml` calls `roles`, `migrate`, `grants`, in one step, before the service switches; `scripts/check-workflows.mjs` refuses a workflow where `grants` does not follow `migrate`, or where the step may be skipped.

One role per gesture, one URL per child (ADR-0016) holds as written.

## Alternatives discarded

- **A privilege for `rw_admin` on the service database** (`scaleway_rdb_privilege`, the smallest level that carries CONNECT): it would make the failing call pass. It widens the most privileged role to cross a boundary the hoster sets, for a read that needs no privilege, and the level the API offers is not CONNECT alone (`readonly` also gives table rights in the schema `public`).
- **Pointing the administrator's URL at the service database**: the server refuses the connection all the same, and `roles` would then fail too.
- **Giving the `roles` child a second URL** (the owner's, for the comparison only): it breaks the one property ADR-0016 rests on, one role per process.
- **Comparing at the end of `migrate`**: same role and same session, one call fewer. But `migrate` writes and the comparison judges what was written; kept apart, a refusal says which of the two failed, and the comparison can be run alone, after a correction by hand, without running the migrations again. Tempered rather than eliminated: it is the fallback if the list of gestures must stay at ten.
- **Dropping the comparison until the hoster's behaviour is understood**: C28 stays open, and the level of `rw_app` and `rw_maint` is ignored by OpenTofu after creation.

## Consequences

- **Positive**: the deploy no longer depends on what the hoster lets its administrator reach; the comparison runs under the role whose grants file it checks, on the URL `migrate` has just used; the place it reads is checked by the gesture itself, not assumed from the caller.
- **Negative, accepted**: an eleventh route on the gateway; `rw_owner` reads the comparison of grants it applied itself (it reads them through the server's own privilege functions, and the reference is the committed snapshot, which it cannot change); a caller that still sends `roles '{"grants":true}'` is refused with 400 until it is updated (this repository's `deploy.yml` is the only one).
- **On other boundaries**: `runward/runbook.md` §8 and §11, `runward/execution-topology.md` (the gateway's list of gestures) and the threat model's T29 name the gesture; the image copies `scripts/grants.mjs`; no contract, no schema and no secret changes.

## What would settle it

- **Confirms**: the first deploy from `main` that carries this record answers 200 to `roles`, `migrate` and `grants`, and the gateway's log line for `grants` names `rw_owner`; `test/unit/operator-gateway.test.js` (the child of `grants` receives the owner's URL and no other credential; `roles` with `grants` is answered 400 and starts no child); `test/unit/grants.test.js` (a URL that names another database opens no connection); `test/pg/isolation.test.js` (each planted drift refused through the owner's path; an administrator that cannot connect to the service database changes nothing).
- **Reverses**: the hoster refusing `rw_owner` a read the comparison needs (the gesture would say so in its one line); or a finding that the comparison must be made by a role that did not apply the grants, which would need a read-only role of its own and a privilege for it, the author's to approve as a paid-resource change.

## Reevaluation trigger (mandatory, dated)

Reopen when one of these is observed:

- `grants` answers anything but 200 on a deploy where the gateway's log shows no drift;
- the hoster's API offers a privilege that is CONNECT alone, or documents that its administrator may connect to every database;
- a second gesture needs to read the service database's catalog under a role that holds no privilege on it.

**Trigger set on**: 2026-11-11 · **Watched via**: the gateway's `operator.gesture` log lines for `grants` (role, status), the deploy's run summary

## References

- ADR-0016 (refined), ADR-0006, ADR-0008
- `src/operator-gateway.js` (`GESTURES`), `scripts/grants.mjs`, `scripts/roles.mjs`, `.github/workflows/deploy.yml`, `scripts/check-workflows.mjs`, `infra/scaleway/main.tf` (the privileges on `runward_hosted`)
- Deploy runs 42930736032 and 43018993884 of this repository; `runward/governance/reviews/2026-11-10_code-review_22a983b.md` (finding C28)
