# ADR-0002: runward-fleet is pinned by a vendored npm-pack tarball of a git commit, verified file by file

**Date**: 2026-11-06
**Status**: accepted (2026-11-08), ratified on the author's delegation in chat ("ratifie pour moi", "ratify for me"), the session having recommended it; the author did not read this text again before delegating
**Deciders**: proposed by an agent session; Thibault Souris (author) decides.
**Method**: decision-loop

## Context

runward-fleet is `private` (not on npm). The product needs the version of PR #496 of runward (branch `integration/2026-11-06-c`, still open): first at `da888958fbee6557338a5d3d12e7992c66cc13a9` (it adds `./site`, the golden test and `commitSource`), then, from 2026-11-06, at `2ab48025a1afba94dfdf9f6d2e052bf2f00b5753`, whose views name `level-not-met` « niveau non atteint » in French and "level not met" in English (the author's rule of the same day; the hosted app and the exported view must say the same). npm cannot install a package from a subdirectory of a git repository, and no release asset of runward-fleet exists yet. On 2026-11-10 PR #496 merged into `main` at `5a9cdf08a76977f9b671662f562e98d332ccc95e`; `packages/runward-fleet` is identical at `2ab48025` and at `main@5a9cdf0` (empty `git diff` of that directory), so the pin moves to the commit of `main`, which no branch deletion or force-push of the integration branch can take away.

## Decision

The package is packed at that commit (`npm pack` of `packages/runward-fleet`, reproducible: two packs give the same sha256) and committed as `vendor/runward-fleet-0.46.0-<commit>.tgz` (today `vendor/runward-fleet-0.46.0-5a9cdf08.tgz`, packed at `main@5a9cdf0`); `package.json` depends on it by `file:`; `package-lock.json` pins its sha512 integrity; `vendor/runward-fleet.lock.json` names the repository, the path, the commit, the tarball sha256 and the integrity. `scripts/verify-runward-fleet.mjs` checks offline that the tarball and the lockfile pin the same bytes, and in CI that every file in the tarball is byte for byte the file at that commit on GitHub (22 files today), with a floor of ten files so the guard cannot pass empty. A re-pin replaces the tarball, the lockfile and `package-lock.json` together, and the lock names the previous pin and why it changed. The re-pin of 2026-11-06 changed `ui/views.js` only, `src/build.js` is the same, so every index the previous pin built replays to the same bytes. The re-pin of 2026-11-10 (`2ab48025` to `main@5a9cdf0`) changed no file: `npm pack` at `main@5a9cdf0` gives the same tarball (sha256 `99e941a5…a2e9`, same integrity), the 22 files are proven against `main@5a9cdf0` on GitHub, the export replay test rebuilds every published index byte for byte, and the served views still say « niveau non atteint » and "level not met"; each published index also records the archive digest that built it. `/api/version` serves the version, the commit, the archive digest and the digest of the `views.js` served.

## Alternatives discarded

- **A git dependency by SHA**: npm does not install a subdirectory of a repository
- **Copying `views.js` and `build.js` into this repository**: a copy drifts; PADR-0011 forbids it
- **A GitHub release asset verified with `gh attestation verify`**: the target of PADR-0011 point 6; no release of runward-fleet exists yet. This ADR is the interim, and is superseded when the first release is attested

## Consequences

- **Positive**: the code that builds and shows the index is exactly the code at a reviewed commit, checked in CI without trusting the tarball
- **Negative, accepted**: the tarball is binary in the tree (184 kB); a new version is a new commit of this repository
- **On other boundaries**: ADR-0005 (the assembler), ADR-0009 (`/api/version`)

## Reevaluation trigger (mandatory, dated)

Reopen when runward-fleet publishes an attested release, or when the product needs a change of `packages/runward-fleet` merged into `main` after 5a9cdf08 (re-pack at that commit of `main`, never at a branch head). The trigger of 2026-11-06 (PR #496 merging) fired on 2026-11-10 and was answered by the re-pin at `main@5a9cdf0`.

**Trigger set on**: 2026-11-06, renewed 2026-11-10 · **Watched via**: `scripts/verify-runward-fleet.mjs` in CI

## References

- PADR-0011 point 6
- stranxik/runward PR #496, heads da888958 then 2ab48025, merged into main at 5a9cdf08a76977f9b671662f562e98d332ccc95e (main@5a9cdf0)
