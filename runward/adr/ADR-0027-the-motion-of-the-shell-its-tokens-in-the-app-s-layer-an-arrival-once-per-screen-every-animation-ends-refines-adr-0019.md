# ADR-0027: The motion of the shell: its tokens in the app's layer, up to 320 ms and 420 ms for a change of screen, an arrival once per screen, every animation ends (refines ADR-0019)

**Date**: 2026-11-11
**Status**: proposed (written by an agent session; the author validated the mock-up's motion on 2026-11-11 and decided in chat where its tokens live and what must be measured before a merge; this record awaits his acceptance)
**Refines**: ADR-0019 (accepted 2026-11-10), whose layer said "the family's productive curve and durations apply; no entrance animation in the app", and ADR-0025 (proposed), which kept two loops only
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: the mock-up's motion reference (its tokens, its rules, the timing of each moment) and its measures; the same moments built on the real app and measured there (the real server, the in-memory store, Chrome with a virtual authenticator, the processor slowed four times); durable position

## Context

The author's words: runward is very technical, working with it must feel soft and pleasant; the motion must be as worked as the design. The family's structure (`web/famille.css`) says, for an app, 150 to 240 ms and no entrance. The mock-up's motion goes to 320 ms, 420 ms for a change of screen, and animates the arrival on a screen. The author decided (2026-11-11): the family is not changed for all its products; these tokens live in runward's layer. He also decided what must hold before a merge: no frame over 50 ms inside a screen, and the change of screen measured at rest on the real app; if it does not hold, what is carried across is shortened, the reading's window first.

## Decision

1. **The tokens are the layer's** (`web/couche-runward-app.css`, `--mv-*`): 160 ms for an answer, 240 ms for a state that changes, 320 ms for a block that moves, 420 ms for a change of screen and for it alone; one curve, the public site's soft deceleration, without overshoot; 35 ms between two blocks that arrive, 300 ms in all at most; 8, 6, 1 and 10 px for the distances. `web/famille.css` is unchanged. `web/mouvement.css` writes no duration; `web/views/mouvement.js` reads the tokens and writes none (a token it cannot read is 0: no token, no motion).
2. **Transform and opacity only.** Two exceptions, said: the paint of a hover (a ground, a halo, an underline that grows), and the clip-path of the window whose fold opens. Never a property of layout: the layout changes once, at once, and a transform makes the way.
3. **From screen to screen**: a view transition of the same document, the pieces that exist before and after carried (the brand, the header's tools, the title, the glass window, the sidebar, its marker, the foot; an application's row becomes its reading's window, and back); a plain fade where the browser has no view transition. A piece is named only while it travels.
4. **An arrival once per screen**: the blocks of a screen rise 8 px and appear, staggered, when one comes to it by a navigation forward. Never on the same address painted again (a refresh, a re-render, a check that arrives), never on a switch of language, never on a way back, never between two states of one screen.
5. **The passkey's ceremony changes its state in place**: the states of the sign-in are stacked in one cell, so the window never changes its size; a line of 2 px breathes while the passkey is awaited (the one other curve, symmetric); accepted, a check draws itself in a disc (600 ms in all) while the session is read, then the screen changes; refused, the message settles, nothing shakes. A word, « Connexion réussie. », is said to a reader who does not see the check.
6. **Loading**: nothing for 300 ms (the screen shown stays), then a still skeleton that keeps the screen's height, then the screen. The sweeping line is no longer shown while a screen's reads are made.
7. **Every animation that starts ends**: each has its guard (its duration, its delay and 300 ms) which forces it to its end; the state at rest is the final state; a new gesture takes everything that runs to its end at once. Under reduced motion no transform is animated: an immediate change, or a fade of 160 ms at most; the breathing line and the haze stand still.
8. **A check that arrives is shown where it changed**: when the portfolio is painted again on the same address with another check, the tile's number rolls, the row fades in, the rows below slide, a veil goes out on the row. For this to happen without a navigation, the portfolio is read again when its reader comes back to the tab, a minute at least after its last read (the same two reads as an opening; never a poll, and nothing while the tab is hidden).
9. **A row of the portfolio opens its reading** wherever it is pressed but on one of its links, which keep saying where they go.
10. **The folds of the reading** are runward-fleet's own `<details>`: opening is the browser's, and what is below slides from its old place; closing plays the way back, then closes the fold as the browser would have.

`test/unit/tokens.test.js` and `test/unit/motion.test.js` hold it: the tokens and their bounds, the family unchanged; no duration written in a stylesheet and no property of layout animated; the loops of the stylesheets (the loading line, the sign-in's haze, the waiting line) each stopped under reduced motion, no entrance in a stylesheet; an animation that never ends by itself forced to its end by its guard; no transform under reduced motion; the arrival on a navigation forward only. Each has its planted control.

## Alternatives discarded

- **Changing the family's structure** for all its products: decided against by the author.
- **Animating layout** (height, grid rows) for the folds: every frame lays the page out again.
- **A library**: ADR-0001 (no framework), and the content security policy allows no inline style element; the Web Animations API and view transitions are the browser's own.
- **A poll of the portfolio**: reads without a reader; the blue of what is live is not claimed.
- **Keeping the pieces named at rest**: a named piece is its own layer and its own backdrop; the glass would lose the scene behind it.

## Consequences

- **Positive**: one says what changed and where it went; the sign-in's window does not jump; a slow read no longer flashes a loading screen under 300 ms.
- **Negative, accepted**: a change of screen costs the laying of the new screen and the photograph of the carried pieces; on a slow machine it is the one moment where a frame can pass 50 ms, measured and reported in the journal, and shortened by taking a piece off the carried list (`web/views/mouvement.js`, `PORTEES`). A change of screen where the frame itself changes (the sidebar appears after the sign-in; a shorter screen moves the foot) is reported by the browser's layout shift measure although nothing jumps on screen: the old screen fades over it. The return to the tab adds two reads at most per minute and per reader.
- **On other boundaries**: `web/mouvement.css` and `web/views/mouvement.js` join the closed list of served files (`src/http/assets.js`); the content security policy is unchanged; the reads of a screen at its opening stay within the budget of architecture §6.

## What would settle it

- **Confirms**: measured at rest on the real app with the processor slowed four times: no frame over 50 ms inside a screen, no layout shift inside a screen, no animation left on the way after any sequence (and one counted when one is stuck on purpose), no transform animation under reduced motion; the change of screen measured and reported.
- **Reverses**: the change of screen does not hold at rest after the carried pieces are shortened (then a plain fade of 240 ms between screens); the author finds the arrival tiring on a screen he opens fifty times a day (then the arrival stays on the first screen after the sign-in only).

## Reevaluation trigger (mandatory, dated)

Reopen on 2026-11-19 on what was observed at the stand on 2026-11-18, or earlier: a browser the author's readers use has no view transition and the fade reads poorly; the family's structure takes these tokens for all its products.

**Trigger set on**: 2026-11-11 · **Watched via**: `test/unit/motion.test.js`, `test/unit/tokens.test.js`, the motion witness on the real server

## References

- ADR-0019 and ADR-0025 (refined by this record), ADR-0001 (no framework), ADR-0024 (the grouped reading and its folds)
- The mock-up's motion reference of 2026-11-11 (the author's working folder; not in this repository)
