# ADR-0028: The public site is runward.dev; the app's origin carries the app only; its former public pages answer 308 to runward.dev

**Date**: 2026-11-11
**Status**: proposed (written by an agent session; it records a decision the author took on 2026-11-11, relayed to this session by the session that coordinates it; this record awaits his acceptance). It supersedes ADR-0022 once accepted.
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: reality-check (the server's static paths, the shell's boot and its router at `6686854`; each target asked on runward.dev), challenge, durable position

## Context

ADR-0022 (accepted 2026-11-11) made `app.runward.dev` serve a public site: the landing at `/`, eight pages (`/pourquoi`, `/comment`, `/pour-qui`, `/formats`, `/donnees`, `/stand`, `/releve`, `/mentions`), the shell moved to `/app`. A printed QR code holds `https://app.runward.dev/stand`.

The same evening the author moved that site to `runward.dev`: the same discourse, the same pages under the same names, the same style, with the documentation and the news beside them. Two public sites that say the same thing on two origins is one too many: a text corrected on one is stale on the other (an open pull request already edits three pages of `web/site/`), and a reader does not know which is the reference. The author's decision: **runward.dev is the public site; app.runward.dev keeps the sign-in and the signed-in app only; its old public pages redirect to runward.dev, `/stand` included.**

What is so, read in the code and asked on the network:

- the pages are served before the route table (`src/http/server.js`), from a map built at start (`src/http/assets.js`, `src/http/site.js`); the shell's page is one document, served at `/app` and `/lien`;
- a fragment never reaches the server (ADR-0022): with the shell at `/` again, `/#/entree` and every other `/#/` address are the shell's own, with no detour;
- the shell's signed-out root goes to `/` (`web/views/router.js`): with the shell at `/`, that would reload the shell for ever;
- runward.dev says French at `/<page>` and English at `/en/<page>`. The pages this origin served held both languages in one document, English chosen in the page or by `?lang=en`;
- each target below answered 200 on 2026-11-11 at 21:51 (CET), asked with `curl`; `/stand` and `/en/stand` carry the stand's title in their language.

The boundary is the HTTP entry and the shell's router and links. Identity, sessions, passkeys, the cookie, the content security policy and the tenant boundary are not touched.

## Decision

**The origin of the app carries the app only. `/` serves the shell; signed out, its root opens the sign-in. Every address this origin served as a public page answers `308` to the same page of `https://runward.dev`, its query string kept. The shell's links to public pages name runward.dev, in the reader's language.**

1. **The redirect table** (`src/http/moved.js`, closed; `GET` and `HEAD` only; checked by `test/unit/moved.test.js`). One trailing slash is the same page.

   | On app.runward.dev | Answers 308 to | Target on 2026-11-11 |
   |---|---|---|
   | `/index.html` | `https://runward.dev/` | 200 |
   | `/pourquoi` | `https://runward.dev/pourquoi` | 200 |
   | `/comment` | `https://runward.dev/comment` | 200 |
   | `/pour-qui` | `https://runward.dev/pour-qui` | 200 |
   | `/formats` | `https://runward.dev/formats` | 200 |
   | `/donnees` | `https://runward.dev/donnees` | 200 |
   | `/stand` | `https://runward.dev/stand` | 200 |
   | `/releve` | `https://runward.dev/releve` | 200 |
   | `/mentions` | `https://runward.dev/mentions` | 200 |
   | `/en` | `https://runward.dev/en` | 200 |
   | `/en/<page>`, for the eight pages | `https://runward.dev/en/<page>` | 200, each |

   `?lang=en` on a French address names the English page (`/pourquoi?lang=en` answers `https://runward.dev/en/pourquoi?lang=en`): it was how this origin's pages were asked in English. `/en` and `/en/<page>` never existed here; they are in the table so that an address of runward.dev typed on this host finds its page. Every former page has its page on runward.dev: none is sent to a nearest one.
2. **The answer.** `308`, `location`, the app's own headers and policy, a body that is the address as text, `cache-control: public, max-age=3600`: a browser asks again after an hour, so the table can change without waiting for every browser to forget a permanent answer. The target is built from the parsed path and the parsed query; nothing of the request is copied raw into a header, and no target leaves `https://runward.dev/`.
3. **`/` is the app.** `/` serves the shell, as `/app` (kept: addresses of the last day, and the shell writes `/#/...` back) and `/lien` do. Signed in, `/` opens the decision reading, as `/#/` always did. Signed out, the root opens the sign-in (`#/entree`); any other protected address opens the sign-in with its intent, as before. Passkey ceremonies, founder links (`/lien#t=...`) and the arrival are the same code at the same addresses.
4. **The shell's links.** The address of the public site is written once in the shell (`siteUrl`, `web/views/lexique.js`): French at `/<page>`, English at `/en/<page>`. The foot's first link is `runward.dev`; the legal screen links the public site's legal notice; "how to get in" links the site's home. They open in the same tab.
5. **Nothing of `web/site/` is served.** The pages are no longer built at start; the site's stylesheet and scripts leave the served list. The sources and their renderer (`src/http/site.js`) stay in the tree, held by their tests, until their removal: an open pull request edits three of those files, and removing them here would conflict with it.

## Alternatives discarded

- **Both sites kept, the app's as a copy**: two references for one discourse; the copy drifts at the first correction.
- **A redirection of the whole origin's unknown paths to runward.dev**: an unknown address of the app would leave for the public site instead of saying it does not exist; the table is closed, like every list this server serves from.
- **`301` or `302`**: `308` keeps the method and says the move is lasting; the one-hour cache keeps it reversible in practice.
- **`/` answering a redirection to runward.dev for a visitor without a session**: the server would read the session for a page (ADR-0022 discarded it for the same reason), and a member whose session ended would be sent away from the sign-in.
- **The landing's "Se connecter" detour kept (`/` as a page that sends `#/` addresses to `/app`)**: with no landing, the detour loads two documents for nothing.
- **The redirection made at the DNS or at the hoster's router**: the printed address must keep answering under the app's own guards (host list, headers), and the table is tested with the code.
- **`web/site/` removed in the same change**: it conflicts with the open pull request that edits it; removal is the next change.

## Consequences

- **Positive**: one public site, where the documentation and the news live; the app's origin holds only what needs its guards; `/#/entree` and every `/#/` address open in one document again (ADR-0022's accepted cost is gone); the printed QR code keeps working; a member who types `app.runward.dev` reaches the sign-in or the fleet at once.
- **Negative, accepted**: the stand's QR code now costs one redirection; the public pages no longer share the app's theme choice (another origin); `src/http/site.js`, `web/site/` and the layer's section for the public pages are dead weight until their removal; the app's legal screen and the site's legal notice are two texts, each for its own scope.
- **On other boundaries**: the API contract is unchanged (the redirections are answered before the route table, like the pages they replace); the content security policy, the cookie and the host list are unchanged; the deploy's smoke asks the shell at `/` and at `/app`, and `/stand` for its 308 (`scripts/smoke.mjs`); `x-robots-tag: noindex, nofollow` stays on every response of this origin.

## Reevaluation trigger (mandatory, dated)

Reopen on 2026-11-19, after the two days of the stand, or earlier when: a target of the table stops answering 200 on runward.dev (a page renamed or retired there: the table follows in the same change); runward.dev changes its language addresses (`/en/<page>`); the app needs a public page of its own again (a status page, a public reading); the removal of `web/site/` is ready (it closes point 5).

**Trigger set on**: 2026-11-11 · **Watched via**: `test/unit/moved.test.js`, `test/unit/site.test.js`, `scripts/smoke.mjs` (the deploy's smoke asks `/stand`), a `curl` of each target at the reopening date

## References

- ADR-0022 (the public site served by the app), which this record supersedes; ADR-0001 (no framework); ADR-0005 (passkeys and the sign-in)
- `src/http/moved.js`, `src/http/server.js`, `src/http/assets.js`, `web/views/router.js`, `web/views/lexique.js` (`siteUrl`), `web/views/shell.js`, `web/views/legal.js`
- `test/unit/moved.test.js`, `test/unit/site.test.js`, `test/unit/frame-lang.test.js`
