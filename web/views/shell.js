// The shell of direction A (« la coque »): the sidebar (desktop) and the menu (phone), the banners, the top
// bar and the foot around a screen, and the painting of a screen into the page.
//
// Where the next lots place what they bring, without writing the same lines:
//   - a link to a new screen: one entry in liensCoque (the sidebar and the phone menu read the same list);
//   - the theme selector: its buttons are the elements carrying data-theme-btn, placed here (the sidebar's
//     foot, the phone menu of the public home) and in web/index.html (the top bar); its behaviour is
//     web/views/theme.js, and nothing else in the shell knows the theme.
import { S, esc, setHTML, latEl, mobNavEl, bandEl, mobEl, stampEl, pubEl, topActEl, piedEl, parts, main, annonceEl } from "./base.js";
import { when } from "./time.js";
import { MARK, go, act, THEME_ICON } from "./marks.js";
import { comptes, triees, verdictOf, nomCourt, MAILTO } from "./lexique.js";
import { ask, confirmBox } from "./confirm.js";

// --- the shell: the sidebar (desktop) and the menu (phone), the same links
function liensCoque(route, sub) {
  const cur = (cond) => (cond ? ' aria-current="page"' : "");
  const exp = route === "acces" && /^export/.test(sub);
  const N = comptes();
  const a = (h, w, n, c) => `<a class="it" href="${h}"${cur(c)}>${w}${n != null ? `<span class="n0">${n}</span>` : ""}</a>`;
  const principaux = [a("#/", "Portefeuille", S.index ? N.N : null, route === "decision" && !sub), a("#/envois", "Envois", S.status?.head?.seq ?? S.journal?.head?.seq ?? null, route === "envois"), a("#/acces", "Accès", null, route === "acces" && !exp), a("#/acces/export", "Export", null, exp)].join("");
  // the applications, each opening its decision reading, its state said by the reading's own mark (shape, then hue)
  const missions = triees().map((m) => `<a class="it mis" href="#/decision/${esc(m.id)}"${cur((route === "decision" || route === "mission") && sub === m.id)}><span class="etq" data-state="${esc(verdictOf(m))}"><span data-role="mark" aria-hidden="true"></span><span translate="no">${esc(nomCourt(m))}</span></span></a>`).join("");
  const vues = [["flotte", "Tableau de bord"], ["vue", "Vue complète"], ["history", "Historique"], ["proof", "Preuve"], ["signatures", "Signatures"], ["pr", "Dans la PR"], ["sources", "Sources"]].map(([r, w]) => a(`#/${r}`, w, null, route === r)).join("");
  return { principaux, missions, vues };
}
function renderLat(route, sub) {
  const L = liensCoque(route, sub);
  const s = S.session;
  setHTML(latEl, `<div class="lat-in"><a class="marque" href="#/" translate="no">${MARK}runward<span> hébergé</span></a>
    <nav aria-label="Vues du service">${L.principaux}</nav>
    ${L.missions ? `<p class="sec">Applications</p><nav aria-label="Applications, refusées par le contrôle d'abord">${L.missions}</nav>` : `<p class="sec">Applications</p><nav aria-label="Applications"><a class="it" href="#/">dans le portefeuille</a></nav>`}
    <p class="sec">Vues techniques</p><nav aria-label="Vues techniques">${L.vues}</nav>
    <div class="bas"><span><b>${esc(s.tenant.title)}</b><br>vous · ${esc(s.member.role === "owner" ? "propriétaire" : s.member.role)} · ${s.passkeys} passkey${s.passkeys > 1 ? "s" : ""}</span>
      <span class="bas-act"><button class="lien-btn" type="button" data-do="logout">Se déconnecter</button><button class="theme" type="button" data-theme-btn aria-label="Changer de thème, clair ou sombre">${THEME_ICON}</button></span></div></div>`);
  setHTML(mobNavEl, `${L.principaux}${L.missions ? `<p class="sec">Applications</p>${L.missions}` : ""}<p class="sec">Vues techniques</p>${L.vues}<button class="lien-btn" type="button" data-do="logout">Se déconnecter</button>`);
}

// ------------------------------------------------------------- banners and shell
function renderBandeaux() {
  const b = [], s = S.session;
  if (s?.recovery) b.push(`<div class="bandeau" role="alert"><p><b>Une reprise d'accès est en cours pour votre compte.</b> Ouverte le ${when(s.recovery.openedAt, { sec: false })}, elle deviendra utilisable le ${when(s.recovery.usableFrom, { sec: false })}. Si ce n'est pas vous, annulez-la.</p><div class="actions">${ask(`recovery:${s.recovery.id}`, "Annuler la reprise", false)}</div>${confirmBox(`recovery:${s.recovery.id}`)}</div>`);
  if (s && s.passkeys === 1) b.push(`<div class="bandeau"><p><b>Vous n'avez qu'une passkey.</b> Si vous perdez cet appareil, il faudra passer par la reprise d'accès, qui prend 24 heures.</p><div class="actions">${go(s.arrivalDone ? "#/acces/ajout" : "#/arrivee", "Ajouter une passkey", { q: true })}</div></div>`);
  for (const p of s?.addedElsewhere ?? []) b.push(`<div class="bandeau" role="alert"><p><b>Une passkey a été ajoutée à votre compte</b> le ${when(p.createdAt, { sec: false })}${p.device ? `, depuis ${esc(p.device)}` : ""}${p.provider ? ` : « ${esc(p.provider)} »` : ""}. Si ce n'est pas vous, retirez-la et fermez les sessions que vous ne reconnaissez pas.</p><div class="actions">${go("#/acces", "Voir mes passkeys", { q: true })}</div></div>`);
  if (S.newVersion) b.push(`<div class="bandeau"><p><b>Une nouvelle version du service est en ligne.</b> Cette page a été chargée avec la précédente.</p><div class="actions">${act("reload", "Recharger", { q: true })}</div></div>`);
  if (s?.maintenance) b.push(`<div class="bandeau"><p><b>Maintenance${s.maintenance.until ? ` jusqu'au ${when(s.maintenance.until, { sec: false })}` : ""}.</b> La lecture reste ouverte ; les gestes qui écrivent attendent la fin.</p></div>`);
  setHTML(bandEl, b.join(""));
}
function shell(signedIn, route, sub, v) {
  const pub = !signedIn && Boolean(v.public);
  document.body.classList.toggle("connecte", signedIn);
  document.body.classList.toggle("public", pub);
  latEl.hidden = !signedIn; mobEl.hidden = !signedIn && !pub; mobEl.open = false;
  const PUB_LINKS = `<button class="lien-nav" type="button" data-do="scroll" data-k="marche">Comment ça marche</button><button class="lien-nav" type="button" data-do="scroll" data-k="confiance">Confiance</button><a class="lien-nav" href="https://runward.dev" rel="noreferrer">Documentation</a>`;
  if (signedIn) renderLat(route, sub); else { setHTML(latEl, ""); setHTML(mobNavEl, pub ? `${PUB_LINKS}<button class="lien-btn theme-m" type="button" data-theme-btn>Changer de thème</button>` : ""); }
  setHTML(stampEl, signedIn ? esc(S.session.tenant.title) : v.public ? "" : esc(location.host));
  setHTML(pubEl, pub ? PUB_LINKS : "");
  setHTML(topActEl, !signedIn && v.public ? `${go("#/entree/connexion", "Se connecter", { q: true })}<a class="btn" href="${MAILTO}">Demander l'accès</a>` : "");
  setHTML(piedEl, `<div class="wrap"><a href="#/legal">Mentions légales</a> · <a href="#/legal">Confidentialité</a> · <a href="#/legal">Sécurité</a> · <span class="soft">heures affichées à l'heure de Paris, avec leur décalage</span></div>`);
}

export function paint(v) {
  const { route, sub } = parts();
  shell(Boolean(S.session) && v.signed !== "out", v.fleetRoute ?? route, sub, v);
  renderBandeaux();
  setHTML(main, v.html);
  document.title = `${v.title ? `${v.title} · ` : ""}runward hébergé`;
  after(v);
}
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
  [main, bandEl, piedEl].forEach(nbsp);
  main.querySelectorAll("[data-verbatim], .md").forEach((el) => { if (/\b(the|and|is|not|of|to|does|it|no|that|this|are|be|has|by|for|or)\b/i.test(el.textContent)) el.setAttribute("lang", "en"); });
  main.querySelectorAll(".tw:not([tabindex])").forEach((el) => { el.tabIndex = 0; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Tableau, défilable"); });
  const f = document.querySelector("[data-focus]") || (S.focusKey ? document.querySelector(`[data-focus-key="${CSS.escape(S.focusKey)}"]`) : null) || (v.focus ? main.querySelector(v.focus) : null);
  (f ?? main).focus({ preventScroll: true });
  S.focusKey = null;
}
export function say(msg) { annonceEl.textContent = ""; setTimeout(() => { annonceEl.textContent = msg; }, 60); }
