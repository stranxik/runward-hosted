# ADR-0021: runward-fleet re-pinned at main@d05b597, the commit where PR #499 merged; the archive digest, not the version, names the build (refines ADR-0018)

**Date**: 2026-11-10
**Status**: proposed (written by an agent session; acceptance is the author's)
**Refines**: ADR-0018 (accepted 2026-11-10), which stays in force for everything this record does not change; through it, ADR-0002
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: reality-check (the two commits of runward, the two tarballs, the same inputs built by each pin, an export archive of each pin replayed by the other), challenge, durable position

## Context

ADR-0018 pins runward-fleet at main@5a9cdf0 and names its trigger: "when the product needs a change of `packages/runward-fleet` merged into `main` after 5a9cdf08 (re-pack at that commit of `main`, in a new record that refines this one)". On 2026-11-10 PR #499 of runward merged into `main` at `d05b59742bf10f6bfe803a0caaa9a289cd272ab0` (main@d05b597). It adds the decision reading (ADR-0125 of runward): `decide(index)` and `renderDecision(index, id?)` in `runward-fleet/views`, which the app's next lot needs. The trigger fired.

Unlike the re-pin of ADR-0018, this one changes code. Between 5a9cdf08 and d05b5974, `packages/runward-fleet` changed in `src/build.js`, `src/rules.js`, `src/site.js`, `ui/template.html`, `ui/views.js` and `README.md` (930 lines added, 37 removed). `package.json` did not change: **the version stays 0.46.0**. The build now projects more of a check export (the refusals by kind, with their line and phase; the rows by how they were endorsed; what agents endorsed, by agent, person and mode), groups the verdicts in five states instead of four (`not-available`, a mission received as a digest only), and reads two new options of `fleet.json` (`names: "omitted"`, an export declared by its digest alone).

What was measured on 2026-11-10, before deciding:

| Measure | Result |
|---|---|
| `npm pack` at 5a9cdf08, as a control | sha256 `99e941a5…a2e9`, the tarball of ADR-0018, reproduced |
| `npm pack` at d05b5974, twice | sha256 `fff950650d3ac666cc6b43cc731936fbda1f99fc76d9e02c44977691a4aa2337` both times; 202 977 bytes; the same 22 files |
| the app's fixtures, three published indexes, the same `fleet.json` and exports built by each pin | different bytes each time: 34 963 → 41 563, 66 482 → 79 580, 66 491 → 79 589 bytes |
| what differs | every field of the old index is in the new one with the same value; fields are added (`latest.conformanceByKind`, `latest.conformance[].line` and `.phaseId`, `latest.ratification.agent`, `.agents`, `.singleAccountable`, `.byMode`, `.agentRows`) and `fleet.byVerdict` gains a fifth group |
| a fleet with no mission, and one with a mission and no export | different bytes too (the fifth group of `fleet.byVerdict`): no index keeps its bytes |
| runward's own golden index, committed at each commit | the same: no value changed, none removed, the same fields added |
| an export archive made by the app under the old pin, replayed by `scripts/replay-export.mjs` under the new pin, as it was at `9e7fadf` | `different` for the three indexes, exit 1: the script matched on the version, and the version did not move |
| the same archive replayed by the old pin; an archive of the new pin replayed by the new pin | `same` three times, exit 0, both |
| an index of the old pin read by the new views (11 views, strict) and by the new `checkIndex` | every view renders, no rule broken |

So a version of runward-fleet no longer names one build: 0.46.0 is two archives, and the indexes they build from the same inputs differ. The export's `replay.json` promises, for each published index, "run `runward-fleet build fleet.json` with the runward-fleet version named, and compare the sha256 of index.json"; it also records `runwardFleetArchiveSha256`, the digest ADR-0002 put on each published index. Only that digest still tells which build replays an index.

Production holds no published index on 2026-11-10 (the service went live that day without tenant data, as the operator reports; this session did not read production). The record says what happens in general.

The decision is taken at the same boundary as ADR-0002 and ADR-0018: the IndexAssembler adapter, its supply chain, and the export's replay.

## Decision

The pin of runward-fleet rests on **main@d05b597**, and an assembler is named by its archive digest, never by its version alone:

- the tarball is `vendor/runward-fleet-0.46.0-d05b5974.tgz`; `package.json` and `package-lock.json` name it; `vendor/runward-fleet.lock.json` pins `ref` `main`, `commit` `d05b59742bf10f6bfe803a0caaa9a289cd272ab0`, the sha256 above and its integrity, and names the previous pin (`5a9cdf08`, archive `99e941a5…`) and why it moved. The previous tarball leaves the tree: nothing installs it, `npm pack` at 5a9cdf08 gives it again (the control above), and git keeps it;
- **a published index is never rebuilt or rewritten by a re-pin.** It keeps its bytes, its digest and the archive digest recorded on it; the journal's entries that name it stay true. A tenant's next publication (an accepted upload, or a gesture that changes the set) assembles with the new pin and is a new version;
- **the replay matches an index only with the archive that built it.** `scripts/replay-export.mjs` compares the `runwardFleetArchiveSha256` of each entry with the archive pinned in `vendor/runward-fleet.lock.json`: another archive is reported `other-archive`, never rebuilt, never said `different`. When nothing could be rebuilt the script exits 2 (cannot tell), and the witness reader does not pass. Such an index replays with runward-fleet packed at the commit its digest names:

  | Archive sha256 | Commit of runward | Pinned here |
  |---|---|---|
  | `99e941a5ea915718e9a8254b00165042305772e3d228227b1cfeb9761b2aa2e9` | `5a9cdf08a76977f9b671662f562e98d332ccc95e` (and `2ab48025`, the same files) | 2026-11-06 to 2026-11-10 |
  | `fff950650d3ac666cc6b43cc731936fbda1f99fc76d9e02c44977691a4aa2337` | `d05b59742bf10f6bfe803a0caaa9a289cd272ab0` | from this record |

- **the decision reading is importable, and is not a screen of the app.** `decide` and `renderDecision` come with the pinned views; the app's router leaves the views' new `decision` route out (`FLEET_ROUTES` in `web/app.js`), so the route answers like any unknown one. Showing it is another lot, with its own design;
- the adapter is unchanged: it writes neither `names` nor an export declared by its digest alone, so a hosted index carries no `names` field and its `not-available` group is always empty (ADR-0004 holds);
- **a later re-pin is measured before it is recorded**: the same inputs built by both pins, and an archive of the old pin replayed by the new one; its record says whether the bytes change. Everything else of ADR-0002 and ADR-0018 holds: the pack, a commit of `main` only, the offline and online checks with their ten-file floor, `/api/version`.

## Alternatives discarded

- **Stay at main@5a9cdf0**: the decision reading is then out of reach of the app, or copied into it, which PADR-0011 forbids
- **Rebuild every published index with the new pin when it lands**: it would change bytes the chained journal already names, and an export taken before the re-pin would no longer describe the service; an old index is true as published
- **Keep both tarballs in `vendor/` so the replay rebuilds old indexes here**: npm installs one archive under one name; a second copy under an alias doubles the supply chain to verify, for indexes that do not exist in production today. Tempered: it is the trigger below if a tenant ever holds indexes of two archives
- **Wait for runward-fleet to change its version with its build**: the right repair, and upstream's to make; the digest is already recorded on every index, so this record does not wait for it
- **Patch the vendored views** (their credit of fonts, their new section in Sources): the vendored files are the files at the commit, checked one by one; a patch is a copy that drifts

## Consequences

- **Positive**: the next lot can show the decision reading from the pinned package; a replay can no longer call an untouched index `different` because the assembler moved under the same version; the check is in the tool, not in a reader's memory
- **Negative, accepted**:
  - the export's `replay.json` (`how`), its README and the app's screens still say that the runward-fleet version named rebuilds an index. For 0.46.0 that is no longer enough: the entry carries the archive digest, not the commit. Until upstream versions its builds, the table above is where a digest finds its commit
  - a fleet whose indexes were all built by another archive reads red at the witness reader (nothing replayed is never a pass) until its next publication. No such fleet exists on 2026-11-10
  - the Sources view, which the app shows, comes from the vendored views as is: it credits Inter and Departure Mono, while the app serves Geist and Geist Mono since its own layer (ADR-0019, proposed); and it gains a section on the rules of the decision reading, a reading the app does not show yet. Both are noted, not patched
  - the fleet stylesheet served by the app gains the rules of the decision reading. Measured: the seven views the app shows carry none of the roles those rules select
  - the tarball grows from 184 349 to 202 977 bytes
- **On other boundaries**: `runward/contracts/index-assembler.md` names main@d05b5974 and the replay's rule; `/api/version` serves the new commit as `runwardFleetCommit`, the new archive digest and the new digest of `views.js` (`56b75208…`); `runward-fleet-index/0` keeps its name and is read tolerantly, as before; ADR-0004 unchanged

## What would settle it

- **Confirms**: `node scripts/verify-runward-fleet.mjs` green in CI against main@d05b597 (22 files identical); the export replay test green, with its new case (an entry of the previous archive is `other-archive`, the others `same`; without the pinned digest the old behaviour, as a planted control); the test that the decision route is left out and that `/api/version` serves the lock's commit and digest.
- **Reverses**: a file of the tarball that differs from main@d05b597 on GitHub (the check fails closed); a view the app shows that breaks on an index of the previous archive; or the author deciding that a re-pin must republish every tenant's index, which needs its own record (a journaled gesture, and what the export then says of the versions before).

## Reevaluation trigger (mandatory, dated)

Reopen when one of these is observed:

- runward-fleet publishes an attested release (the trigger of ADR-0002, which stands);
- the product needs a change of `packages/runward-fleet` merged into `main` after d05b5974 (re-pack at that commit, measured, in a new record that refines this one);
- runward-fleet changes its version whenever its build changes: the version names the build again, and the replay's sentence can be the version's;
- a re-pin is about to land while a tenant holds a published index: decide then, in a record, how an index of an earlier archive is replayed here (a second archive fetched by its digest) and what the screens say of it.

**Trigger set on**: 2026-11-10 · **Watched via**: `scripts/verify-runward-fleet.mjs` in CI; `scripts/replay-export.mjs` in the witness reader (an `other-archive` in its record); the release page of runward

## References

- ADR-0018 (refined), ADR-0002, ADR-0004, ADR-0019; PADR-0011 points 4 and 6, note 6 bis
- stranxik/runward PR #499, merged into `main` at d05b59742bf10f6bfe803a0caaa9a289cd272ab0; ADR-0125 of runward (the decision reading)
- `vendor/runward-fleet.lock.json`, `scripts/verify-runward-fleet.mjs`, `scripts/replay-export.mjs`, `runward/contracts/index-assembler.md`
