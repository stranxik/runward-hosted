# ADR-0033: runward-fleet re-pinned at main@c9a886a, where a repository identity of 2 to 8 segments and a port merged; the bytes do not move, the digest still names the build (refines ADR-0024)

**Date**: 2026-11-12
**Status**: proposed
**Refines**: ADR-0024 (accepted 2026-11-11), which stays in force for everything this record does not change; through it, ADR-0021, ADR-0018 and ADR-0002
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: reality-check (the two commits of runward, the two tarballs, the same inputs built by each pin through the real application, the declaration under each pin, an export replayed, the author's GitLab instance declared and sending), challenge, durable position

## Context

ADR-0024 pins runward-fleet at main@d052814 and keeps ADR-0021's trigger: "a change of `packages/runward-fleet` the product needs, merged into `main` after d0528149 (re-pack at that commit, measured, in a new record)". ADR-0029 (accepted 2026-11-11) names that change in its section 1 and its step b: the index names a GitLab repository `host[:port]/full/path`, which the archive `addcaa2d…` refuses beyond three segments and with a port, so such a path is refused at declaration (`repository-path-unsupported`), asked of the library itself (`src/adapters/fleet/assembler.js`, `admits`). The author's GitLab CE instance answers on a port: its `temoin/demo` was refused on 2026-11-11, and the witness of ADR-0029's step c stopped there (`runward/JOURNAL.md`, 2026-11-11).

On 2026-11-12 PR #513 of runward merged into `main` at `c9a886a460e8eae87e6c69ec6a7b2b6afca8b88f` (main@c9a886a): a repository identity is a host with an optional port (1 to 65535 in decimal, `:443` dropped) and a path of 2 to 8 segments, one grammar in `src/repository.js` (ADR-0130 of runward). Between d0528149 and c9a886a4, `packages/runward-fleet` changed in 6 files (185 lines added, 37 removed): `src/repository.js` added; `src/build.js`, `src/trust.js`, `src/run-signature.js`, `src/cli.js` and `README.md` changed. `ui/views.js`, `ui/template.html`, `src/site.js`, `src/rules.js` and `package.json` did not change. **The version stays 0.46.0**: it now names four archives.

What was measured on 2026-11-12, before deciding. "Old" is the archive `addcaa2d…` (main@d052814), "new" the archive `9c2f6090…` (main@c9a886a). The inputs are sent through the real application with the in-memory store (`test/helpers.js#harness`), once in a checkout of `main` (old) and once in this branch (new): (A) one GitHub repository and the check fixture; (C) the five real exports of runward PR #499, one repository each; (D) a registered GitLab instance without a port, a path of two segments; (E) what only the new pin admits.

| Measure | Result |
|---|---|
| `npm pack` at d0528149, as a control | sha256 `addcaa2d…2f84`, the tarball of ADR-0024, reproduced |
| `npm pack` at c9a886a4, twice | sha256 `9c2f6090605d08b8eb038b5ec440d065e27078fb02825354f1812687d52aa6fb` both times; 238 606 bytes (235 166 before); 25 files (24 before: `src/repository.js` added) |
| the index bytes, old to new | the same each time: A 43 034 bytes, C 124 373, D 43 027, the same sha256 |
| the views on those indexes (fleet, decision, sources, proof, signatures, history, and the decision reading of each application) | the same HTML: `ui/views.js` is the same file (sha256 `110c75a0…`) and the indexes are the same bytes |
| a GitLab project of nested groups (`gitlab.com/group/subgroup/project`), an instance with a port (`gitlab-temoin:8929/temoin/demo`), both at once (`gitlab-temoin:8929/temoin/sub/group/demo`) | old: refused `repository-path-unsupported` at declaration; new: declared, the first send kept, confirmed, published (43 040, 43 026 and 43 046 bytes) |
| nine segments (`gitlab.com/a/b/c/d/e/f/g/h/i`); an instance registered by its address (`http://10.0.0.7:8929`) | refused `repository-path-unsupported` under both pins: GitLab admits them, the library names neither |
| an index of a three-level path on a host with a port, exported and replayed under the new pin (`scripts/replay-export.mjs`) | `same` for both publications, exit 0 (`test/unit/forge.test.js`, step b) |
| an export of the old pin replayed by the new one | `other-archive`, named "built by the runward-fleet archive addcaa2dce4e, packed at d05281492d72", exit 2 when nothing else is rebuilt: the digest names the build, although these bytes would rebuild the same |
| an archive of the new pin replayed by the old one (a rollback) | `label-refused` (the old lock does not know the new archive), exit 2, as in ADR-0024 |
| what the app serves | the same files and bytes: the app serves `ui/views.js` and the fleet stylesheet from the package, neither changed; `/api/version` changes `runwardFleetCommit` and the archive digest only, `viewsSha256` stays `110c75a0…` |
| the author's GitLab CE 17.11.1, whose host carries a port, with `scripts/witness-gitlab.mjs` | `temoin/demo` declared, its first send kept and confirmed, a send of the real runner accepted and shown P4 (`runward/JOURNAL.md`, 2026-11-12) |

The decision is taken at the same boundary as ADR-0002, ADR-0018, ADR-0021 and ADR-0024: the IndexAssembler adapter, its supply chain, the export's replay, and what the declaration asks of it.

## Decision

The pin of runward-fleet rests on **main@c9a886a**, by the procedure of ADR-0021, and nothing is done to the indexes already published:

- the tarball is `vendor/runward-fleet-0.46.0-c9a886a4.tgz`; `package.json` and `package-lock.json` name it; `vendor/runward-fleet.lock.json` pins `ref` `main`, `commit` `c9a886a460e8eae87e6c69ec6a7b2b6afca8b88f`, the sha256 above and its integrity, the 25 files of the pack each with its sha256, and its `previous` chain now names three archives, each with its commit and why the pin moved. The previous tarball leaves the tree; `npm pack` at d0528149 gives it again (the control above), and git keeps it;
- **the declaration is unchanged: it asks the pinned library.** A GitLab project of nested groups and an instance whose host carries a port are declared from this pin on, without a line of `src/application/repositories.js` changing. What the library still refuses is refused as before, with its reason, never truncated: a path of more than eight segments, an instance registered by an IP address (the library names hosts, never addresses), a port outside 1 to 65535. The words of `repository-path-unsupported` and the declaration screen's sentence (`web/views/lexique.js`, `pathLimit`) now say those cases, in both languages; the code, its status and the field it points to are unchanged;
- **the archive digest still names the build, even when the bytes are the same.** The measure above shows that the new archive rebuilds the old one's indexes byte for byte; the replay does not use that: an index labelled `addcaa2d…` is `other-archive`, named with the commit the lock's chain gives, as ADR-0024 says. One rule for every re-pin is simpler to hold than a rule that depends on a measure:

  | Archive sha256 | Commit of runward | Pinned here |
  |---|---|---|
  | `99e941a5ea915718e9a8254b00165042305772e3d228227b1cfeb9761b2aa2e9` | `5a9cdf08a76977f9b671662f562e98d332ccc95e` | 2026-11-06 to 2026-11-10 |
  | `fff950650d3ac666cc6b43cc731936fbda1f99fc76d9e02c44977691a4aa2337` | `d05b59742bf10f6bfe803a0caaa9a289cd272ab0` | 2026-11-10 to 2026-11-11 |
  | `addcaa2dce4e97c190754155f4e3cea48762a60de3678fb9ce802078c26f2f84` | `d05281492d724f09dfe821f0285571eacd3c540a` | 2026-11-11 to this record |
  | `9c2f6090605d08b8eb038b5ec440d065e27078fb02825354f1812687d52aa6fb` | `c9a886a460e8eae87e6c69ec6a7b2b6afca8b88f` | from this record |

- **the screens do not change**: the views are the same file, the indexes the same bytes for the same inputs; a GitLab repository newly admitted is named in the index as the library names it, `host[:port]/full/path`, lower case;
- everything else of ADR-0024 and ADR-0021 holds: a published index is never rebuilt or rewritten by a re-pin, the replay's rule and its three exits, `fleetPin`, the check of the tarball in both modes, `ui/mission.js` and `ui/documents.js` served by no route, and "a later re-pin is measured before it is recorded".

## Alternatives discarded

- **Stay at main@d052814**: the author's instance stays undeclarable, step c of ADR-0029 stays unfinished, and a GitLab customer with nested groups (GitLab's common layout) cannot declare a project
- **Name the identity in the app (lower case, the port, the segments) and give the library what it already admits**: a second grammar beside the pinned one, which ADR-0029 section 1 declined ("refused at declaration with its reason, never truncated"), and which the library's own `checkIndex` would still judge
- **Take the old archive's indexes as rebuilt here, since the bytes are the same**: the replay would then depend on a measure made once, for some inputs; a later input the two archives build differently (a name the old one refused cannot be in an old index, but a field read differently could) would pass unseen. The digest stays the name of the build
- **Keep the old words of `repository-path-unsupported`**: they would say that a path of three segments and a port are refused, which the service no longer does

## Consequences

- **Positive**: a GitLab project of nested groups and a self-managed instance on a port are declared, confirmed and shown at their level; step b of ADR-0029 is done and step c is finished on the author's instance; the same inputs give the same indexes and the same screens; the lock's chain carries a literal anchor for each of its four links (`test/unit/pin.test.js`, the review of 2177bf7, C65)
- **Negative, accepted**:
  - an export taken before this pin, replayed with this repository at this pin, exits 2 with `not rebuilt here` for every index although the bytes would rebuild the same: the reader packs runward-fleet at d0528149 to rebuild them, as ADR-0024 says for the archive before. The export's `replay.json` still says "the runward-fleet version named"; for 0.46.0 the table above is where a digest finds its commit, now over four archives
  - after a rollback to an image of the previous pin, a GitLab repository declared with three segments or more, or on a host with a port, can no longer be assembled by that image: its next publication is refused `index-build-refused` and the tenant's index stays the last one published. Rolling back past this pin is safe only while no such repository is declared in any fleet, as runbook section 7 says for `0007`; once one is, fix forward
  - the witness reader (`temoin.yml`) still does not run; switched on, a fleet whose last index an earlier archive built reads red until its next publication (ADR-0024's trigger, unchanged)
  - the tarball grows from 235 166 to 238 606 bytes; `src/repository.js` and the changed `src/trust.js` and `src/run-signature.js` carry the run-signature verification the app does not call (no trust policy, PADR-0011 point 2)
- **On other boundaries**: `runward/contracts/index-assembler.md` names main@c9a886a4 and this record; `/api/version` serves the new commit as `runwardFleetCommit` and the new archive digest, `viewsSha256` unchanged; the API contract keeps `repository-path-unsupported 400`; the content security policy is unchanged; `runward-fleet-index/0` keeps its name; ADR-0004 unchanged

## What would settle it

- **Confirms**: `node scripts/verify-runward-fleet.mjs` green in CI against main@c9a886a (the 25 files are the pack of the commit, byte for byte, and nothing else is in the tarball); `test/unit/pin.test.js` green with the lock's chain of four archives, each anchored by its literal digest and commit; `test/unit/forge.test.js` green: three segments, eight segments and a host with a port declared, nine segments and an address refused with the new words, the library's own answers listed both ways; step b: an index of `gitlab-temoin:8929/temoin/groupe/demo` exported and replayed `same`, exit 0; the witness of step c in `runward/JOURNAL.md`.
- **Reverses**: a file of the tarball that differs from main@c9a886a on GitHub; an index of an earlier archive that a view the app shows cannot read; a repository identity the library admits and the app then names otherwise in the index; or a declaration refused `repository-path-unsupported` for a name the pinned library admits.

## Reevaluation trigger (mandatory, dated)

Reopen when one of these is observed:

- the triggers of ADR-0024 that stand: an attested release of runward-fleet; a change of `packages/runward-fleet` the product needs, merged into `main` after c9a886a4 (re-pack at that commit, measured, in a new record); runward-fleet versioning its builds; a rollback across this pin while a tenant holds an index of it, or a GitLab repository only this pin admits; the lot that shows the mission projections or the documents; the witness reader switched on;
- a customer's GitLab project with more than eight segments, or an instance whose tokens' `iss` is an address: the library's grammar is runward's to widen, then a re-pin here;
- the level reaches the index (ADR-0029 section 2: "the index carries the level only when runward-fleet has a field for it").

**Trigger set on**: 2026-11-12 · **Watched via**: `scripts/verify-runward-fleet.mjs` in CI; the service's start, which `fleetPin` refuses on another install; the refusals `repository-path-unsupported` in the tenants' declarations; the release page of runward

## References

- ADR-0024 (refined), ADR-0021, ADR-0018, ADR-0002, ADR-0004, ADR-0029 (section 1 and step b of section 5), ADR-0031; PADR-0011 points 2, 4 and 6
- stranxik/runward PR #513 (ADR-0130 of runward: a repository identity for GitHub, GitLab and Azure DevOps), merged into `main` at c9a886a460e8eae87e6c69ec6a7b2b6afca8b88f
- `vendor/runward-fleet.lock.json`, `scripts/verify-runward-fleet.mjs`, `scripts/replay-export.mjs`, `src/adapters/fleet/assembler.js` (`fleetPin`, `admits`), `src/application/repositories.js`, `src/domain/refusals/forge.js`, `web/views/lexique.js`, `runward/contracts/index-assembler.md`, `scripts/witness-gitlab.mjs`
- `test/unit/pin.test.js`, `test/unit/forge.test.js`
