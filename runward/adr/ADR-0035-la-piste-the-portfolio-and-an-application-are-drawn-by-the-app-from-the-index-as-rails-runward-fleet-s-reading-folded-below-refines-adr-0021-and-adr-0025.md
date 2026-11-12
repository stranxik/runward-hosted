# ADR-0035: « La piste »: the portfolio and an application are drawn by the app from the index as rails of six steps, runward-fleet's reading folded below, byte for byte (refines ADR-0021 and ADR-0025)

**Date**: 2026-11-12
**Status**: accepted 2026-11-12 by the author in chat ("et je confirme tout le reste", in answer to a list whose items were "Accepter ou non l'ADR-0035 (portefeuille et lecture dessinés en lignes de six étapes, lecture runward-fleet repliée dessous). Je recommande d'accepter." and "Décider si « ce qui a bougé » doit survivre à un rechargement. Je recommande : pas pour le 18, à reprendre ensuite avec un ADR."); written by an agent session; the earlier check is not served by the service for 2026-11-18: what moved stays the comparison of two checks the page saw, and serving the earlier check is a later record
**Refines**: ADR-0021 (accepted 2026-11-11) on how the app shows the decision reading, and ADR-0025 (proposed) point 4, « the reading is laid out by the layer, never rewritten »; both stay in force for everything this record does not change. ADR-0034 (accepted 2026-11-12, the common part of the same direction: the frame, « À faire », the sign-in) is its sibling
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: the mock-up of the three directions (17 states, 1440 to 360 px, both themes, 372 automated checks), the author's choice on screen; reality-check of every field the rails need in the pinned runward-fleet (`src/build.js#projectVerdict`, `ui/views.js#LEXICON`, `decide`) and in the service's status (`src/application/reading.js#status`) on the five real exports of `test/fixtures/decision/`; the same checks replayed on the real app

## Context

The author's verdict on the app on 2026-11-12: « très (trop) brut… on dirait la console AWS en pire ». The design was kept; what the screens lacked was an image of what runward does: a delivery goes through six steps and the check stops it at one of them. Under ADR-0025 the main screen was runward-fleet's reading laid out by the layer (five state tiles, then a list), never rewritten: it says the truth, as runward-fleet writes it, but it cannot draw a path.

The data the image needs is already in what the browser reads, and nothing more is needed for it:

| The rail needs | Where it is |
|---|---|
| the six steps and the required documents of each | `latest.deliverables.list[]`, each with its `phaseId` and its state |
| where the check refuses, with the exact line | `latest.conformance[]`: `file`, `line`, `rule`, `kind`, `problem`, `phaseId` (a refusal of the execution topology carries `phaseId: "topology"`: its document, `execution-topology.md`, is a document of Architecturer) |
| the count of requirements per step (the mock-up's « 46 exigences ») | derivable, and only then: `latest.ratification.byState[].list` lists every row of the team's record once, as « document · rule », and `latest.evidence.rows` counts them; when the lists hold exactly that count and each row's document is a required document of a step, the rows are counted per step. The export of `hosted-proposed` lists no row: no count is shown for it |
| the verdict, the gate | `latest.verdict`, `latest.currentGate` |
| the deliveries checked, in order | the status line's `activity` (the last eight acts of an application: uploads accepted, replaced, refused, the first one's confirmation) and `accepted` (date, run, commit, chain) |
| the order of the portfolio, the names of the documents, the states, the kinds of refusal | runward-fleet's own `decide(index).listing.ids` and `LEXICON` |

What is not there, and is therefore never shown: the verdict of an earlier check (the index carries `latest` only; the status says an earlier upload was accepted, not what it said), the story of a change (what an agent renamed, how many tests stayed green: the demo's README says it, the check does not), the new name of a renamed symbol (the check says the cited one is not found, « moved or renamed? »). The author's addition of 2026-11-12, « ce qui a bougé depuis la dernière version », cannot be computed from the two latest checks the service holds: the service keeps the earlier upload (its row, ranked historical, and its export in the object store) and the earlier index versions, but no read serves their content to the browser. It can be computed, honestly, between two checks the page itself held.

## Decision

The decision reading is drawn by the app from the index's fields as rails; runward-fleet's reading stays on the screen, byte for byte, folded below as the raw detail.

1. **The portfolio** (`#/`, `#/decision`), under the frame's « À faire »: one sentence for the whole portfolio (« 6 applications : 2 refusées par le contrôle, 1 sous le niveau de preuve exigé, 1 où rien ne bloque, 1 à confirmer, 1 sans contrôle reçu »), then a board of rows under one shared header of the six steps: each application's name and state, its rail, ONE plain sentence (« Arrêtée à l'étape 3, Plancher. 2 preuves citent un nom que le contrôle ne trouve plus dans le code. », « Les six étapes passent. 36 exigences de l'équipe, aucune refusée. », « Premier contrôle reçu le …, à confirmer. ») and its action. The applications the index carries come in runward-fleet's order (refused first); the declared ones whose first check is awaited follow, to confirm first. Below, folded: runward-fleet's portfolio (its five state tiles and its list).
2. **The rail**: the line is solid from Cadrer to the station where the check refuses, then dotted; the refusing station carries the reading's own refused mark (`--refus`, the vermilion diamond), never a new accent; a station where nothing is required is a small ring in the bar's grey; an application with no check received is dotted from end to end. On a phone, the large rail stands up.
3. **An application** (`#/decision/<id>`): its rail in large, each station a button that opens its documents and what blocks there; « Ce qui bloque », every refusal of the index in exactly one block, by step, with each file and line (a cited name no longer found is shown with its pointer, the name struck; the check's text as written behind a fold); « Ce qui s'est passé », only what the check and the service recorded (the delivery, what the check read, what it refuses, the first confirmation); « Vérifier par vous-même », its strict patterns unchanged; the checked deliveries as a timeline, the one in force with the verdict of the index, an earlier one said accepted then replaced, and the reason its verdict is not shown; the level of evidence (ADR-0029); then, folded, runward-fleet's reading of the application.
4. **The first run** is the same rail with five gestures (connect, add the step, deliver, confirm the first check, read the verdict), on the routes that already exist: the portfolio with nothing declared, the portfolio with applications awaited, `#/declarer/attente/<key>`, `#/declarer/confirmer/<key>`; a first check confirmed and published opens its application's reading, which says it is its first verdict.
5. **The live update**: while the portfolio or a reading is open and the tab visible, the status is read again every 30 s (one read; 120 reads a minute per address are allowed, `src/http/limits.js`); when its head or its index changed, the index and the status are read again, the screen is painted again and what arrived comes in calmly. What moved (the verdict, refusals lifted and raised, documents filled or no longer counted, requirements newly endorsed) is computed between the check the page showed and the new one, marked on the rail at its steps and said in its own window, « ce qui a bougé depuis l'ouverture de cette page », which says the earlier check is not kept beyond the page. A member whose focus is on a control is not repainted under their hands: a line says a check arrived, with its button.
6. **Motion**: the line draws itself on arrival (a transition of its width, or of its height when it stands), what a live read brings glows and rests; both are transitions that end (their classes are taken off after 2.6 s, the line stays drawn), and reduced motion removes them (`web/famille.css`). The app's stylesheet still holds no entrance `animation` (`test/unit/tokens.test.js`).
7. **Words**: the decision maker's, one name per object (« application »), the steps' names of the app, the documents' and kinds' names of runward-fleet, none of the words runward never says, « conformité » included (`test/unit/piste.test.js`).

## Alternatives discarded

- **Keep runward-fleet's reading as the screen and add the rails beside it**: two readings of the same verdict at the same level; the eye takes the tiles first, which is what the author found raw.
- **Rewrite runward-fleet's reading in the app and drop it**: the reading's claim is to be what `runward-fleet build` writes for the same index; it stays, folded, and its tests still hold it byte for byte (`test/unit/decision.test.js`, runward-fleet's own rule R6 on the page as painted).
- **Show the requirements per step for every application, estimated when the rows are not listed**: a guessed number on a screen meant to be recomputed. Counted only when the lists hold every row.
- **Compute what moved on the service, from the earlier upload it keeps**: a new read, a new field and a new data path for the browser (the earlier export's content); a structural choice for the author, reported, not taken here. The page computes what it can prove: between two checks it held.
- **Poll faster, or keep a connection open**: a check arrives at a team's merge, not every second; 30 s is calm, cheap and within the read allowance; a push would add a connection type the service does not have.

## Consequences

- **Positive**: the portfolio reads in one glance where each application stops; the demo's repair, arriving while the page is open, redraws its line to the end and says « 2 refus levés, à l'étape 3, Plancher et l'étape 5, Gouverner » (the local witness of 2026-11-12); every value on the rails is one the index or the status carries.
- **Negative, accepted**: the app now writes words about the reading (one sentence per row, the step of a refusal, the kinds' plurals); they are tested on the five real exports. The rails need width: under 880 px of the board, each row stacks. The live update reads the status every 30 s while a screen is open (2 more reads when something changed). What moved is lost on reload, and the window says so.
- **On other boundaries**: no API, no field and no data class change; `web/views/fleet-views.js` re-exports `decide` and `LEXICON` from the pinned views (already in the vendored file); six modules join `MODULES` (`web/views/piste/`); the first verdict changes where the confirmation of a first upload leads (`web/views/events.js`), the rest of that gesture unchanged. « À faire » is the frame's (ADR-0034, `web/views/shell.js`), painted above the portfolio: the rows do not repeat it (a declaration's deadline is said there, not on its row), and the service's control account shows no row awaited and no first run (`tenant.witness`, read defensively).

## What would settle it

- **Confirms**: on the real app, the portfolio and every application at 1440, 1024, 390 and 360 px, both themes, reduced motion: no horizontal overflow, no text under 12 px, axe without a serious finding, every drawing ended after 3 s; the author reads where each application stops without opening it; at the stand, the repair arrives live and the line is redrawn.
- **Reverses**: the author finds the rails harder to read than the tiles with many applications (then the board gets a filter by state, or the tiles come back above, folded); a pinned runward-fleet that stops carrying `phaseId`, `line` or the listed rows (then the rails fall back to the gate, and the counts disappear by themselves).

## Reevaluation trigger (mandatory, dated)

Reopen on 2026-11-19 on what was observed at the stand on 2026-11-18, or earlier: a re-pin of runward-fleet that changes the projection of `latest` (its record says it, ADR-0021); the author's decision on serving the earlier check (then « ce qui a bougé » is computed from the service and survives a reload).

**Trigger set on**: 2026-11-12 · **Watched via**: `test/unit/piste.test.js`, `test/unit/decision.test.js`, `test/unit/frame-lang.test.js`, the local witness on the real server

## References

- ADR-0021 (the decision reading in the app), ADR-0024 (the grouped reading), ADR-0025 (the shell in the site's grammar), ADR-0029 (the level of evidence), ADR-0034 (the common part of « La piste »)
- The mock-up of 2026-11-12 and its note (the author's working folder; not in this repository)
- runward-fleet at d052814: `src/build.js#projectVerdict`, `ui/views.js#decide` and `LEXICON`
