# ADR-0034: The frame of « La piste »: four entries, what waits for a gesture first, the technical views closed with their reason, the control account said (refines ADR-0025 and ADR-0028)

**Date**: 2026-11-12
**Status**: proposed (written by an agent session; the author chose the direction « A · La piste » on 2026-11-12 on a playable mock-up; this record awaits his acceptance)
**Refines**: ADR-0025 (the shell in the grammar of its public site, proposed), which stays in force for the scene, the windows, the one header and the loops of the stylesheet; ADR-0028 (accepted 2026-11-11), which stays in force: the app's origin carries the app only, a signed-out visitor lands on the sign-in
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: the audit of how the app is understood (2026-11-12, its section 5: the structure proposed for 2026-11-18), the three playable directions and the author's choice of the first, the code read for every date the screen says (`src/application/operator.js#retention`, `src/domain/repository.js#repositoryState`), the same frame witnessed on the real service (the in-memory store, a headless browser) at 1440 and 390 px, light and dark, reduced motion

## Context

The author's verdict on the app on 2026-11-12: too raw, read as a cloud console. The audit of the same day found that a decision maker does not know what to do on the first screen: the first upload of one of his applications had waited for his confirmation since the night, and he learnt it because he was told. The frame had seven entries for one person's account (Portefeuille, Envois, Accès, Export, then the applications, then seven technical views), the same object under six names, the export twice, and the technical views sending silently to the arrival until the first application was confirmed. The service's own control account (the tenant opened with `--witness`, where every deploy leaves the check of runward hosted) looked like an ordinary account whose first upload was forgotten.

The direction chosen draws each application as a line of six steps (« La piste »); its views are built in parallel. What the frame around them holds is decided here, so that both lots stand on the same structure.

## Decision

1. **Four entries, one name per object.** Applications (`#/`, with the count of what waits for a gesture), Brancher une application (`#/declarer`), Journal (`#/envois`, renamed in words), Compte (`#/acces`, renamed; « Récupérer vos données », the export, is one of its sections and no longer an entry). Every route and sub-route stays (the addresses of `#/acces/*`, `test/unit/liens.test.js`); only the words and the entries change. Under them, the group « Applications », one line per application: the published ones, then those whose first check is awaited, each to its next step.
2. **What waits for a gesture comes first.** « À faire » is the first block of the portfolio, the screen one lands on after the sign-in: one item per gesture (a first check to confirm, a new owner or definition to confirm, the step to add before a declaration expires, a consent missing, a second passkey missing), each with what to do, its reason in one sentence, its deadline and its button to the screen of that gesture; an item goes once its gesture is done. The menu's « Applications » carries its count, and no count while it is not known (a screen opened before the portfolio was read). The second passkey's banner is not repeated where « À faire » says it.
3. **No deadline the service does not hold.** A declaration expires 7 days after it, only while nothing has arrived (`operator.js#retention`, `repositoryState`); once a first upload arrived it waits for the confirmation with no date. The status line says it so (`expiresAt` null then), and « À faire » says « Pas de date limite » for that item. The mock-up said a deadline for a first check already received: the code does not hold one, the screen does not say one.
4. **The data, additive only.** The status line (`GET /api/v0/fleet/status`, `src/application/reading.js`) gains `repositoryRef` (the declared repository's id, named so as not to be read as the forge's `repositoryId` of the access view), `declaredAt`, `expiresAt` and `pendingReceivedAt` (the upload that waits for a confirmation). The session's tenant view gains `witness`. No route, refusal or other field changes; nothing in identity, sessions, passkeys, the content security policy or the tenant's isolation.
5. **The technical views are folded, and closed with their reason.** Under their title, folded (open when one of them is the screen). Until the first check of an application is confirmed (the session's `arrivalDone`, the router's gate), the group is greyed with « S'ouvrent quand le premier contrôle d'une application est confirmé. » and holds no link; their addresses open a screen that says the same and leads back to the applications, instead of the silent redirect to the arrival. The arrival's own gate (two passkeys, or the choice of one) is unchanged.
6. **The control account is said.** On the tenant whose session says `witness`, a fixed banner heads every screen (« Compte de contrôle du service : chaque mise en production y dépose le contrôle de runward hébergé ; son premier envoi reste en attente, c'est normal. »), « Brancher une application » and the portfolio's waiting block are not shown, and « À faire » carries no application's item. The shell sets `body.temoin`; a screen marks what has no use there with `data-hors-temoin`, or reads `compteTemoin()` (`web/views/afaire.js`).
7. **The sign-in speaks to the one who decides**: « Avant chaque mise en production, ce qui bloque et pourquoi. », the gesture under it, and beside it a real example drawn as « La piste »: the public demo's two checks (run 15 refused at Plancher and Gouverner, run 16 after the two lines were corrected), never a tenant's data. The wording is plain on purpose: the public positioning is being revised and will refine it.
8. **The words of the frame hold the house's rules**: French and English with the same keys; no internal jargon in the frame; none of the words never said (`compliant`, `certified`, `guarantee`, `tamper-proof`, `platform`, `sovereign` and their French forms, « conformité » now included in the guard); no product capacity said as a limit; no em dash. Inline code sits on the type scale (12 px, 14 px inside a lede), never a fraction of its line (the .86em that read 12.04 px).

## Alternatives discarded

- **« À faire » inside the portfolio's view**: the portfolio is the direction's own lot, built in parallel; the frame paints the block above it and offers the items to it (`aFaire()`), so the two lots do not write the same lines.
- **The deadline of the declaration for a first check received**, as the mock-up said it: the daily pass does not expire such a declaration; a date the service does not hold would be a false urgency on the first screen.
- **Hiding the technical views until the first verdict**: the person would not know they exist; greyed with their reason, they say what opens them.
- **A count of « À faire » from the session alone on a screen opened cold**: it would say 1 where 3 wait. No count is shown until the items are known.
- **Naming the new field `repositoryId`**, as first proposed: the access view already gives that name to the forge's identifier; the same name for two values invites a join on the wrong one.

## Consequences

- **Positive**: the first screen says what to do and by when; four entries; the export in one place; the technical views say why they are closed; the control account no longer reads as a forgotten one.
- **Negative, accepted**: the words « Accès », « Envois », « Portefeuille » leave the frame while some screens of the parallel lot still say them until it lands; the access view's own `expiresAt` (`src/application/identity.js#accessView`) is still written for every pending declaration, a first upload received or not; the screens that read it say it with its condition (« si rien n'arrive », « sans envoi »), which stays true, and the field is left as it is (a change of the identity module, out of this record's scope).
- **On other boundaries**: the API contract (`runward/contracts/api-contract.json`: routes and refusals) is unchanged; the status line and the session carry more fields, held by `test/unit/http.test.js` and `test/unit/afaire.test.js`. The read budget of a screen (architecture §6) is unchanged: the frame reads only what the router loaded.

## What would settle it

- **Confirms**: on the real service, a member with a first check waiting sees it first on the phone without scrolling, with its button landing on its confirmation; the item goes once confirmed; the control account shows its banner and no « Brancher une application »; the author reads the frame as the mock-up's.
- **Reverses**: the author wants the technical views hidden rather than greyed; a deadline is added to a declaration whose first upload arrived (then the status line says it, and « À faire » with it).

## Reevaluation trigger (mandatory, dated)

Reopen on 2026-11-19 on what was observed at the stand on 2026-11-18, or earlier: an email or another way to reach a person outside the app is decided (the to-do's items then have a second place); a member other than the owner joins an account (whose to-do is it).

**Trigger set on**: 2026-11-12 · **Watched via**: `test/unit/afaire.test.js`, `test/unit/frame-lang.test.js`, `test/unit/liens.test.js`, the local witness on the real service

## References

- ADR-0025 and ADR-0028 (refined by this record), ADR-0009 (the consent per repository), ADR-0011 (members)
- The audit of how the app is understood and the three playable directions, 2026-11-12 (the author's working folder; not in this repository)
