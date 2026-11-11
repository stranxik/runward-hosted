# ADR-0024: runward-fleet re-pinned at main@d052814, where the grouped decision reading merged; an index of an earlier archive is read as published, ungrouped, until its next publication (refines ADR-0021)

**Date**: 2026-11-11
**Status**: proposed
**Refines**: ADR-0021 (accepted 2026-11-11), which stays in force for everything this record does not change; through it, ADR-0018 and ADR-0002
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: reality-check (the two commits of runward, the two tarballs, the same inputs built by each pin through the real application, an export archive of each pin replayed by the other, an index of each pin read by the other's views, the screen captured under each pin), challenge, durable position

## Context

ADR-0021 pins runward-fleet at main@d05b597 and names two triggers that fired on 2026-11-11:

- "the product needs a change of `packages/runward-fleet` merged into `main` after d05b5974 (re-pack at that commit, measured, in a new record that refines this one)". The journal entry of 2026-11-11 on the decision reading left three points for the author's eye, all runward-fleet's: a page of 46 refusals that repeats the same text 42 times (10 555 px tall at 1440 px), the applications listed in the inventory's order, and no tile for a state that counts no application. Since then runward's `main` gained, in `packages/runward-fleet`: the grouped decision reading (PR #510, ADR-0128 of runward), the mission projections (PR #500, ADR-0126: `ui/mission.js`) and the documents module (PR #509, ADR-0127: `ui/documents.js`). PR #509 merged last, at `d05281492d724f09dfe821f0285571eacd3c540a` (main@d052814), the head of `main` when this record was written.
- "a re-pin is about to land while a tenant holds a published index: decide then, in a record, how an index of an earlier archive is replayed here and what the screens say of it". On 2026-11-11 the service at `https://app.runward.dev` serves `"sendWorkflow":["f70f2705…"]` in `/api/version`: it accepts uploads, and each deploy sends this repository's own check to the witness tenant (`deploy.yml`, job `smoke-send`). This session did not read any tenant's data; the record takes it that at least one tenant holds an index the archive `fff95065…` built.

Between d05b5974 and d0528149, `packages/runward-fleet` changed in 9 files (1 799 lines added, 34 removed): `package.json` (two entries added to `exports`, `./documents` and `./mission`), `src/build.js`, `src/rules.js`, `src/site.js`, `ui/template.html`, `ui/views.js`, `README.md`, and two files added, `ui/documents.js` and `ui/mission.js`. **The version stays 0.46.0**: it now names three archives.

What was measured on 2026-11-11, before deciding. "Old" is the archive `fff95065…` (main@d05b597), "new" the archive `addcaa2d…` (main@d052814). The inputs are the ones the tests hold, sent through the real application with the in-memory store: (A) the three published indexes of `test/unit/pin.test.js` (one mission, `test/fixtures/check.json`); (B) the portfolio of `test/unit/decision.test.js` (three of runward's real exports and a mission that never sent); (C) the five real exports of runward PR #499 (`test/fixtures/decision/`), one application each.

| Measure | Result |
|---|---|
| `npm pack` at d05b5974, as a control | sha256 `fff95065…2337`, the tarball of ADR-0021, reproduced |
| `npm pack` at d0528149, twice | sha256 `addcaa2dce4e97c190754155f4e3cea48762a60de3678fb9ce802078c26f2f84` both times; 235 166 bytes (202 977 before); 24 files (22 before: `ui/documents.js` and `ui/mission.js` added) |
| the `fleet.json` the service writes, old and new | the same bytes each time (732 bytes for A): the inputs are the same |
| the index bytes, old to new | different each time: A 41 584 → 43 034, 41 585 → 43 035, 41 584 → 43 034; B 88 216 → 91 711; C 120 878 → 124 373 |
| what differs in the index | one field added, `missions[].latest.conformanceByKind[].byText` (within a kind, its refusals grouped by the check's text as written, as positions in `conformance`); no value changed, none removed |
| the views other than the decision reading (fleet, mission, history, proof, signatures, pr) on B and C | the same bytes, old and new |
| the Sources view | one row added (224 bytes): the rule R6 of the decision reading ("grouped, no refusal is hidden") |
| the decision reading, portfolio (C, French) | 9 574 → 10 533 bytes. Three changes: every state has its tile with n / N, a state with no application included (3 tiles → 5: refused 2 / 5, level not met 1 / 5, nothing blocking 2 / 5, no check received 0 / 5, content not shared 0 / 5); the applications are listed refused first, then level not met, then the others, each state in the inventory's order (agent-ratified, demo-renamed, demo-repaired, hosted-proposed, level-not-met → demo-renamed, hosted-proposed, level-not-met, agent-ratified, demo-repaired); the note under the tiles says that order |
| the decision reading, the application of 46 refusals (hosted-proposed, French) | 51 929 → 28 752 bytes. 2 kinds (42 / 46 and 4 / 46), each said once in the section of refusals; the check's text shown 4 times instead of 46 (the texts of the first kind stand for 22, 19 and 1 refusals, the one of the second for 4), each behind a fold, the first of the page open; the 46 refusals still listed once each, with their document, file, line and requirement, behind 3 second folds ("Où, refus par refus"). The folds are `<details>`: no script |
| the same page, captured in Chrome with the app's stylesheets (a static page without the frame, system fonts) | 10 554 → 2 257 px tall at 1440 px; 18 749 → 5 160 px at 390 px |
| the application of 2 refusals (demo-renamed) | 1 text instead of 2, the 2 refusals listed behind one fold |
| the applications with no refusal (demo-repaired, level-not-met; agent-ratified in English) | the same bytes |
| agent-ratified in French | 13 bytes fewer: the label of the check's own sentence loses "(en anglais)" |
| the roles the reading carries | `location` gone; `refusal-kinds`, `refusal-kind`, `refusal-text`, `where`, `where-label`, `refusals` added |
| an export archive of the old pin replayed by the new one (`scripts/replay-export.mjs`) | `other-archive` three times, each named "built by the runward-fleet archive fff950650d3a, packed at d05b59742bf1"; `same 0, different 0, not rebuilt here 3`; exit 2 (cannot tell: nothing was rebuilt here) |
| an archive of each pin replayed by itself | `same` three times, exit 0, both |
| an archive of the new pin replayed by the old one (a rollback) | `label-refused` three times (the old lock does not know the new archive), exit 2 |
| an index of the old pin read by the new views (A, B, C: 9, 15 and 17 views, strict), the new `checkIndex` and `renderPage` | every view renders, no rule broken |
| the decision reading of an old index by the new views | the tiles, the order and the kinds with their n / N as above (they are read from fields the old index already holds); with no `byText`, each of the 46 refusals is then shown alone with its own text, folded, the first open: 7 090 px at 1440 px. No refusal is hidden |
| an index of the new pin read by the old views, the old `checkIndex` and `renderPage` (a rollback) | every view renders, no rule broken: the old views ignore `byText` |
| what the app serves | 55 files under both pins; `views.js` 112 418 → 119 274 bytes, digest `56b75208…` → `110c75a099fcd69ed4bfbc9c0d7280980345402a20daceb75b30fdc372a43361`; the fleet stylesheet 9 990 → 10 757 bytes; `ui/mission.js` and `ui/documents.js` are in the install and served by no route; `views.js` imports no module |

The decision is taken at the same boundary as ADR-0002, ADR-0018 and ADR-0021: the IndexAssembler adapter, its supply chain, the export's replay, and the app's layer over the pinned views.

## Decision

The pin of runward-fleet rests on **main@d052814**, by the procedure of ADR-0021, and nothing is done to the indexes already published:

- the tarball is `vendor/runward-fleet-0.46.0-d0528149.tgz`; `package.json` and `package-lock.json` name it; `vendor/runward-fleet.lock.json` pins `ref` `main`, `commit` `d05281492d724f09dfe821f0285571eacd3c540a`, the sha256 above and its integrity, the 24 files of the pack each with its sha256, and its `previous` chain now names two archives, each with its commit and why the pin moved. The previous tarball leaves the tree; `npm pack` at d05b5974 gives it again (the control above), and git keeps it;
- **an index of an earlier archive is replayed as ADR-0021 says, with no second archive in this repository.** `scripts/replay-export.mjs` names it `other-archive` with the commit its digest is packed at, read from the lock's chain, and never rebuilds it here; it replays with runward-fleet packed at that commit:

  | Archive sha256 | Commit of runward | Pinned here |
  |---|---|---|
  | `99e941a5ea915718e9a8254b00165042305772e3d228227b1cfeb9761b2aa2e9` | `5a9cdf08a76977f9b671662f562e98d332ccc95e` (and `2ab48025`, the same files) | 2026-11-06 to 2026-11-10 |
  | `fff950650d3ac666cc6b43cc731936fbda1f99fc76d9e02c44977691a4aa2337` | `d05b59742bf10f6bfe803a0caaa9a289cd272ab0` | 2026-11-10 to this record |
  | `addcaa2dce4e97c190754155f4e3cea48762a60de3678fb9ce802078c26f2f84` | `d05281492d724f09dfe821f0285571eacd3c540a` | from this record |

- **what the screens say of an index of an earlier archive: its own content, read by the pinned views, and nothing more.** The app adds no banner and rewrites nothing. Such an index gets at once what the views read from fields it already holds (a tile for every state, the applications refused first, each kind with its n / N); it has no grouping by text, so each refusal is shown alone, folded, until the tenant's next publication (an accepted upload, or a gesture that changes the set), which assembles with the new pin and carries `byText`. The page is then shorter than under the old pin and longer than the grouped one (7 090 px against 10 554 and 2 257, for 46 refusals at 1440 px);
- **the decision screen is still runward-fleet's reading, byte for byte** (`web/views/decision.js` is unchanged). The app's layer maps the six new roles (`web/app.css`, ADR-0019): the kinds separated by a line, the check's text on the code ground behind its fold, the list of refusals numbered behind the second fold, colours from `web/couche-runward-app.css` only, no green, no live blue; the rules of the role `location`, which the reading no longer carries, are removed;
- **the mission projections and the documents are not screens of the app.** `ui/mission.js` and `ui/documents.js` are installed with the archive (`fleetPin` checks them with the other files) and served by no route; the views' own list of routes did not change. Their screens are a later lot, which adds its files to the closed list (`MODULES`, `src/http/assets.js`) when it adds its screens;
- everything else of ADR-0021 holds: the archive digest names the build, a published index is never rebuilt or rewritten by a re-pin, the replay's rule and its three exits, `fleetPin`, the check of the tarball in both modes, and "a later re-pin is measured before it is recorded".

## Alternatives discarded

- **Stay at main@d05b597**: the three points the journal left open stay open, or are closed by a step in the app that rewrites the reading's HTML, which PADR-0011 forbids and which the test of the byte-for-byte reading refuses
- **Rebuild every published index with the new pin so every page is grouped at once**: discarded by ADR-0021 (it changes bytes the chained journal already names), and not needed: an old index is read without loss, and the next upload of each repository regroups it
- **Group an old index's refusals in the app until its next publication**: a second implementation of the grouping, beside the pinned one, for a state that ends at each tenant's next upload
- **Vendor the previous archive so the replay rebuilds old indexes here**: tempered by ADR-0021 into a trigger; the lock's chain now names each earlier archive with its commit, and one command packs it. Kept as the trigger below if the witness reader is switched on while a fleet's last index is an earlier archive's
- **Pin fe52f39, where PR #510 merged, rather than the head of `main`**: the same grouped reading and the mission projections, without the documents module. ADR-0021's trigger says a commit of `main` the product needs; the later lot needs `ui/documents.js` too, and the measure above shows that a module the app does not serve changes nothing it serves. Pinning the head saves that lot a re-pin

## Consequences

- **Positive**: the reading of an application with many refusals is about a fifth as tall (2 257 px against 10 554 at 1440 px, for 46 refusals), with every refusal still listed, one fold away; the portfolio lists what is refused first and says every state, `0 / N` included; "(en anglais)" is gone from the French label; the three points of the journal entry of 2026-11-11 are closed by the pinned package, not by the app
- **Negative, accepted**:
  - an index published before this pin shows its refusals one by one until its tenant's next publication; nothing tells the reader why two applications fold differently
  - an export taken before this pin, replayed with this repository at this pin, exits 2 with `not rebuilt here` for every index: the reader packs runward-fleet at d05b5974 to rebuild them. The export's `replay.json` still says "the runward-fleet version named"; for 0.46.0 the table above is where a digest finds its commit, now over three archives
  - the witness reader (`temoin.yml`) does not run on 2026-11-11: its last three scheduled runs were skipped (its job runs only when `RW_READER_ENABLED` is `true`). Switched on, a fleet whose last index an earlier archive built reads red, `same 0, not rebuilt here n`, until its next publication
  - after a rollback to an image of the previous pin, an index this pin published is `label-refused` by that image's replay (its lock does not know this archive) and is read by its views without the grouping
  - the tarball grows from 202 977 to 235 166 bytes, and the install carries two modules nothing imports yet
  - the fleet stylesheet served by the app gains the rules of the grouped reading; the app's layer overrides each of them for the roles the reading carries (`test/unit/decision.test.js` holds it, with planted controls)
- **On other boundaries**: `runward/contracts/index-assembler.md` names main@d0528149 and this record; `/api/version` serves the new commit as `runwardFleetCommit`, the new archive digest and the new digest of `views.js` (`110c75a0…`); the content security policy is unchanged (no script in the reading, the folds are `<details>`; the fleet stylesheet's only `url()` is still its inline grain); the API contract is unchanged; `runward-fleet-index/0` keeps its name and is read tolerantly, as before; ADR-0004 unchanged

## What would settle it

- **Confirms**: `node scripts/verify-runward-fleet.mjs` green in CI against main@d052814 (the 24 files are the pack of the commit, byte for byte, and nothing else is in the tarball); `test/unit/pin.test.js` green with the lock's chain of three archives; `test/unit/decision.test.js` green: on the five real exports the screen is the grouped reading (the kinds and texts counted from the export files themselves: 46 refusals, 42 / 46 in three texts of 22, 19 and 1, 4 / 46 in one), every refusal listed once (runward-fleet's own `checkRefusals` on the screen as painted), the first text alone open, the portfolio refused first with its five tiles; planted: an ungrouped reading (the same index without `byText`), a refusal removed, every text open, a wrong n / N, the portfolio in the inventory's order, a tile left out, each seen; `test/unit/assets.test.js` green: the two added modules served by no route, `views.js` importing nothing.
- **Reverses**: a refusal the grouped reading does not list, or lists twice (R6 of runward-fleet, held at build and here); a view the app shows that breaks on an index of an earlier archive; a file of the package the browser is asked for that is not on the closed list; or the author deciding that a re-pin must republish every tenant's index, which needs its own record, as ADR-0021 says.

## Reevaluation trigger (mandatory, dated)

Reopen when one of these is observed:

- the triggers of ADR-0021 that stand: an attested release of runward-fleet; a change of `packages/runward-fleet` the product needs, merged into `main` after d0528149 (re-pack at that commit, measured, in a new record); runward-fleet versioning its builds; a rollback across this pin while a tenant holds an index of it;
- the lot that shows the mission projections or the documents: it adds `ui/mission.js` or `ui/documents.js` to what the app serves, and says in its record what the closed list and the content security policy become;
- the witness reader is switched on (`RW_READER_ENABLED`) while a fleet it reads has, as its last index, one an earlier archive built: either that fleet publishes again first, or a record says how the reader rebuilds an earlier archive's index (the archive fetched by its digest, packed at the commit the lock names);
- a tenant reports that two of its applications fold their refusals differently: say on the screen that the grouping comes with the next check received, in the service's own lexicon.

**Trigger set on**: 2026-11-11 · **Watched via**: `scripts/verify-runward-fleet.mjs` in CI; the service's start, which `fleetPin` refuses on another install; the witness reader's summary once it runs; `test/unit/assets.test.js` (a file of the package served off the list); the release page of runward

## References

- ADR-0021 (refined), ADR-0018, ADR-0002, ADR-0004, ADR-0019; PADR-0011 points 4 and 6
- stranxik/runward PR #510 (ADR-0128 of runward, the grouped decision reading), PR #500 (ADR-0126, the mission projections), PR #509 (ADR-0127, the documents), merged into `main`, the last at d05281492d724f09dfe821f0285571eacd3c540a
- `vendor/runward-fleet.lock.json`, `scripts/verify-runward-fleet.mjs`, `scripts/replay-export.mjs`, `src/adapters/fleet/assembler.js` (`fleetPin`), `src/http/assets.js`, `web/app.css`, `web/views/decision.js`, `runward/contracts/index-assembler.md`
- `test/unit/decision.test.js`, `test/unit/pin.test.js`, `test/unit/assets.test.js`
