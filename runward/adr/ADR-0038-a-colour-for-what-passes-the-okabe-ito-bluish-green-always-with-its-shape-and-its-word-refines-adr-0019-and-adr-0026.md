# ADR-0038: A colour for what passes: the Okabe-Ito bluish green, always with its shape and its word (refines ADR-0019 and ADR-0026)

**Date**: 2026-11-12
**Status**: proposed (written by an agent session; it records a decision the author took in chat on 2026-11-12 for this product; this record awaits his acceptance)
**Refines**: ADR-0019 (accepted 2026-11-10, the app's own layer), on its point 4 (« Nothing is blocking: a filled circle in ink, no green. Never a red and green pair. Text stays in ink ») and on its discarded alternative « Green for "nothing is blocking" »; everything else in it stays in force. ADR-0026 (proposed, the house's visual base), on the one rule of the house it adopts here that this record changes for this product: « never a green »
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: the author's critique of 2026-11-12, read against the screens as built (ADR-0035, ADR-0036); the layer, the stylesheets, the views and the token test read; the dataviz skill's palette validator (`validate_palette.js`) run on the four state hues together, all pairs, on both surfaces of both themes; the WCAG contrast of the passing word measured; the screens witnessed on the real service (in-memory store, one headless Chrome, 1440 and 390 px, light and dark)

## Context

ADR-0019 said a state three times, by a shape, a word, then a hue, and left « Rien ne bloque » without a hue: a filled circle in ink, because « a green reads as a go, which the reading never gives, and it pairs with red ». The house's rules (ADR-0026) carry the same line for every product: never a green.

On 2026-11-12 the author read the app as built and said: « quand on dit c'est vert, y'a rien de vert à l'écran… c'est aussi un truc que j'ai remarqué sur l'app ». The product's own words say green: a check passes, a gate is green, the tests are green. On the screen the passing state was the only one without a colour: the refusal had its vermilion, the level its orange, the live state its blue, and what passes was black. A decision maker who scans the list for what goes and what does not saw colour only on what does not.

What is so here: every colour of the app lives in `web/couche-runward-app.css` (ADR-0019), and `test/unit/tokens.test.js` refused any green in it. The state hues are Okabe-Ito's, one step per theme, validated together. The decision is taken at that boundary: one file holds the value, the stylesheets name where it stands, the test holds both.

## Decision

The author decided on 2026-11-12, for this product, to override « jamais de vert »: a passing state has its colour.

1. **The colour.** `--passe`, Okabe-Ito's bluish green, stepped per theme: `#007752` in light, `#00a370` in dark. The raw `#009e73` was stepped off so that it stays apart from the live blue for every reader (unstepped, the green and the blue were 14.3 and 14.9 apart for normal vision, under the validator's floor of 15). A tint, `--passe-fond` (`#e8f5f0` in light, `#08201a` in dark), stands behind a mark of what moved toward passing. Both live in the layer, and only there.
2. **Never colour alone.** The green comes with the shape and the word the state already had: the filled circle and « Rien ne bloque » (or « passe » for a station, said to assistive technologies). The passing word is the one text set in a state colour, which is why `--passe` is held at 4.5:1 on both surfaces, not 3:1 as a stroke; every other state's word stays in ink.
3. **Where it stands, and nowhere else.**
   - « Rien ne bloque »: its mark and its word in a row of the list, in the head of an application's reading, in the filter of the list's bar (pressed, the filter inverts in ink as the others do); the mark of the clean state wherever runward-fleet's reading says it.
   - The rail of six steps: the filled dot of a station the version passed (it passes, before the step where the check refuses, in an application whose evidence reaches the level its team requires), and the solid line when it runs to the end, nothing blocking. A station passed under the required level, or after a refusal, stays in ink; the line of a refused application stays in ink. The same rule for the small rails of the list.
   - The sign-in's example (the public demo's two checks): « Rien ne bloque » with its dot, the steps passed and the line to the end.
   - What moved: the mark « a bougé » of a row, of a station and of the sheet « ce qui a bougé » takes the green and its tint when the move goes toward passing (the verdict now « Rien ne bloque », or refusals lifted and none raised); a line of that sheet has its own mark (green for a refusal lifted or a verdict now passing, the refused diamond for a refusal raised or a verdict now refused, ink for the rest). Any other move keeps the live blue.
4. **Nothing else changes.** The vermilion, the orange and the blue keep their values and their roles; the blue stays the live state's only, and no rule takes both the blue and the green.
5. **The guard.** `test/unit/tokens.test.js` refuses a green in the layer under any name but `--passe` and `--passe-fond`, measures the passing word at 4.5:1 on both surfaces in both themes and the ink and the green on the tint, and refuses a rule of the stylesheets that takes the green on a selector naming no passing state, or a script that sets it. `test/unit/piste.test.js` holds the shape and the word beside every green it paints, which applications and stations are green, and which move is. `test/unit/decision.test.js` holds the clean mark of runward-fleet's reading in `--passe` and the green on nothing else there. Each guard has its planted controls.

## Alternatives discarded

- **Keeping the ink for « Rien ne bloque »** (ADR-0019 as it stood): the author refused it; the passing state was the one state the eye could not find by colour.
- **The raw Okabe-Ito `#009e73`**: under 4.5:1 for the word on the light surfaces, and under the validator's normal-vision floor against the live blue in both themes.
- **Green for every filled dot, the documents filled and the gestures done included**: green would then say « present » or « done », not « passes »; it is kept for the check's verdict and the steps the version passed.
- **Green on the whole line of a refused application up to the refusal**: the line would read as passing in a row whose verdict is refused; the stations that passed say it by their own dots.
- **Changing the house's skill from here**: it belongs to the author and serves every product; this record changes this product, and names the line for him to change.

## Consequences

- **Positive**: what passes is found by colour as fast as what is refused; the four state hues stay told apart for colour-blind readers (validated: worst pair green and vermilion 8.3 deutan in light, green and orange 8.6 protan in dark; normal vision, green and blue 15.5 in light, 15.7 in dark; all checks pass); the word stays, so nothing is said by colour alone.
- **Negative, accepted**: a red and a green now stand on the same screen, which ADR-0019 had excluded; the shapes (the diamond against the circle) and the words carry the difference, and the validator holds the hues apart. A green reads as a go: the reading still says « La décision reste la vôtre » beside every verdict where nothing blocks. One more hue to keep in step across two themes.
- **On other boundaries**: the house's rules (ADR-0026, the shared skill `jetons-famille`) still say « jamais de vert »: this product departs from them on that one rule until the author changes it for the house. The public site (runward.dev) is untouched. No contract, route or data changes.

## What would settle it

- **Confirms**: the token, piste and decision tests green with their planted controls; the witness on the real service (the list, a passing application's reading, the sign-in, at 1440 and 390 px, light and dark) shows the green where this record says and nowhere else, its rendered values the layer's; at the event of 2026-11-18, a decision maker finds what passes and what is refused at a glance and tells the two apart.
- **Reverses**: the author takes the green back; readers take a green application for an approved delivery despite the sentence beside it; the house adopts a passing colour of its own, which this layer then takes.

## Reevaluation trigger (mandatory, dated)

Reopen on 2026-11-19, on what was observed on 2026-11-18, or earlier: the house's rules change on green; a fifth state hue is asked for; the validator's floors change.

**Trigger set on**: 2026-11-12 · **Watched via**: `test/unit/tokens.test.js`, `test/unit/piste.test.js`, `test/unit/decision.test.js`, the palette validator

## References

- ADR-0019 (the app's layer), ADR-0026 (the house's visual base), ADR-0035 (« La piste »), ADR-0036 (the fixed shell)
- M. Okabe and K. Ito, Color Universal Design (2008)
- WCAG 2.2, success criteria 1.4.1 (use of colour) and 1.4.3 (contrast)
