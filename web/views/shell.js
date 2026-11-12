// The shell of direction A (« la coque »): the sidebar (desktop) and the menu (phone), the banners, the top
// bar and the foot around a screen, and the painting of a screen into the page. The frame speaks the reader's
// language (web/views/lexique.js), the one the decision reading and the public site use: every word of it, the
// elements of web/index.html included, is painted again with each screen, so a switch of language reaches it at once.
//
// Where the next lots place what they bring, without writing the same lines:
//   - a link to a new screen: one entry in liensCoque (the sidebar and the phone menu read the same list);
//   - the theme selector: its button is the element carrying data-theme-btn, in the header (web/index.html); its
//     behaviour is web/views/theme.js, and nothing else in the shell knows the theme.
//
// The frame is the public site's (ADR-0025): one header on every screen (the screen's title or its trail, the
// language, the theme; on a phone the brand and the menu), a translucent sidebar, the scene behind.
import { S, esc, setHTML, latEl, mobNavEl, menuBtnEl, colonneEl, bandEl, barTelEl, stampEl, filEls, langueEls, piedEl, parts, main, annonceEl } from "./base.js";
import { when } from "./time.js";
import { MARK, go, act } from "./marks.js";
import { lang, mots, titreFlotte, appareil, studioUrl, siteUrl } from "./lexique.js";
import { comptes, triees, verdictOf, nomCourt } from "./lignes.js";
import { ask, confirmBox } from "./confirm.js";
import { versSection, prochainPas } from "./liens.js";
import { aFaire, blocAFaire, nombreAFaire, compteTemoin } from "./afaire.js";

// The foot's first link is the public site, runward.dev, in the reader's language (ADR-0028): this origin has no
// public page of its own, and the sign-in is where a visitor of app.runward.dev arrives.
/** The house's signature in the foot: its name links to the studio's page, whose address is kept beside the lexicon (ADR-0026). */
const studio = () => `<a href="${esc(studioUrl())}" translate="no">Another Framework</a>`;

// --- the shell: the sidebar (desktop) and the menu (phone), the same links (ADR-0034, which refines ADR-0025 and
// ADR-0028): four entries (Applications, with the count of what waits for a gesture; Brancher une application;
// Journal; Compte, which holds the export since « Récupérer vos données » is one of its sections), then one line per
// application, then the technical views, folded, and closed with their reason until the first check is confirmed
/** The technical views, by route, in the order of the menu. */
export const VUES_TECHNIQUES = ["flotte", "vue", "history", "proof", "signatures", "pr", "sources"];
/** Are the technical views open? Once the first check of an application is confirmed (the router's gate, the same). */
export const vuesOuvertes = () => Boolean(S.session?.arrivalDone);
function liensCoque(route, sub) {
  const F = mots().frame;
  const cur = (cond) => (cond ? ' aria-current="page"' : "");
  const N = comptes();
  const n = nombreAFaire();
  const a = (h, w, extra, c) => `<a class="it" href="${h}"${cur(c)}><span>${esc(w)}</span>${extra}</a>`;
  // the count of what waits, when there is any; else the number of applications in the portfolio
  const badge = n ? `<span class="badge num" aria-hidden="true">${n}</span><span class="vh">${esc(F.todoBadge(n))}</span>` : S.index ? `<span class="n0 num">${N.N}</span>` : "";
  const principaux = [
    a("#/", F.apps, badge, (route === "decision" || route === "") && !sub),
    compteTemoin() ? "" : a("#/declarer", F.connect, "", route === "declarer" && !sub),
    a("#/envois", F.journal, "", route === "envois"),
    a("#/acces", F.account, "", route === "acces"),
  ].join("");
  // the applications, each opening its decision reading, its state said by the reading's own mark (shape, then hue);
  // then those declared whose first check is awaited, each opening its next step. A name of any length wraps inside
  // its line (web/app.css), never past the sidebar or the menu
  const enIndex = triees();
  const publiees = enIndex.map((m) => `<a class="it mis" href="#/decision/${esc(m.id)}"${cur((route === "decision" || route === "mission") && sub === m.id)}><span class="etq" data-state="${esc(verdictOf(m))}"><span data-role="mark" aria-hidden="true"></span><span translate="no">${esc(nomCourt(m))}</span></span></a>`).join("");
  const attendues = (S.status?.lines ?? []).filter((l) => !enIndex.some((m) => m.id === l.mission))
    .map((l) => `<a class="it mis" href="${esc(prochainPas(l).href)}"><span class="etq" data-state="not-observed"><span data-role="mark" aria-hidden="true"></span><span translate="no">${esc(l.mission)}</span></span></a>`).join("");
  const missions = publiees + attendues;
  const ouvertes = vuesOuvertes();
  const vues = ouvertes ? VUES_TECHNIQUES.map((r) => a(`#/${r}`, F.views[r], "", route === r)).join("") : "";
  return { principaux, missions, vues, ouvertes, tech: VUES_TECHNIQUES.includes(route) || route === "mission" };
}
/** The technical views' group: folded (open on one of them), or closed and greyed with its reason. */
function groupeTech(L, F) {
  return L.ouvertes
    ? `<details class="tech"${L.tech ? " open" : ""}><summary class="sec">${esc(F.technical)}</summary><nav aria-label="${esc(F.technical)}">${L.vues}</nav></details>`
    : `<div class="tech ferme"><p class="sec">${esc(F.technical)}</p><p class="tech-note">${esc(F.technicalClosed)}</p></div>`;
}
function lat(route, sub) {
  const F = mots().frame, L = liensCoque(route, sub);
  const s = S.session;
  const role = s.member.role === "owner" ? F.owner : s.member.role;
  const out = `<button class="lien" type="button" data-do="logout">${esc(F.signOut)}</button>`;
  const apps = `<p class="sec">${esc(F.applications)}</p>${L.missions ? `<nav aria-label="${esc(F.navApplications)}">${L.missions}</nav>` : `<p class="sec-vide">${esc(F.appsNone)}</p>`}`;
  const qui = compteTemoin() ? F.witnessName : titreFlotte(s.tenant.title);
  return {
    lat: `<div class="lat-in"><a class="marque" href="#/" translate="no">${MARK}runward<span>${esc(F.page.brandSuffix)}</span></a>
    <nav aria-label="${esc(F.navService)}">${L.principaux}</nav>
    ${apps}
    ${groupeTech(L, F)}
    <div class="bas"><span><b>${esc(qui)}</b><br>${esc(F.you(role, s.passkeys))}</span>${out}</div></div>`,
    mobnav: `${L.principaux}${apps}${groupeTech(L, F)}${out}`,
  };
}

// ------------------------------------------------------------- banners and shell
function bandeaux(route, sub) {
  const F = mots().frame, b = [], s = S.session;
  // the service's control account says so on every screen, before anything else (ADR-0034)
  if (s && compteTemoin()) b.push(`<div class="bandeau temoin" role="note"><p>${esc(F.witness)}</p></div>`);
  if (s?.recovery) b.push(`<div class="bandeau" role="alert"><p>${F.recovery(when(s.recovery.openedAt, { sec: false }), when(s.recovery.usableFrom, { sec: false }))}</p><div class="actions">${ask(`recovery:${s.recovery.id}`, F.recoveryCancel, false)}</div>${confirmBox(`recovery:${s.recovery.id}`)}</div>`);
  // « À faire », the first block of the portfolio (the screen one lands on after the sign-in); it carries the second
  // passkey when it is missing, so the banner that says it is not repeated there
  const portefeuille = Boolean(s) && (route === "decision" || route === "") && !sub;
  const todo = portefeuille ? blocAFaire() : "";
  if (todo) b.push(todo);
  if (s && s.passkeys === 1 && !(todo && aFaire().some((i) => i.kind === "passkey"))) b.push(`<div class="bandeau"><p>${F.single}</p><div class="actions">${go(s.arrivalDone ? "#/acces/ajout" : "#/arrivee", F.addPasskey, { q: true })}</div></div>`);
  for (const p of s?.addedElsewhere ?? []) b.push(`<div class="bandeau" role="alert"><p>${F.added(when(p.createdAt, { sec: false }), p.device ? esc(appareil(p.device)) : "", p.provider ? esc(appareil(p.provider)) : "")}</p><div class="actions">${go(versSection("cles"), F.seePasskeys, { q: true })}</div></div>`);
  if (S.newVersion) b.push(`<div class="bandeau"><p>${F.newVersion}</p><div class="actions">${act("reload", F.reload, { q: true })}</div></div>`);
  if (s?.maintenance) b.push(`<div class="bandeau"><p>${F.maintenance(s.maintenance.until ? when(s.maintenance.until, { sec: false }) : "")}</p></div>`);
  return b.join("");
}
/** The switch of the reader's language, the same on every screen (the header, and the trail's line on a phone). */
const langue = () => ["fr", "en"].map((l) => `<button type="button" data-do="lecture-lang" data-k="${l}" data-focus-key="lecture-lang:${l}" lang="${l}" aria-pressed="${l === lang()}">${l.toUpperCase()}</button>`).join("");
/** The header's trail: the screen's title, or the way back to it (`v.crumb`: [[label, address], ..., [label]]). */
function fil(v) {
  if (!v.crumb) return v.title ? `<b>${esc(v.title)}</b>` : "";
  return v.crumb.map(([label, href, verbatim]) => (href ? `<a href="${esc(href)}">${esc(label)}</a><span aria-hidden="true">/</span>` : `<b${verbatim ? ' translate="no"' : ""}>${esc(label)}</b>`)).join("");
}
/**
 * The frame around a screen, in the reader's language, as HTML for each of its elements: the sidebar and the phone
 * menu, the header's host (signed out), its trail (signed in) and its language switch, the banners and the foot.
 * `paint` writes them; nothing here touches the page.
 */
export function frame(signedIn, route, sub, v) {
  const F = mots().frame;
  const side = signedIn ? lat(route, sub) : { lat: "", mobnav: "" };
  return {
    lat: side.lat, mobnav: side.mobnav,
    stamp: signedIn ? "" : esc(location.host),
    fil: signedIn ? fil(v) : "",
    langue: langue(),
    pied: `<a href="${esc(siteUrl())}" translate="no">runward.dev</a><a href="#/legal">${esc(F.legal)}</a><a href="#/legal">${esc(F.privacy)}</a><a href="#/legal">${esc(F.security)}</a><span>${esc(F.times)}</span><span class="signe">${F.signature(studio())}</span>`,
    bandeaux: bandeaux(signedIn ? route : null, sub),
  };
}
/** The page's own elements (web/index.html) that carry a word: data-mot (their text), data-mot-aria (their label). */
function pageWords() {
  const P = mots().frame.page;
  document.documentElement.lang = lang();
  for (const el of document.querySelectorAll("[data-mot]")) if (Object.hasOwn(P, el.dataset.mot)) el.textContent = P[el.dataset.mot];
  for (const el of document.querySelectorAll("[data-mot-aria]")) if (Object.hasOwn(P, el.dataset.motAria)) el.setAttribute("aria-label", P[el.dataset.motAria]);
}
/**
 * The phone menu: open or closed (the sheet, its veil, the button's state). While it is open it is the one thing that
 * answers: the screen under it, the trail's line, the banners and the foot are inert.
 */
export function menu(open) {
  const on = Boolean(open ?? !colonneEl.classList.contains("menu-ouvert")) && !menuBtnEl.hidden;
  colonneEl.classList.toggle("menu-ouvert", on);
  menuBtnEl.setAttribute("aria-expanded", String(on));
  for (const el of [main, barTelEl, bandEl, piedEl]) el.inert = on;
  mobNavEl.inert = !on;
  return on;
}
/**
 * The menu exists under 900 px only (web/app.css hides its button, its veil and its sheet above). A window that
 * crosses that width with the menu open (a tablet turned, a window widened) would keep a screen that ignores every
 * tap with nothing to show for it: the menu is closed when the width is crossed.
 */
export function closeMenuWhenWide(wide) {
  wide.addEventListener("change", (e) => { if (e.matches) menu(false); });
}
function shell(signedIn, route, sub, v) {
  const f = frame(signedIn, route, sub, v);
  document.body.classList.toggle("connecte", signedIn);
  // the control account: a screen may hide what has no use there (web/app.css, [data-hors-temoin])
  document.body.classList.toggle("temoin", signedIn && compteTemoin());
  // the scene: calm behind a screen of data; the sign-in alone asks for the whole one (v.scene)
  document.body.dataset.scene = v.scene ?? "calme";
  latEl.hidden = !signedIn; menuBtnEl.hidden = !signedIn;
  menu(false);
  pageWords();
  setHTML(latEl, f.lat);
  setHTML(mobNavEl, f.mobnav);
  setHTML(stampEl, f.stamp);
  for (const el of filEls) setHTML(el, f.fil);
  for (const el of langueEls) setHTML(el, f.langue);
  setHTML(piedEl, f.pied);
  setHTML(bandEl, f.bandeaux);
}

export function paint(v) {
  const { route, sub } = parts();
  shell(Boolean(S.session) && v.signed !== "out", v.fleetRoute ?? route, sub, v);
  main.className = v.main ?? "";
  setHTML(main, v.html);
  document.title = `${v.title ? `${v.title} · ` : ""}${mots().brand}`;
  after(v);
}
/** French typography: a no-break space before « : ; ? ! » and after « (the French text only). */
function nbsp(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (n.parentElement?.closest("code,pre,script,style,[lang='en']")) continue;
    const t = n.textContent.replace(/ ([:;?!»])/g, " $1").replace(/« /g, "« ");
    if (t !== n.textContent) n.textContent = t;
  }
}
function after(v) {
  if (lang() === "fr") [main, bandEl, piedEl].forEach(nbsp);
  main.querySelectorAll("[data-verbatim], .md").forEach((el) => { if (/\b(the|and|is|not|of|to|does|it|no|that|this|are|be|has|by|for|or)\b/i.test(el.textContent)) el.setAttribute("lang", "en"); });
  main.querySelectorAll(".tw:not([tabindex])").forEach((el) => { el.tabIndex = 0; el.setAttribute("role", "region"); el.setAttribute("aria-label", mots().frame.scrollTable); });
  // a key may be carried twice (the language switch, in the header and on the trail's line of a phone): the one shown
  const keyed = S.focusKey ? [...document.querySelectorAll(`[data-focus-key="${CSS.escape(S.focusKey)}"]`)].find((el) => el.getClientRects().length > 0) : null;
  const f = document.querySelector("[data-focus]") || keyed || (v.focus ? main.querySelector(v.focus) : null);
  (f ?? main).focus({ preventScroll: true });
  S.focusKey = null;
  arrival(v);
}
/**
 * A new address opens at the top of its screen; an address that names a place on it (`v.cible`, web/views/liens.js)
 * opens on that place: brought into view and shown for a moment, once per arrival. The focus is already there (the
 * screen names it as its `focus`), so a screen reader says it. The mark is a class the stylesheet draws with a
 * transition, which reduced motion removes (web/famille.css); it is taken off after 1.6 s whatever happens.
 */
function arrival(v) {
  const h = location.hash;
  const fresh = S.vuePeinte !== h;
  S.vuePeinte = h;
  const el = v.cible && S.cibleVue !== h ? main.querySelector(v.cible) : null;
  if (el) {
    S.cibleVue = h;
    el.scrollIntoView?.({ block: el.matches("button, a") ? "center" : "start" });
    const zone = el.closest(".arow, section") ?? el;
    zone.classList.add("cible");
    setTimeout(() => zone.classList.remove("cible"), 1600);
  } else if (fresh && !v.cible) window.scrollTo?.(0, 0);
}
export function say(msg) { annonceEl.textContent = ""; setTimeout(() => { annonceEl.textContent = msg; }, 60); }
