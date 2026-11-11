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
import { lang, mots, titreFlotte, appareil, studioUrl } from "./lexique.js";
import { comptes, triees, verdictOf, nomCourt } from "./lignes.js";
import { ask, confirmBox } from "./confirm.js";

/** The house's signature in the foot: its name links to the studio's page, whose address is kept beside the lexicon (ADR-0026). */
const studio = () => `<a href="${esc(studioUrl())}" translate="no">Another Framework</a>`;

// --- the shell: the sidebar (desktop) and the menu (phone), the same links
function liensCoque(route, sub) {
  const F = mots().frame;
  const cur = (cond) => (cond ? ' aria-current="page"' : "");
  const exp = route === "acces" && /^export/.test(sub);
  const N = comptes();
  // the marker of the current line is a piece of its own: it is carried from one screen to the next (web/mouvement.css)
  const REPERE = `<span class="repere" aria-hidden="true"></span>`;
  const a = (h, w, n, c) => `<a class="it" href="${h}"${cur(c)}>${c ? REPERE : ""}${esc(w)}${n != null ? `<span class="n0 num">${n}</span>` : ""}</a>`;
  const principaux = [a("#/", F.portfolio, S.index ? N.N : null, route === "decision" && !sub), a("#/envois", F.uploads, S.status?.head?.seq ?? S.journal?.head?.seq ?? null, route === "envois"), a("#/acces", F.access, null, route === "acces" && !exp), a("#/acces/export", F.export, null, exp)].join("");
  // the applications, each opening its decision reading, its state said by the reading's own mark (shape, then hue);
  // a name of any length wraps inside its line (web/app.css), never past the sidebar or the menu
  const missions = triees().map((m) => `<a class="it mis" href="#/decision/${esc(m.id)}"${cur((route === "decision" || route === "mission") && sub === m.id)}>${(route === "decision" || route === "mission") && sub === m.id ? REPERE : ""}<span class="etq" data-state="${esc(verdictOf(m))}"><span data-role="mark" aria-hidden="true"></span><span translate="no">${esc(nomCourt(m))}</span></span></a>`).join("");
  const vues = ["flotte", "vue", "history", "proof", "signatures", "pr", "sources"].map((r) => a(`#/${r}`, F.views[r], null, route === r)).join("");
  return { principaux, missions, vues };
}
function lat(route, sub) {
  const F = mots().frame, L = liensCoque(route, sub);
  const s = S.session;
  const role = s.member.role === "owner" ? F.owner : s.member.role;
  const out = `<button class="lien" type="button" data-do="logout">${esc(F.signOut)}</button>`;
  return {
    lat: `<div class="lat-in"><a class="marque" href="#/" translate="no">${MARK}runward<span>${esc(F.page.brandSuffix)}</span></a>
    <nav aria-label="${esc(F.navService)}">${L.principaux}</nav>
    ${L.missions ? `<p class="sec">${esc(F.applications)}</p><nav aria-label="${esc(F.navApplications)}">${L.missions}</nav>` : `<p class="sec">${esc(F.applications)}</p><nav aria-label="${esc(F.applications)}"><a class="it" href="#/">${esc(F.inPortfolio)}</a></nav>`}
    <p class="sec">${esc(F.technical)}</p><nav aria-label="${esc(F.technical)}">${L.vues}</nav>
    <div class="bas"><span><b>${esc(titreFlotte(s.tenant.title))}</b><br>${esc(F.you(role, s.passkeys))}</span>${out}</div></div>`,
    mobnav: `${L.principaux}${L.missions ? `<p class="sec">${esc(F.applications)}</p>${L.missions}` : ""}<p class="sec">${esc(F.technical)}</p>${L.vues}${out}`,
  };
}

// ------------------------------------------------------------- banners and shell
function bandeaux() {
  const F = mots().frame, b = [], s = S.session;
  if (s?.recovery) b.push(`<div class="bandeau" role="alert"><p>${F.recovery(when(s.recovery.openedAt, { sec: false }), when(s.recovery.usableFrom, { sec: false }))}</p><div class="actions">${ask(`recovery:${s.recovery.id}`, F.recoveryCancel, false)}</div>${confirmBox(`recovery:${s.recovery.id}`)}</div>`);
  if (s && s.passkeys === 1) b.push(`<div class="bandeau"><p>${F.single}</p><div class="actions">${go(s.arrivalDone ? "#/acces/ajout" : "#/arrivee", F.addPasskey, { q: true })}</div></div>`);
  for (const p of s?.addedElsewhere ?? []) b.push(`<div class="bandeau" role="alert"><p>${F.added(when(p.createdAt, { sec: false }), p.device ? esc(appareil(p.device)) : "", p.provider ? esc(appareil(p.provider)) : "")}</p><div class="actions">${go("#/acces", F.seePasskeys, { q: true })}</div></div>`);
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
    pied: `<a href="#/legal">${esc(F.legal)}</a><a href="#/legal">${esc(F.privacy)}</a><a href="#/legal">${esc(F.security)}</a><span>${esc(F.times)}</span><span class="signe">${F.signature(studio())}</span>`,
    bandeaux: bandeaux(),
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
  main.className = v.main ?? ""; main.style.minHeight = "";
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
}
export function say(msg) { annonceEl.textContent = ""; setTimeout(() => { annonceEl.textContent = msg; }, 60); }
