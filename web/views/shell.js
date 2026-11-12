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
//
// The fixed shell (ADR-0036, refining ADR-0034): on a desk (1024 px and more) the sidebar and the top bar stay where
// they are and the page never scrolls as a whole: a screen scrolls inside its own area, and a screen of panes
// (`v.main === "volets"`, web/views/volets.js) inside each of its panes. The sidebar keeps its four entries and the
// technical views; the applications are listed by their screen, no longer by the sidebar. « À faire » is a count in
// the top bar that opens a drawer. Under 1024 px: the top bar (the way back in a detail), the screen, and a tab bar at
// the bottom with the four entries; the menu keeps the language, the technical views and the sign-out.
import { S, esc, setHTML, latEl, mobNavEl, menuBtnEl, colonneEl, bandEl, stampEl, filEls, langueEls, piedEl, parts, main, annonceEl, retourEl, tabsEl, afaireEl, tiroirEl, voileTEl } from "./base.js";
import { when } from "./time.js";
import { MARK, go, act } from "./marks.js";
import { lang, mots, titreFlotte, appareil, studioUrl, siteUrl } from "./lexique.js";
import { ask, confirmBox } from "./confirm.js";
import { versSection } from "./liens.js";
import { aFaire, aFaireConnu, blocAFaire, nombreAFaire, compteTemoin } from "./afaire.js";
import { garder, rendre } from "./volets.js";

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
/** The icons of the four entries (strokes in the ink, the shape says the entry, never a colour). */
const ICON = {
  apps: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><path d="M4 10h12" stroke-dasharray="1.5 2"/><circle cx="4" cy="10" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/><rect x="14.4" y="8.4" width="3.2" height="3.2" transform="rotate(45 16 10)" fill="currentColor" stroke="none"/></svg>',
  connect: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="14" height="14" rx="4"/><path d="M10 7v6M7 10h6"/></svg>',
  journal: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 5h10M6 10h10M6 15h6"/><circle cx="3" cy="5" r=".9" fill="currentColor"/><circle cx="3" cy="10" r=".9" fill="currentColor"/><circle cx="3" cy="15" r=".9" fill="currentColor"/></svg>',
  account: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10" cy="7" r="3.2"/><path d="M3.8 17c.9-3.2 3.3-5 6.2-5s5.3 1.8 6.2 5"/></svg>',
  back: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>',
  close: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};
/** The four entries, in order: [key, address, is it the current screen]; « Brancher » is not offered to the control account. */
function entries(route) {
  return [["apps", "#/", route === "decision" || route === ""], ["connect", "#/declarer", route === "declarer"], ["journal", "#/envois", route === "envois"], ["account", "#/acces", route === "acces"]]
    .filter(([k]) => k !== "connect" || !compteTemoin());
}
function liensCoque(route) {
  const F = mots().frame;
  const cur = (cond) => (cond ? ' aria-current="page"' : "");
  const n = nombreAFaire();
  // the count of what waits, when there is any and it is known; else nothing (no count that is not the items')
  const badge = n ? `<span class="badge num" aria-hidden="true">${n}</span><span class="vh">${esc(F.todoBadge(n))}</span>` : "";
  const principaux = entries(route).map(([k, h, c]) => `<a class="it" href="${h}"${cur(c)}>${ICON[k]}<span>${esc(F[k])}</span>${k === "apps" ? badge : ""}</a>`).join("");
  const ouvertes = vuesOuvertes();
  const vues = ouvertes ? VUES_TECHNIQUES.map((r) => `<a class="it" href="#/${r}"${cur(route === r)}><span>${esc(F.views[r])}</span></a>`).join("") : "";
  return { principaux, vues, ouvertes, tech: VUES_TECHNIQUES.includes(route) || route === "mission" };
}
/** The tab bar of a phone: the four entries, their icon and a short word, the count on « Applications ». */
function onglets(route) {
  const F = mots().frame, C = mots().coque, n = nombreAFaire();
  return entries(route).map(([k, h, c]) => `<a class="tab" href="${h}"${c ? ' aria-current="page"' : ""}>${ICON[k]}<span>${esc(k === "connect" ? C.tabConnect : F[k])}</span>${k === "apps" && n ? `<span class="badge num" aria-hidden="true">${n}</span><span class="vh">${esc(F.todoBadge(n))}</span>` : ""}</a>`).join("");
}
/** The technical views' group: folded (open on one of them), or closed and greyed with its reason. */
function groupeTech(L, F) {
  return L.ouvertes
    ? `<details class="tech"${L.tech ? " open" : ""}><summary class="sec">${esc(F.technical)}</summary><nav aria-label="${esc(F.technical)}">${L.vues}</nav></details>`
    : `<div class="tech ferme"><p class="sec">${esc(F.technical)}</p><p class="tech-note">${esc(F.technicalClosed)}</p></div>`;
}
function lat(route) {
  const F = mots().frame, L = liensCoque(route);
  const s = S.session;
  const role = s.member.role === "owner" ? F.owner : s.member.role;
  const out = `<button class="lien" type="button" data-do="logout">${esc(F.signOut)}</button>`;
  const qui = compteTemoin() ? F.witnessName : titreFlotte(s.tenant.title);
  return {
    lat: `<div class="lat-in"><a class="marque" href="#/" translate="no">${MARK}runward<span>${esc(F.page.brandSuffix)}</span></a>
    <nav aria-label="${esc(F.navService)}">${L.principaux}</nav>
    ${groupeTech(L, F)}
    <div class="bas"><span><b>${esc(qui)}</b><br>${esc(F.you(role, s.passkeys))}</span>${out}</div></div>`,
    // the phone menu: the four entries are the tab bar's; it keeps the language, the technical views and the sign-out
    mobnav: `<span class="langue" role="group" aria-label="${esc(F.page.langGroup)}">${langue()}</span>${groupeTech(L, F)}<div class="bas"><span><b>${esc(qui)}</b><br>${esc(F.you(role, s.passkeys))}</span>${out}</div>`,
  };
}

// ------------------------------------------------------------- banners and shell
function bandeaux(route, sub) {
  const F = mots().frame, b = [], s = S.session;
  // the service's control account says so on every screen, before anything else (ADR-0034)
  if (s && compteTemoin()) b.push(`<div class="bandeau temoin" role="note"><p>${esc(F.witness)}</p></div>`);
  if (s?.recovery) b.push(`<div class="bandeau" role="alert"><p>${F.recovery(when(s.recovery.openedAt, { sec: false }), when(s.recovery.usableFrom, { sec: false }))}</p><div class="actions">${ask(`recovery:${s.recovery.id}`, F.recoveryCancel, false)}</div>${confirmBox(`recovery:${s.recovery.id}`)}</div>`);
  // « À faire » heads the list of applications (its strip, web/views/decision.js) and the drawer of the top bar; on the
  // screen of Applications it carries the second passkey when it is missing, so the banner that says it is not repeated
  const applications = Boolean(s) && (route === "decision" || route === "");
  const todo = applications && aFaireConnu() && aFaire().some((i) => i.kind === "passkey");
  if (s && s.passkeys === 1 && !todo) b.push(`<div class="bandeau"><p>${F.single}</p><div class="actions">${go(s.arrivalDone ? "#/acces/ajout" : "#/arrivee", F.addPasskey, { q: true })}</div></div>`);
  for (const p of s?.addedElsewhere ?? []) b.push(`<div class="bandeau" role="alert"><p>${F.added(when(p.createdAt, { sec: false }), p.device ? esc(appareil(p.device)) : "", p.provider ? esc(appareil(p.provider)) : "")}</p><div class="actions">${go(versSection("cles"), F.seePasskeys, { q: true })}</div></div>`);
  if (S.newVersion) b.push(`<div class="bandeau"><p>${F.newVersion}</p><div class="actions">${act("reload", F.reload, { q: true })}</div></div>`);
  if (s?.maintenance) b.push(`<div class="bandeau"><p>${F.maintenance(s.maintenance.until ? when(s.maintenance.until, { sec: false }) : "")}</p></div>`);
  return b.join("");
}
/** The switch of the reader's language, the same on every screen (the header, and the trail's line on a phone). */
export const langue = () => ["fr", "en"].map((l) => `<button type="button" data-do="lecture-lang" data-k="${l}" data-focus-key="lecture-lang:${l}" lang="${l}" aria-pressed="${l === lang()}">${l.toUpperCase()}</button>`).join("");
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
  const side = signedIn ? lat(route) : { lat: "", mobnav: "" };
  return {
    lat: side.lat, mobnav: side.mobnav,
    tabs: signedIn ? onglets(route) : "",
    afaire: signedIn ? boutonAFaire() : "",
    retour: signedIn && v.crumb?.length > 1 && v.crumb[0][1] ? `<a class="retour" href="${esc(v.crumb[0][1])}">${ICON.back}<span>${esc(v.crumb[0][0])}</span></a>` : "",
    tiroir: signedIn ? tiroirHTML() : "",
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
 * answers: the screen under it, the tab bar, the banners and the foot are inert.
 */
export function menu(open) {
  const on = Boolean(open ?? !colonneEl.classList.contains("menu-ouvert")) && !menuBtnEl.hidden;
  colonneEl.classList.toggle("menu-ouvert", on);
  menuBtnEl.setAttribute("aria-expanded", String(on));
  for (const el of [main, tabsEl, bandEl, piedEl]) el.inert = on;
  mobNavEl.inert = !on;
  return on;
}

// ------------------------------------------------------------- « À faire » in the top bar, and its drawer
/** The top bar's button: « À faire » and its count, once the items are known; nothing before (no count that is not theirs). */
function boutonAFaire() {
  if (!aFaireConnu()) return "";
  const C = mots().coque, n = aFaire().length;
  return `<button class="afaire-btn" type="button" data-do="afaire" data-focus-key="afaire" data-n="${n}" aria-haspopup="dialog" aria-label="${esc(n ? C.todoOpen(n) : C.todo)}">${esc(C.todo)}${n ? `<span class="badge num" aria-hidden="true">${n}</span>` : ""}</button>`;
}
/** The drawer's content: its close button, then the whole block of « À faire », or the sentence that nothing waits. */
function tiroirHTML() {
  const C = mots().coque;
  const body = blocAFaire() || `<section class="afaire" aria-labelledby="h-afaire"><h2 class="af-h" id="h-afaire">${esc(C.todo)}</h2><p class="af-p">${esc(C.todoNone)}</p></section>`;
  return `<button class="x" type="button" data-do="afaire-close" aria-label="${esc(C.close)}">${ICON.close}</button>${body}`;
}
let ouvreur = null;
/**
 * The drawer « À faire »: open or closed. Open, it is the one thing that answers (the page under it is inert), the
 * focus goes to its close button and stays inside it; closed, the focus goes back to what opened it. It shows and
 * goes with a transition that ends (its class), none under reduced motion; its veil is hidden after the transition.
 */
export function tiroir(open) {
  const on = Boolean(open);
  if (on === !tiroirEl.hidden && on === tiroirEl.classList.contains("on")) return on;
  S.tiroir = on;
  document.getElementById("corps").inert = on;
  tabsEl.inert = on;
  if (on) {
    ouvreur = document.activeElement;
    setHTML(tiroirEl, tiroirHTML());
    if (lang() === "fr") nbsp(tiroirEl);
    tiroirEl.hidden = false; voileTEl.hidden = false;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => { tiroirEl.classList.add("on"); voileTEl.classList.add("on"); }));
    tiroirEl.querySelector("[data-do='afaire-close']")?.focus();
  } else {
    tiroirEl.classList.remove("on"); voileTEl.classList.remove("on");
    setTimeout(() => { if (!S.tiroir) { tiroirEl.hidden = true; voileTEl.hidden = true; } }, 260);
    ouvreur?.focus?.();
    ouvreur = null;
  }
  return on;
}
/**
 * The menu exists under 1024 px only (web/coque.css hides its button, its veil and its sheet above). A window that
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
  // the panes (ADR-0036): which one a phone shows, the list or the detail; and whether the screen is a window of panes
  document.body.dataset.ecran = v.ecran ?? "liste";
  document.body.classList.toggle("volets", v.main === "volets");
  latEl.hidden = !signedIn; menuBtnEl.hidden = !signedIn; tabsEl.hidden = !signedIn;
  menu(false);
  pageWords();
  setHTML(latEl, f.lat);
  setHTML(mobNavEl, f.mobnav);
  setHTML(tabsEl, f.tabs);
  setHTML(afaireEl, f.afaire);
  setHTML(retourEl, f.retour);
  // a drawer open across a repaint (a live update, a switch of language) is written again with what was read
  if (S.tiroir && signedIn) { setHTML(tiroirEl, f.tiroir); if (lang() === "fr") nbsp(tiroirEl); } else if (S.tiroir) tiroir(false);
  setHTML(stampEl, f.stamp);
  for (const el of filEls) setHTML(el, f.fil);
  for (const el of langueEls) setHTML(el, f.langue);
  setHTML(piedEl, f.pied);
  setHTML(bandEl, f.bandeaux);
}

export function paint(v) {
  const { route, sub } = parts();
  // a screen of panes keeps, across a repaint of itself, each pane's scroll, its open folds and the focus (volets.js)
  const memo = v.main === "volets" ? garder() : null;
  if (v.main !== "volets") S.volets = null;
  shell(Boolean(S.session) && v.signed !== "out", v.fleetRoute ?? route, sub, v);
  main.className = v.main ?? "";
  setHTML(main, v.html);
  document.title = `${v.title ? `${v.title} · ` : ""}${mots().brand}`;
  after(v);
  if (memo) rendre(memo, v);
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
  // a key may be carried twice (the language switch, in the header and in the phone menu): the one shown
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
