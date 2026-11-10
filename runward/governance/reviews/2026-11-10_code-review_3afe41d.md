# Adversarial code review: runward-hosted PR #12, `chore/repin-runward-fleet-d05b597`

Reviewer: a second AI agent (Claude Fable 5.2, read-only reviewer agent) that wrote none of this code. Thibault Souris, the author, is accountable for it.

*Integrating note*: the reviewer's role is read-only, so it returned this report in its final message and the integrating session saved it here. Findings and the final JSON are as returned; the planted controls and "checked with no finding" are kept in full. C40 to C42 are fixed on this branch before merge.

- **Commit**: `3afe41dcd64127e934500941d28dec8c8f42b0d2`, diff `9e7fadf..3afe41d` (5 commits, 15 files).
- **Outcome**: nothing blocks. The vendored tarball is exactly the package at `d05b5974`: I re-packed it and got the same sha256. Three findings should be fixed (C40, C41, C42) and three are notes (C43, C44, C45).
- **Advisory only**: this review gates nothing.

## Method

- Read the diff in full, plus `scripts/verify-runward-fleet.mjs`, `src/adapters/fleet/assembler.js`, `src/http/assets.js`, the CSP in `src/http/server.js`, `src/application/reading.js` and `context.js`, `temoin.yml`, the `Dockerfile`, and the upstream diff `5a9cdf08..d05b5974` of `packages/runward-fleet`.
- Suites on the NAS in the reference environment (Node.js v22.23.4, jq 1.7.1, PostgreSQL 17.11): `npm test` 203/203, `npm run test:pg` 20/20, lint exit 0, `check-workflows` exit 0, `test:reports` exit 0 (223 cases), `verify-runward-fleet.mjs` online and offline exit 0.
- The Mac ran only the re-pack, one `npm install` of a planted tarball in an empty project, and a 30-line script on two extracted packages. Attacks and controls used throwaway scripts, never committed.

## Supply chain: reproduced

- Clean clone of the upstream repository at `d05b59742bf10f6bfe803a0caaa9a289cd272ab0`, the head of `main` on its first-parent line, directly after `5a9cdf0`.
- `npm pack` in `packages/runward-fleet`, twice: sha256 `fff950650d3ac666cc6b43cc731936fbda1f99fc76d9e02c44977691a4aa2337` both times, 202 977 bytes, 22 files: the sha256 of `vendor/runward-fleet-0.46.0-d05b5974.tgz`. Its sha512 is the `integrity` of the lock and of `package-lock.json`, which changes only the entry of runward-fleet.

## Findings

### C40 — should-fix — `scripts/verify-runward-fleet.mjs:29-32` (and its header, lines 5-6)

The online check can be satisfied by a tarball that npm installs as other code: it compares only the files under `package/`, while npm strips the first path component of every entry, whatever its name.

- **Failure scenario**: a re-pin carries a tarball with the genuine `package/` tree plus a second root such as `zz/src/build.js`, and a lock updated to its digests. The check reads the genuine files and exits 0; `npm ci` writes `zz/src/build.js` over `src/build.js`.
- **Reproduction** (Mac, throwaway folder): genuine `package/` minus `LICENSE`, plus `zz/src/build.js` with one planted line, lock set to its digests: the check printed `21 files … are the files of packages/runward-fleet at d05b5974…`, exit 0; `npm install --ignore-scripts` of it gives the planted `src/build.js` and no `LICENSE`.
- The header's promise that "no file of the package's `files` at that commit is missing from the tarball" is not implemented; a missing file passes down to the floor of ten.
- **Suggested fix**: list the archive's entries and refuse any entry outside `package/`, any link, any duplicate; compare the list of names with the tree at the commit filtered by `files`, or pin the file count in the lock; or re-pack at the commit and compare the sha256.

### C41 — should-fix — `scripts/replay-export.mjs:25`, `scripts/witness-reader.mjs:24-36`

The label that takes an index out of the comparison is declared by the service being witnessed, and any value works: an index that is not the last one passes the witness reader unjudged when its entry names the previous archive, no archive, or an unknown one.

| Entry of version 1 (bytes changed) | States | CLI exit | Witness rule |
|---|---|---|---|
| label pinned | different, same | 1 | red |
| label previous archive | other-archive, same | 0 | pass |
| label absent | other-archive, same | 0 | pass |
| label `x` | other-archive, same | 0 | pass |
| version `0.45.0` (path that existed before) | other-version, same | 0 | pass |

- **What holds**: the last index cannot hide this way; with every entry labelled, the CLI exits 2 and the witness is red.
- **Suggested fix**: accept as `other-archive` only a digest the lock knows (the pinned one and its `previous` chain), anything else its own state and never a pass; count the entries not rebuilt in the summary and go red when one is more recent than a `same` entry; cross-check each entry's label with the chained journal, whose publication entries carry `fleetArchiveSha256` (`src/application/context.js:95`).

### C42 — should-fix — `src/adapters/fleet/assembler.js:26-28`

The archive digest recorded on every index is read from the lock file, tied to what is installed only by the version, which ADR-0021 says no longer names a build.

- **Reproduction** (NAS, K7): the previous tarball extracted over `node_modules/runward-fleet`, lock untouched: `verify --offline` exit 0; `fleetPin` accepts; an export built in that state is labelled `fff95065` and replays `different` after the install is restored.
- **What holds**: the production image installs by `npm ci` against the lock's integrity, and CI runs the verify.
- **Suggested fix**: in `fleetPin`, compare the `integrity` of `node_modules/.package-lock.json` for `node_modules/runward-fleet` with the lock's, and refuse to start otherwise.

### C43 — note — `scripts/witness-reader.mjs:36`

The summary still says `DIFFERENT` for a fleet whose indexes were all built by another archive, and after a rollback to an image of the previous pin the witness is red with the wrong cause. Suggested fix: three words with counts (same, different, not rebuilt here), and the rollback in ADR-0021's triggers.

### C44 — note — `scripts/replay-export.mjs:44-46`, `scripts/witness-reader.mjs:24`, `test/unit/http.test.js:166-171`

Four guarantees are held by no test (controls left the suites green): exit code 2 (K4), the witness reader passing the pinned digest (K5), the router refusing `decision` (K2), `/api/version` serving the installed archive's digest (K6). Suggested fix: a test that spawns the CLI on three archives; the witness rule as an exported, tested function; the router test calling `resolve`.

### C45 — note — `runward/adr/ADR-0021-…md:41, 66, 74, 85`

Line 74 ("the check fails closed") does not hold for C40; line 41 is untested (C44) and its "never said `different`" does not hold for the summary (C43); line 85's watch is in the JSON only (C41); line 66 says ADR-0019 proposed, accepted on main since `c94995d`. ADR-0020 is in PR #8, which empties index bytes on erasure: "a published index … keeps its bytes" will need its exception once both land.

## Planted controls

| Control | Mutation | Result |
|---|---|---|
| K1 | `resolve()` reads `ROUTES.includes` again | red |
| K2 | `resolve()` also accepts `ROUTES.some((r) => r === route)` | green: not caught (C44) |
| K3 | the `other-archive` line of `replay()` disabled | red |
| K4 | the CLI's exit line of `9e7fadf` put back | green: not caught (C44) |
| K5 | the witness reader calls `replay` without the pinned digest | green: not caught (C44) |
| K6 | one digit of the lock's `tarballSha256` changed | tests green; `verify --offline` exit 1 |
| K7 | `node_modules/runward-fleet` holds the previous archive | `verify --offline` exit 0, `fleetPin` accepts; red only through a missing export (C42) |
| K8 | tarball with a second root and a missing file, lock updated | `verify` online exit 0; npm installs the planted file (C40) |

## Checked with no finding

- The tarball, the lock, the integrity: reproduced.
- Replay, the cases the PR was written for: genuine archive `same, same`, exit 0; one entry of the previous archive `other-archive, same`, exit 0; every entry of the previous archive exit 2 and witness red; a changed index under the pinned label `different`, exit 1.
- Nothing relies on exit code 1 of `replay-export.mjs`.
- `#/decision` reaches no branch of `resolve()`; the seven views shown hold no link to it.
- CSP and the asset list: no new asset, no network call, storage access or import in the upstream diff; no `url(`, `@import` or `@font-face` in the new style rules; `script-src 'self'` and `style-src-elem 'self'` unchanged.
- No style collision: the new rules select attributes the app's screens do not use; the custom properties they read are defined by the app's layer.
- Data shown to a tenant: the index projects, from the tenant's own export, the name an agent declared it answers to, served behind the tenant's session, a class `runward/execution-topology.md` already covers; `not-available` cannot appear.
- An index of the previous archive read by the new code: no value changed, `checkIndex` finds 0 problem, the 11 views render in strict mode.
- ADR-0021's figures confirmed; ADR-0018 not edited; ADR-0021 `proposed`; `runward/contracts/index-assembler.md` describes the code.

```json
{"commit":"3afe41dcd64127e934500941d28dec8c8f42b0d2","blocking":[],"should_fix":["C40","C41","C42"],"notes":["C43","C44","C45"]}
```
