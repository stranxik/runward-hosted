# ADR-0022: The public site is served by the app: the landing at `/` for everyone, the shell at `/app`, its `/#/` addresses kept

**Date**: 2026-11-11
**Status**: accepted 2026-11-11 by the author in chat ("j'accepte", in answer to a list that named ADR-0021 and ADR-0022); written by an agent session; superseded 2026-11-11 by ADR-0028 (the public site is runward.dev; this origin carries the app only)
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: reality-check (the shell's boot, its router and the server's static paths at `4e54842`; the mini-site as built on 2026-11-11, rebuilt from its sources to the same bytes), challenge, durable position

## Context

The author's public mini-site of 2026-11-11 (a landing and eight pages, French and English, validated and fact-checked) must be served by the app itself at `https://app.runward.dev/` and its sub-pages: `/pourquoi`, `/comment`, `/pour-qui`, `/formats`, `/donnees`, `/stand`, `/releve`, `/mentions`. A printed QR code points to `/stand`. The pages are public and need no account.

The constraints, read in the code:

- the app's content security policy stays as it is (`src/http/server.js`): `script-src 'self'`, `style-src-elem 'self'`, Trusted Types required for every HTML sink, with one policy, `runward`. The mini-site as built inlines its stylesheet and its script, and its language switch writes `innerHTML` from a string;
- every file the app serves comes from a closed list, named by its digest (`src/http/assets.js`); the fonts are the app's (Geist, OFL);
- the design layer is the app's (ADR-0019): `web/famille.css`, then `web/couche-runward-app.css`, which alone holds every colour;
- until now `/` served the shell, whose screens are addressed by the fragment: `/#/entree` (sign-in), `/#/acces`, `/#/vue/...`, and `/lien#t=...` for a link. Those addresses are in mails already sent, in bookmarks, and in the shell's own redirections. **A fragment never reaches the server**: on a request for `/`, the server cannot tell the landing (`/`) from the sign-in (`/#/entree`).

## Decision

**`/` is the landing for everyone; the shell is served at its own path, `/app`; an address of the app (a fragment that starts with `#/`) is sent from the landing to the shell, which writes the address back, so `/#/entree` and every other `/#/` address stay what they were.**

1. **The pages.** The nine pages are rendered once, at start, from `web/site/` (the template, the page fragments, the data) by `src/http/site.js`, a port of the mini-site's `build.py` that keeps its output: the same markup but for the changes below, the same 324 bilingual texts (`web/site/textes_fr_en.tsv`, compared text for text with what is served). `/index.html` is the landing too. Each page answers 200, `text/html`, `no-store`, with the app's headers and policy, unchanged.
2. **The addresses.** The landing's first script (`web/site/aiguillage.js`, in the head, before anything loads) replaces the page by `/app` with the same fragment when the fragment starts with `#/`, at load and on a change of fragment within the page (the "Se connecter" link, `/#/entree`). The shell, opened at `/app`, writes `/#/...` back with `history.replaceState` (`web/app.js`). `/lien` opens the shell as before.
3. **The public home is the site.** The shell's signed-out root (`/#/`, `/app`) goes to `/`. `/#/entree` alone opens the sign-in (it opened the in-app public home); that home, `web/views/accueil.js`, is retired.
4. **No inline script or style, no HTML string.** The template links the files of the closed list; the English of each translated element is a `<template id="en-<k>">` parsed with the page, and the switch moves nodes. The theme is kept under the app's own key (`runward-hosted-theme`): one choice for the app and its pages. The three files of the site (`site.css`, `aiguillage.js`, `site.js`) are a closed list (`SITE_FILES`), named by their digest; the pages link the very files the shell links for the structure and the layer, and the same fonts.
5. **The design layer.** The site's stylesheet drops its copies of `famille.css` and of the layer (checked equal before they were dropped) and takes every colour from the layer, which gains a section for the public pages (the scene, the inverted section, the paper, a mask's ink, the veil). `test/unit/tokens.test.js` holds the site to the same guard as the shell.
6. **The data.** `web/site/donnees.json` is the one place of the data the public view (`/`) and the one-page summary (`/releve`) show. It is read once, at start, by `siteData()`, and rendered on the server, each value escaped as text. The day the real index replaces it, that one read changes; the pages do not.

## Alternatives discarded

- **The shell at `/` when a session cookie comes with the request, the landing otherwise**: the server would read the session for a page (identity code on the path of a static page), two documents would answer one address, a signed-in author could not show the landing from his own browser, and the fragment problem remains for every signed-out visitor (the sign-in at `/#/entree`).
- **The landing at another path (`/accueil`), the shell kept at `/`**: the home of `app.runward.dev` is the landing; it is the address said and printed.
- **The landing as a screen of the shell**: one document would load the shell's stylesheets and the site's, whose generic selectors collide (`.btn`, `.wrap`, `.top`); the site would show nothing without the shell's modules; its pages would become fragments, not the paths printed (`/stand`).
- **The sign-in moved to a path (`/entree`)**: the addresses already sent and the shell's own redirections use the fragment.
- **English as separate pages rendered on the server (`/en/...`)**: the site's switch is in the page and kept per viewer; templates keep that behaviour without an HTML string and without a Trusted Types policy.
- **The site's colours kept in its own stylesheet**: ADR-0019 gives every colour to the layer; the guard would need an exception.

## Consequences

- **Positive**: one origin and one security policy for the app and its public pages; `/stand` answers what the QR code holds; every `/#/` address of the app keeps working, `/#/entree` included; the site's look is kept (each page compared pixel for pixel with the original, at three widths, in both themes).
- **Negative, accepted**: an address of the app opened from outside (typed, a bookmark, a reload) loads two documents, the site's head then the shell; a member who types `app.runward.dev` lands on the site, and "Se connecter" opens the fleet at once while the session holds; the layer gains a section the shell does not read; the shell's branch for a public screen (`shell.js`, the public links, and its styles in `app.css`) has no screen left and is removed by a later change.
- **On other boundaries**: the API contract is unchanged (the pages are served before the route table; digest `103d9faf...`); the deploy's smoke checks the site at `/` and the shell at `/app`; `x-robots-tag: noindex, nofollow` stays on every response (the site says `noindex` itself); the contact is a `mailto:` to one address and posts nothing (`form-action 'none'` unchanged).

## Reevaluation trigger (mandatory, dated)

Reopen on 2026-11-19, on what the two days of the stand showed, or earlier when: the real index replaces `donnees.json` (the read of point 6 changes, and the record says where the data comes from); the site must be indexed (`x-robots-tag` changes for its pages); the site needs a framework (docs, blog, more languages); opening an address of the app from outside is measured above one second on a phone.

**Trigger set on**: 2026-11-11 · **Watched via**: `test/unit/site.test.js`, `test/unit/tokens.test.js`, `scripts/smoke.mjs`, the deploy's smoke

## References

- ADR-0001 (no framework), ADR-0019 (the app's own layer), ADR-0005 (passkeys and the sign-in)
- `src/http/site.js`, `src/http/assets.js` (`SITE_FILES`), `src/http/server.js`, `web/site/`, `web/app.js`, `web/views/router.js`
- The mini-site's sources and its fact-check of 2026-11-10 (the author's private folder)
