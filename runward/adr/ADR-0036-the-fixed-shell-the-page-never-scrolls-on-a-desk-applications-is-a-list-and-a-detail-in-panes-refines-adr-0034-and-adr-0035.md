# ADR-0036: The fixed shell: the page never scrolls on a desk, Applications is a list and a detail in panes, the applications leave the sidebar (refines ADR-0034 and ADR-0035)

**Date**: 2026-11-12
**Status**: accepted 2026-11-12 by the author in chat ("j'accepte les adr", in answer to a list whose item was "Accepter ou non les ADR-0036 (structure fixe et Applications en volets) et ADR-0037 (Brancher guidé, journal filtré, Compte en volets). Je recommande d'accepter les deux."); written by an agent session, from the playable mock-up the author validated in chat on 2026-11-12 (« ok pour la maquette »)
**Refines**: ADR-0034 (accepted 2026-11-12, the frame of « La piste »): its sidebar no longer lists the applications, and « À faire » is no longer a block painted by the frame above the portfolio; everything else in it stays in force (four entries, no deadline the service does not hold, the technical views closed with their reason, the control account said). ADR-0035 (accepted 2026-11-12, « La piste »): the portfolio is no longer a board of rails under a title but a compact list beside the reading; the rails, what the app derives from the index and from nothing else, runward-fleet's reading byte for byte, the live update and what moved stay as decided there
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: the author's critique of 2026-11-12 (« des écrans à rallonge qui défilent alors que normalement les pages sont fixes et c'est dans les éléments que ça défile ; très peu d'info »); the playable mock-up of the same day (every state, 1440 to 360 px, both themes, its references from desktop products of the same family of tools), validated by the author; the same screens built on the real service and witnessed there (the in-memory store, one headless Chrome: 1440, 1024, 390 and 360 px, light and dark, reduced motion, English)

## Context

Under ADR-0034 and ADR-0035 every screen was a page that grows: the portfolio a column of rails under a large title, an application a long reading, the sidebar listing every application under the four entries. The author read it as screens « à rallonge » with little information at a glance: on a desk the page scrolled as a whole, the header and the sidebar went with it, and moving from one application to the next meant going back to the top. The mock-up answered with the pattern of desktop tools: a frame that stays, a window for the work, a list and a detail side by side, each scrolling on its own; and on a phone, the pattern of phone apps: a list, a detail with its way back, a tab bar.

The data does not change: the screen reads what it already read (the index and `GET /api/v0/fleet/status`), and every value it shows is one they carry.

## Decision

1. **The frame stays where it is on a desk** (1024 px and more, signed in): the sidebar and the top bar are fixed, and the page never scrolls as a whole. A screen scrolls inside its own area; a screen of panes inside each of its panes. The foot is one quiet line under the area. Under 1024 px the top bar sticks to the top, the screen scrolls, and a tab bar holds the four entries at the bottom (with the home indicator's safe area); the phone menu keeps the language, the technical views and the sign-out. Touch targets are 44 px under 1024 px.
2. **The applications leave the sidebar** (refining ADR-0034 §1): the sidebar keeps its four entries, « Applications » with the count of what waits for a gesture, and the technical views folded with their reason. The list of Applications says every application.
3. **« À faire » is a count in the top bar** that opens a drawer holding the whole block (a dialog: its focus held inside, Escape and its veil close it, the focus goes back to what opened it), and a compact strip at the head of the list (what to do, its deadline, its button). An application awaited carries its own item in its reading. No count is shown while the items are not known (refining ADR-0034 §2, whose rule on the count stays).
4. **Applications is a list and a detail** (refining ADR-0035 §1 and §3), at the addresses it had (`#/`, `#/decision/<id>`; `test/unit/liens.test.js`). The window's bar says how many applications, their counts by state as filters (kept for the page), and when the index was last published with the live dot (offline, the time it was read and that it is offline). The list: « À faire » first, then each application with its mark, its name, its six stations in small, one short reason (« Arrêtée à l'étape 2, Architecturer. 46 refus, 1 pièce manquante. ») and the time of its check, refused first as runward-fleet orders them, then those awaited; runward-fleet's reading of the portfolio, byte for byte, folded at its end. The detail: a sticky head (state, received, run, commit, the sentence of ADR-0035, previous and next « 2 / 6 », « Vérifier par vous-même »), the rail whose stations keep « Ce qui bloque » to their step, « Ce qui bloque » as a table grouped by step and kind (file, line, requirement, the status a row proposes read from the check's text; the check's text folded as written; every refusal in exactly one group), the documents step by step, what happened, the checked deliveries, and folded « Vérifier par vous-même », the path the file took and runward-fleet's reading of the application, byte for byte. On a desk `#/` shows the first application beside the list, drawn as selected and never said current; a phone shows the list at `#/` and the reading with its way back at `#/decision/<id>`.
5. **An application awaited has its reading at the same address** (`#/decision/<mission>`): where it stands among the five gestures, its item of « À faire », its deliveries so far, and the button to its next step on the routes that already exist. Before, that address said « unknown application ».
6. **The panes are one primitive** (`web/views/volets.js`, `web/coque.css`): the window, a row, the head of a detail, previous and next, a sheet, a fold, a state, the skeleton; and what a repaint keeps (the list's scroll on the same screen, the detail's scroll and open folds on the same item, the focus by its key). Journal and Compte are built on the same primitives by their own lot. A screen of panes says `main: "volets"` and which pane a phone shows; nothing else in the shell knows it.
7. **The live update of ADR-0035 §5 is kept**, shown on the row (« a bougé ») and in the reading; since a repaint now keeps the panes' scroll, folds and focus, it repaints under the member's hands, except while they type in a field or answer a confirmation (then the line with its button, as before).
8. **Motion answers a gesture and always ends**: a new selection brings its detail in, a phone slides the screen that comes in, the drawer comes in from its side, a row a live read brought glows and rests; each is a transition a class starts and the script takes off (a failsafe whatever happens), none under reduced motion; `web/coque.css` holds no animation (`test/unit/tokens.test.js`).
9. **The states are the mock-up's**: loading (the skeleton of the panes, no number), a read error with its retry, offline, an unknown application beside the list, a filter with nothing in it, the first run, the control account (its banner, no gesture of an application, no row awaited).
10. **The words**: the app's lexicon, the decision maker's words, French and English with the same keys, in one new block at the end of each language (`coque`), none of the words never said, no em dash. A fact-check of the same day replaced « Les six étapes passent » (step 4, Itérer, carries no gate) by « Les étapes contrôlées passent ».

## Alternatives discarded

- **Keep the board of rails as the first screen and open an application on its own page**: the critique was about that very shape; the reading of one application still meant losing the others.
- **Keep the applications in the sidebar as well as in the list**: two lists of the same objects, the sidebar growing with the portfolio; the list of Applications says more (stations, reason, time) in the same width.
- **Drop runward-fleet's reading of the portfolio**: its claim is to be what `runward-fleet build` writes for the same index, and its tests hold it byte for byte; it stays, folded at the end of the list.
- **Rewrite `web/app.css`**: another lot works on the same frame in parallel; the fixed shell's rules are a stylesheet of their own, loaded after it, and `web/app.css` changes only its sidebar's breakpoint (900 to 1024 px).
- **Rewrite the address on a desk to the first application** (`#/` → `#/decision/<first>`): the address would say a choice the member did not make, and the phone would open on a reading; the first is shown by default and not named.

## Consequences

- **Positive**: on a desk the whole portfolio and one application's reading are in view at once, the frame never moves; previous and next walk the applications without going back; on a phone the app behaves as a phone app; the primitives make Journal and Compte the same shape.
- **Negative, accepted**: a second stylesheet (`web/coque.css`) in the page; the list's width (400 px, 330 px under 1280 px) leaves the reading narrower at 1024 px, where the rail and the table take their narrow forms (container queries); the address `#/` shows an application's reading on a desk without naming it.
- **On other boundaries**: no API, no field, no route and no data class change; the reads per screen are unchanged (architecture §6); `src/http/assets.js` serves `web/coque.css` like `web/app.css` and lists `web/views/volets.js` among the modules.

## What would settle it

- **Confirms**: the local witness on the real service (1440, 1024, 390 and 360 px, light and dark, reduced motion, English) finds no page scroll on a desk, no horizontal overflow, no text under 12 px, no clipped text and no console error; the author reads an application and walks to the next without scrolling the page; at the stand on 2026-11-18, the screen reads at a glance on both screens.
- **Reverses**: the author prefers the board of rails as the first screen (then the list grows the rails back, the panes stay); the list pane is too narrow for a long name on the stand's screen (then its width becomes a setting of the window, never a truncation).

## Reevaluation trigger (mandatory, dated)

Reopen on 2026-11-19 on what was observed at the stand on 2026-11-18, or earlier: Journal and Compte built on the panes (the primitives then change only by a record that says why); a portfolio of more than a screen of applications (search, grouping).

**Trigger set on**: 2026-11-12 · **Watched via**: `test/unit/volets.test.js`, `test/unit/piste.test.js`, `test/unit/decision.test.js`, `test/unit/afaire.test.js`, `test/unit/menu.test.js`, the local witness on the real service

## References

- ADR-0034 and ADR-0035 (refined by this record), ADR-0021 (the decision reading in the app), ADR-0025 (the shell in the site's grammar)
- The playable mock-up of 2026-11-12 and its note on what is real and what is example (the author's working folder; not in this repository)
