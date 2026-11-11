# ADR-0026: The app's layer is the house's visual base; runward keeps its own signs; the house signs the foot

**Date**: 2026-11-11
**Status**: proposed (written by an agent session; it adopts here a decision the author accepted on 2026-11-11 for all his products, recorded outside this repository; this record awaits his acceptance)
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: the house's decision read in full; this repository's layer, structure file and tests read against it; durable position

## Context

The author decided on 2026-11-11 that his products are endorsed brands of one house, Another Framework: each keeps its name, its domain and its tone, and all carry the same discreet signature in their foot. The same decision takes the style of this app (and of the site it serves) as the house's visual base: Geist and Geist Mono self-hosted, light and dark, neutral greys with ink as the only emphasis, negative letter spacing on titles, the 15 / 14 / 13 px scale with nothing under 12 px, pills of 34 px, radii from 6 to 14 px, states said by a shape, a word, then a hue, never a green, the blue kept for what is live, sober motion, no brand colour. Each product writes its own record of adoption; this is runward hosted's.

What is so here: `web/couche-runward-app.css` holds those values (ADR-0019), and the house's base was read from it. `web/famille.css` is this repository's copy of the family's structure of 2026-11-06 (type scale, grid, control heights, the productive curve and durations, focus); the radii are in the layer, not in it.

## Decision

1. **The base stays where it is.** `web/couche-runward-app.css` remains the one file that holds every value of this app (ADR-0019); it is the reference the house's common layer was read from, and it is not replaced by an import of that layer: this repository serves a closed list of its own files (`src/http/assets.js`), calls no third party, and its token test audits the file it serves. A value the house changes later arrives here as a change of this file, under that test.
2. **`web/famille.css` and the layer keep everything they carry today**, the radii included (`--r-pill`, `--r-panel`, `--r-thumb`, `--r-notice`, `--r-win`, in the layer): the house's own structure file was reduced since 2026-11-06 and no longer carries all of it; this copy is not re-synchronised downwards. A drift between the two is read, never applied blindly.
3. **runward keeps its own signs**: its lexicon of states (Rien ne bloque, Refusée par le contrôle, Niveau exigé non atteint, Aucun contrôle reçu, and their shapes and hues), its window « Lecture du contrôle », its logo. No accent is added: the app has none (ADR-0019, point 8).
4. **The signature**: « runward, par Another Framework » in French, "runward, by Another Framework" in English, the words Another Framework linking to `https://anotherframework.dev/studio.html`; "runward" always in lower case. It stands in the foot of the shell (the lexicon, the same key in both languages) and in the foot of the public site and each of its pages (`web/site/gabarit.html`; the 325th text of `web/site/textes_fr_en.tsv`), in the ink and at the size of the foot's other links, with no logo and no colour. The link is a plain navigation: the page loads nothing from that address, and the content security policy is unchanged.

## Alternatives discarded

- **Importing the house's layer file** in place of this one: a second source of values, outside the served list and outside the token test.
- **A logo of the house in the foot**: the decision says discreet; a second mark beside runward's would compete with it.
- **Re-synchronising `web/famille.css` on the house's reduced file**: it would remove values this app's stylesheets read.

## Consequences

- **Positive**: the family reads as one; nothing changes in what this app serves or calls; the public site changes by one line of its foot and one text.
- **Negative, accepted**: two styles of runward coexist until runward.dev takes this one; this repository's copy of the structure and the house's file differ by design, which a reader must know before comparing them.
- **On other boundaries**: the public repository names the house, which is the author's own; no third party is named.

## What would settle it

- **Confirms**: `test/unit/site.test.js` compares 325 texts, text for text; `test/unit/frame-lang.test.js` reads the signature in both languages; the witness shows it on every screen, in the foot's ink.
- **Reverses**: the author moves the signature elsewhere, or changes its words for all products.

## Reevaluation trigger (mandatory, dated)

Reopen when the company Another Framework is created, when runward.dev takes this app's style, or when the house's common layer changes a value this layer holds.

**Trigger set on**: 2026-11-11 · **Watched via**: `test/unit/site.test.js`, `test/unit/frame-lang.test.js`, `test/unit/tokens.test.js`

## References

- ADR-0019 (the app's layer), ADR-0022 (the public site), ADR-0025 (the shell in the site's grammar)
- The house's decision of 2026-11-11 (the author's records, outside this repository)
