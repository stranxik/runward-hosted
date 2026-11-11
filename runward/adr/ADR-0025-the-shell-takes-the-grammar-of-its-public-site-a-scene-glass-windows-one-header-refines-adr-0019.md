# ADR-0025: The shell takes the grammar of its public site, a scene, glass windows, one header, the haze drifting on the sign-in only (refines ADR-0019)

**Date**: 2026-11-11
**Status**: proposed (written by an agent session; the author validated the mock-up of all states on 2026-11-11 and decided its four open points in chat the same day; this record awaits his acceptance)
**Refines**: ADR-0019 (accepted 2026-11-10), which stays in force for everything this record does not change: the layer alone holds every colour, font, letter spacing and radius; a state is said by a shape, a word, then a hue; no green; the blue is the live state only
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: the mock-up of every state of the shell in the site's design, built from the real lexicon and the real layer and verified at 1440, 390 and 360 px in both themes; the author's review of it on screen; the same checks replayed on the real app (the real server, the in-memory store); durable position

## Context

ADR-0022 put the public site at `/` and the shell at `/app`, on the same layer. The two did not read as one product: the site stands on a scene (a warm haze, a grid of dots, a grain), shows its content in glass windows with three dots and a title in the mono, and uses a display type; the shell was flat panels with 8 px corners, a relevé in capitals at the head of each screen, and three different headers (the decision reading's bar, the top bar of a phone, none on the other signed-in screens). The author's words for the goal: runward is very technical, working with it must feel soft and pleasant.

ADR-0019's layer comment said "no entrance animation in the app" and kept one loop, the loading line; `test/unit/tokens.test.js` held it. The site's haze drifts.

The author decided four points on the mock-up (2026-11-11): the refusals of a reading are folded by default, the line that names their detail being the button that unfolds them, the counts by kind staying visible above; the titles of the panels beside a reading are in their window's bar, in the mono; the haze is calm and fixed behind a screen of data, and drifts on the sign-in only; the motion tokens of the mock-up belong to the app's layer, not to the family's structure (ADR-0027 holds that one).

## Decision

1. **The scene is the ground of every screen** (`web/index.html`, `.scn`): the site's haze, dots and grain, with the layer's values. Behind a screen of data it is calm: pale (`--nue-a-calme`: .20 in light, .22 in dark), at the top right, and it does not move. The sign-in alone carries the whole scene: the haze drifts behind its window and the grid of dots drifts with it; both stop under reduced motion. Six tokens are added to the layer for it: `--nue-a-calme`, and the periods of those two drifts, `--nue-d1` to `--nue-d4` (24, 30, 27 and 36 s, the four lobes of the haze) and `--pts-d` (46 s, the dots); the curve is the loading line's (`--ease-load`). On the sign-in the text stands above the haze.
2. **What is read for minutes lies on a sheet**, nearly opaque (a list, a journal, a table of settings); what is said once stands in a glass window of the site (the tiles of the portfolio, a reading, « Vérifier par vous-même », the open step of the arrival, the counters of the dashboard, « Partir avec vos données »). A window's bar carries its title or its relevé, in the mono.
3. **One header on every screen**: signed out, the brand, the host, the language and the theme; signed in, the screen's title or its trail, the language and the theme, and on a phone the brand and the menu. The sidebar is translucent, the scene seen through it. The switch of language is the frame's, on every screen.
4. **The reading is laid out by the layer, never rewritten**: runward-fleet's HTML is served byte for byte (`test/unit/decision.test.js` still compares it); `web/app.css` maps its roles and places its parts (the line « Mis à jour le… », the app's, is the bar of the window that holds runward-fleet's tiles; runward-fleet's own way back is the bar of an application's window). The refusals are folded by default, the counts by kind staying in view: with the grouped reading of the pinned runward-fleet (ADR-0024), the fold is runward-fleet's own `<details>`, whose summary « Où, refus par refus » the layer draws as the button that unfolds the list. The shell changes neither a byte nor an attribute of the reading.
5. **The loops of the app's stylesheet are the loading line and the scene of the sign-in** (the four lobes of its haze and its grid of dots), and nothing else. `test/unit/tokens.test.js` is changed to say so, not removed: the animations it allows are `charge`, `nue-a`, `nue-b`, `nue-c` and `pts`; every animation of `web/app.css` loops (an entrance would play once); each belongs to the sign-in's scene or to the loading line; none moves the haze behind a screen of data; all stop under reduced motion. An entrance planted on purpose and a drift planted behind a screen of data are seen.
6. **Controls are the site's**: pills, the round theme switch, the underlined link for a gesture said as a link. The relevé in capitals at the head of a screen becomes the site's opening line, without capitals. On a phone the reading follows the mock-up's sizes (15 to 17 px), which replace the 17 to 20 px of the first reading (the pivot of 2026-11-10): the author validated the 390 and 360 px captures.

## Alternatives discarded

- **Rewriting the reading's HTML in the app** to get the windows: it would no longer be what `runward-fleet build` writes for the same index, which is the reading's claim.
- **The haze everywhere, drifting**: a screen of data is read for minutes; a moving ground behind it tires and lowers the measured contrast of the secondary ink.
- **Glass for every list**: a journal of twenty lines on glass over a haze reads worse than on a sheet; the mock-up's reviewers measured it.
- **Keeping the 2 px or 8 px flat panels with the site's header only**: two grammars on one address.

## Consequences

- **Positive**: one product from `/` to `/app`; one header and one language switch; the windows carry what was a heading; a refused application reads as its counts by kind, its 46 refusals behind a fold.
- **Negative, accepted**: translucent surfaces (`backdrop-filter`) cost paint on a slow machine (measured with the motion, ADR-0027); the contrast of a text on the scene must be measured on the render, not computed from two tokens (the witness does); the first block of the check's text of a page is open, as runward-fleet writes it.
- **On other boundaries**: the reading's roles keep one delimited section, the last of `web/app.css`, so that a change of the pinned runward-fleet touches it alone; it styles the grouped refusals of runward-fleet at `d052814` (ADR-0024). The content security policy is unchanged (no inline script or style element; the scene's grain is a data URL in the stylesheet, as the site's). The public home's dead pieces in the shell (its links, its actions, its menu) are removed with their words.

## What would settle it

- **Confirms**: on the real app, every screen at 1440, 390 and 360 px, in French and English, light and dark: no horizontal overflow, no text under 12 px, AA on every text measured on the render, no overlap, no console error, no CSP violation, no request off origin; the author reads the app as the site's.
- **Reverses**: the author finds a screen of data harder to read on the scene (then the scene stays on the sign-in and the frame, sheets take the whole column); a measured contrast under AA that the calm haze causes.

## Reevaluation trigger (mandatory, dated)

Reopen on 2026-11-19 on what was observed at the stand on 2026-11-18, or earlier: the pinned runward-fleet changes the reading's structure beyond its roles; the house's common layer (ADR-0026) changes a value the scene uses.

**Trigger set on**: 2026-11-11 · **Watched via**: `test/unit/tokens.test.js`, `test/unit/decision.test.js`, `test/unit/frame-lang.test.js`, the static witness on the real server

## References

- ADR-0019 (refined by this record), ADR-0022 (the site at `/`, the shell at `/app`), ADR-0024 (the grouped reading), ADR-0027 (the motion)
- The mock-up of 2026-11-11 and its motion reference (the author's working folder; not in this repository)
