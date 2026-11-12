# ADR-0031: The store of the forge port: the issuer key enters the values the indexes of 0001 hold, and the choices ADR-0029 left to its implementation (refines ADR-0029)

**Date**: 2026-11-11
**Status**: accepted 2026-11-12 by the author in chat ("go pour tout", in answer to a list that recommended accepting ADR-0031 after the second review pass of PR #26). Written by the agent session that implemented ADR-0029. The code of the pull request that carries this record follows it; an answer that changes a point changes the code with it.
**Refines**: ADR-0029 (accepted 2026-11-11) on the shape of its store, on two points where the review of the pull request showed its text to be unsafe as written (j and l), and on the other choices its text does not make
**Scope**: `db/migrations/0007_forge_port.sql`, the two store adapters, and the points listed under "Choices"
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: reality-check (the migration guard of `scripts/migrate.mjs` run on the migration; the suites on PostgreSQL 17.11), challenge (the pull request's adversarial review, still to come), durable position

## Context

ADR-0029 section 1 asks for "one expand-only migration: `forge in ('github', 'gitlab')`, and an issuer key on `rw.forge_repository`", the issuer key entering the pending index `(forge, issuer key, name_key)`, the pinned index `(forge, issuer key, repository_id)`, `rw.oidc_jti`, `rw.rate_counter` and `rw.refused_counter`.

Read against the code, three of these cannot be done by an expansion as this repository defines one. `scripts/migrate.mjs` refuses, lexically, every statement that removes something (ADR of the floor, PADR-0015 point 3: the image of before keeps running on the new schema), and:

- the check `forge in ('github')` of 0001 cannot be widened in place: PostgreSQL replaces a check by removing it and adding another;
- the two unique indexes of 0001, `(forge, name_key)` while pending and `(forge, repository_id)` once pinned, cannot gain a column in place; left as they are beside two new ones, they would still refuse the second tenant that pins the same `project_id`, which is the very case ADR-0029's planted control requires to pass;
- the primary keys of the three tables without a tenant cannot gain a column in place either.

Weakening the guard to let these three removals through is a change of a guard, which no agent makes (AGENTS.md, never-rule 7).

## Decision

**The issuer key enters the values the two indexes of 0001 hold, and the three tables without a tenant are replaced by three tables keyed by the issuer key; nothing of 0001 is removed, and the migration guard is untouched.**

1. `rw.forge_repository.forge` stays, `'github'` on every row by its check and its default, and is read by nothing from 0007 on. The forge is a new column, `forge_name in ('github', 'gitlab')`.
2. `issuer_key` is a new column: the issuer's string for a public issuer, the tenant's registration (`rw.issuer.id`, 128 random bits) for a registered instance.
3. `name_key` and `repository_id` are resolution keys. GitHub's stay bare, so no existing row is rewritten, and the same check holds them to no colon, so a GitHub key never reads as a scoped one. Every other forge's read `<forge>:<issuer key>:<value>` (`src/domain/forge.js#scopedKey`), and the check `forge_repository_keys_scoped` holds every row to it. The indexes of 0001 are then unique within a forge and an issuer key by the value they index, which is what ADR-0029 asks. The two functions that read across tenants, `rw.resolve_forge_repository` and `rw.name_key_taken`, also filter on `issuer_key`.
4. A repository's registered issuer key must be a live registration of the row's own tenant: a trigger on `rw.forge_repository`, not a security definer function, so it reads `rw.issuer` under the writer's own policies.
5. `rw.issuer` and `rw.issuer_key` are tenant tables under forced row level security; a key references its registration by `(tenant_id, issuer_ref)`. Two triggers hold both to "written once": a key's material never changes, a retirement and a removal are final, for the service's role and the maintenance role alike.
6. `rw.token_use`, `rw.send_rate` and `rw.send_refused`, keyed by the issuer key, take over from `rw.oidc_jti`, `rw.rate_counter` and `rw.refused_counter`, which stay for the image of before. A GitHub replay id is written in both places by `rw.use_token`, so that a token used on one image is refused by the other while both run during a deploy. The hourly counters are not shared across the two images during that window: a repository may be granted up to twice its runs in the hour of a deploy, which is accepted.

### Choices ADR-0029 left to its implementation

Each is in the code of this pull request and can be changed alone.

- **a. `key-retired` is journaled at most 30 times an hour for one key.** ADR-0029 has it "written in the tenant's journal" once the signature holds. Whoever holds a retired key, which is the case the gesture exists for, could otherwise write into the tenant's journal without bound. Past 30 an hour the answer is the same, and nothing is written.
- **b. A retired key does not come back.** ADR-0029 keeps a retired key "marked"; adding the same `kid` again is refused `key-exists`. An expired key, never retired, is confirmed again by the gesture that adds it.
- **c. A removed registration is final**, and is removable only when no repository is declared on it or could still be restored on it (30 days).
- **d. A name the pinned runward-fleet cannot carry is asked of the library itself** (`src/adapters/fleet/assembler.js#admits`: a build of one silent mission): the refusal at declaration ends with the re-pin, with no change of this code.
- **e. A pinned repository's upload refused `definition-not-pinned` is offered for a new confirmation only when its definition names the declared file and branch** (a renamed or moved project, a declaration changed). A pipeline of another branch therefore cannot put a confirmation in front of a member.
- **f. On a new confirmation, a GitLab repository takes the project's current path as its name** (a renamed project is then named as it is), if the index can carry it.
- **g. The contract gains nine codes beside the nine ADR-0029 lists**: `issuer-unknown`, `repository-path-unsupported`, `issuer-malformed`, `issuer-not-allowed`, `issuer-limit`, `issuer-in-use`, `key-malformed`, `key-exists`, `key-limit`; and `workflow-malformed` takes GitLab's words for the declared file. By addition.
- **i. A GitLab replay id is kept until the token can no longer be accepted**: its `exp`, or its tenth minute when that comes first. ADR-0029 says "kept until `exp`"; past the tenth minute the token is refused `token-too-old` whatever the store holds, and an `exp` is its signer's to choose: kept to it, the holder of a registered key could grow a table every tenant shares. GitHub's are kept until `exp`, as before.
- **j. `github.com` is reserved at registration, with every host under it, and no dot is taken off a host** (a deviation from ADR-0029 section 4, from the review of this pull request). ADR-0029 reserves the hosts of the public issuers; GitHub's is its token host. But the index names a registered repository `host/path`: a registration of `https://github.com` with a key made on a laptop would have put `github.com/<owner>/<repo>` in a tenant's index, named as GitHub's own are. The guard therefore reserves every host under which the index names a public forge (`github.com`, `gitlab.com`). And where ADR-0029 has "a trailing dot removed", a trailing dot and any empty label now refuse: removing one dot of `gitlab.com..` left `gitlab.com.`.
- **k. gitlab.com is closed until the service opens it** (`RW_GITLAB_COM=1`): its tokens are not read, its key host is not in the egress list, and it is not offered at declaration. ADR-0029 section 5 has gitlab.com as step d, after a witness the author's account is needed for; without a switch, a merge would have opened it to every tenant, shown P3, unwitnessed. Registered instances do not depend on it.
- **l. `key-retired` is answered after the token's own times, and written once per token**: an expired or old token signed when the key lived is `token-expired` or `token-too-old` and writes nothing; a token's replay id is used once before the entry is written.
- **m. The order epoch enters the run a GitLab send is kept under** (`<pipeline_id>@<epoch>` from epoch 1 on): after an instance's restore the numbers of an upload already received come back, and `order-epoch-open` would otherwise leave them refused `duplicate-in-run` for ever.
- **n. The gesture `declare-with-consent` is bound to the forge and the issuer chosen as well as the name**, for another forge than GitHub.
- **h. GitHub's uploads are journaled with their level too (P1, its basis the key that signed)**, and the confirmation reads the repository before it consumes the gesture, so `nothing-to-confirm` and `confirmation-stale` are answered without spending the verification.

## Alternatives discarded

- **Let the migration guard through for these three removals now** (a named exemption, as the one DYNAMIC has): the cleanest schema, plain columns in plain indexes. The review of the pull request recommends against it for now: the encoding is sound for isolation (two issuer keys never share a prefix, a check holds every row to its scope), and an exemption taken under a deadline is a guard weakened. The cleaner schema is reached later, in two steps (the reevaluation trigger).
- **A new table for the forge identity of every repository**: `rw.repository.id` references `rw.forge_repository(id)`, so a row of the old table is still needed for each repository, and the image of before reads and writes the old table during a deploy: two sources of one truth.
- **New indexes beside the old ones**: the old ones still refuse the second tenant.
- **Journal every `key-retired`**: an unbounded write for the holder of a stolen key.

## Consequences

- **Positive**: ADR-0029's isolation holds on PostgreSQL (`test/pg/forge.test.js`: two tenants, the same issuer string, the same `project_id`); the image of before keeps running on the new schema; the guard is as strict as before.
- **No way back to an image of before 0007 once a GitLab repository is confirmed.** The schema is an expansion, so the image of before starts on it; but it reads `forge = 'github'` on every row and writes `github.com/<path>` for each: a GitLab repository would be named as a GitHub one in the next index it publishes, and its uploads would be resolved by nothing. A rollback past this pull request (runbook section 7) is safe only while no GitLab repository is confirmed; after that, the way back is a fix forward.
- **Negative, accepted**: `forge` is a column that says nothing; `repository_id` and `name_key` hold a scoped text for GitLab, which a reader of the table must know (the migration's header, `src/adapters/store/tables.js` and the schema snapshot say it); three tables of 0001 are no longer written by the service once the image of before is gone.
- **On other boundaries**: `db/schema.snapshot.txt`, `runward/contracts/port-contract.md`, `runward/governance/threat-model.md` (T43).

## Reevaluation trigger (mandatory, dated)

Reopen on 2027-02-11 with ADR-0029, or earlier: **the image of before 0007 runs nowhere any more** (then a migration in two steps, written as its own record: expand first, plain columns and indexes on `(forge_name, issuer_key, …)` filled from the scoped values and read by the service; contract once no image reads the old ones, which is the one removal to ask the author for, at that moment and not as an exemption of the guard today); a third forge whose keys do not fit a text prefix; a reader of the table misled by `forge`; the pull request's adversarial review finds a way across two issuer keys.

**Trigger set on**: 2026-11-11 · **Watched via**: `test/pg/forge.test.js`, `test/pg/isolation.test.js` (the schema snapshot), the adversarial review of the pull request

## References

- ADR-0029, ADR-0006, ADR-0015
- `db/migrations/0007_forge_port.sql`, `db/grants.sql`, `scripts/migrate.mjs`, `src/domain/forge.js`, `src/adapters/store/postgres.js`, `src/adapters/store/memory.js`, `src/adapters/store/tables.js`
- `test/pg/forge.test.js`, `test/unit/forge.test.js`
