// The decision reading (runward's ADR-0125): the screen a signed-in member lands on (#/ and #/decision), and the
// reading of one application at a stable address (#/decision/<mission id>).
//
// The part drawn from the index is runward-fleet's own HTML, renderView(index, "decision", id) from the pinned
// views: for the index's language it is, byte for byte, what `runward-fleet build` writes for the same fleet.json
// (runward's docs/spec/runward-fleet-decision.md §8). The app adds no word inside it and styles its roles
// (data-reading, data-role, data-state) with its own layer (web/app.css, ADR-0019). Around it, the service says
// what only it knows, from its own closed lexicon below, in French and in English (the frame around it speaks the
// same language, from the app's lexicon, web/views/lexique.js): the language of the reading,
// the portfolio with nothing in it yet, the checks received and not accepted, and « Vérifier par vous-même »,
// the one-line command that recomputes the same verdict from the repository (the pivot of 2026-11-10, screen 4).
// Everything is read from the index served and GET /api/v0/fleet/status, already loaded by the router for this
// screen: opening an application costs 0 more read (architecture §6). Every value from them is escaped here or
// by views.js; no example data.
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { go, act, reqNote, loadingView, fenetre, copier } from "./marks.js";
import { renderView } from "./fleet-views.js";
import { lang, setLang, mots } from "./lexique.js";
import { ligne } from "./lignes.js";

// ------------------------------------------------------------- the language of the reading
// The reader's language is the app's, one for the reading and its frame (web/views/lexique.js): the choice kept under
// the key of the public site's switch (web/site/site.js), so that a reader who chose English on the landing reads the
// app in English; with no choice, the index's own language.
export const readingLang = lang;
export const setReadingLang = setLang;

// ------------------------------------------------------------- what only the service knows, in its own words
const plural = (n, one, many) => (Number(n) > 1 ? many : one);
export const WORDS = {
  fr: {
    title: "Avant votre go / no-go", portfolio: "Portefeuille",
    updated: (at) => `Mis à jour le ${at} · calculé par la chaîne de livraison de chaque équipe`,
    setAside: (n) => `${esc(n)} ${plural(n, "contrôle mis de côté", "contrôles mis de côté")} : le portefeuille montre le dernier état publié.`,
    uploads: "Voir les envois", connect: "Brancher une application", retry: "Réessayer",
    emptyTitle: "Aucune application dans votre portefeuille.",
    emptyText: "Branchez une application : son prochain contrôle arrivera ici, avec une phrase et de quoi le vérifier.",
    emptyAct: "Brancher une première application",
    waitTitle: "En attente du premier contrôle.", waitAct: "Voir dans Accès",
    waitText: "Ces applications sont déclarées. Leur premier contrôle arrivera ici, à confirmer, avec une phrase et de quoi le vérifier.",
    errorTitle: "Le portefeuille ne s'affiche pas.",
    errorText: "Votre session est ouverte, mais la lecture n'a pas pu être chargée. Vos contrôles ne sont pas perdus : ils sont écrits avant toute réponse.",
    unknownTitle: "Cette application n'est pas dans votre portefeuille.",
    unknownText: "Elle a peut-être été retirée, ou le lien est incomplet.",
    all: "Toutes les applications",
    verify: {
      title: "Vérifier par vous-même",
      lead: "Ce n'est pas notre écran qui le dit. Le même contrôle, relancé chez vous sur le même commit, rend la même application, la même version, le même état et les mêmes écarts.",
      application: "Application", repository: "Dépôt", commit: "Commit", version: "Version du moteur", run: "Exécution de la chaîne",
      runLabel: (n) => `n° ${esc(n)}`, runNote: "s'ouvre chez GitHub pour qui peut lire le dépôt",
      command: "La commande, en une ligne",
      note: "Node.js 22.12 ou plus récent. À lancer hors du dépôt, d'où le chemin : dans un dépôt qui s'appelle lui-même runward, npx prendrait le runward local. Commande en une ligne, sans option d'extension.",
      none: "Aucun contrôle reçu : il n'y a encore rien à refaire.",
      refused: (field) => `Pas de commande : ${field} ne passe pas son motif strict, et la commande ne se bâtit qu'avec des valeurs qui le passent.`,
      field: { repository: "le dépôt", commit: "le commit", version: "la version du moteur", path: "le chemin" },
      record: "Un membre peut aussi télécharger le dossier : il se rejoue chez lui et reconstruit le même index.",
      recordAct: "Télécharger le dossier",
    },
    received: {
      title: "Contrôles reçus",
      none: "Aucun contrôle reçu pour cette application.",
      what: { "send-accepted": "accepté", "send-historical": "accepté, plus ancien que le courant", "send-pending": "premier contrôle, à confirmer", "repository-confirmed": "premier contrôle confirmé", "send-not-accepted": "non accepté", "send-quarantined": "mis de côté" },
      commit: "commit", run: (n) => `exécution n° ${esc(n)}`,
      since: (n) => `${esc(n)} ${plural(n, "contrôle non accepté", "contrôles non acceptés")} depuis le dernier contrôle accepté.`,
      note: "Un contrôle non accepté s'ajoute ici avec son motif ; le portefeuille garde le dernier contrôle accepté.",
      consent: "L'accord n'est pas donné pour cette application : ses contrôles ne sont pas acceptés.",
      consentAct: "Donner l'accord dans Accès",
      journal: "Tout le journal des envois",
    },
    reasons: {
      "workflow-not-pinned": "envoyé par une autre chaîne que celle déclarée",
      "ref-not-main": "envoyé depuis une autre branche que la principale",
      "repository-not-declared": "dépôt non déclaré, ou retiré",
      "owner-changed": "le propriétaire du dépôt a changé",
      "digest-mismatch": "le fichier reçu ne correspond pas à ce qui était annoncé",
      "private-path": "un chemin personnel serait arrivé dans la lecture",
      "content-not-consented": "l'accord n'est pas donné pour ce dépôt",
      "index-build-refused": "ce contrôle ne se lit pas avec cette version du service",
      "index-rule-broken": "le portefeuille assemblé casserait une règle de lecture",
      "rate-limited": "trop d'envois dans l'heure",
      "duplicate-in-run": "un autre envoi de la même exécution est déjà arrivé",
    },
    reasonAsWritten: "motif tel que le service l'écrit",
    source: {
      title: "D'où vient l'information",
      label: "D'où vient l'information : l'application, le contrôle dans la chaîne de l'équipe, le contrôle reçu, cette lecture.",
      nodes: [["L'application", "Son code reste chez l'équipe."], ["Le contrôle", "Dans la chaîne de livraison de l'équipe."], ["Contrôle reçu", "Daté à la réception."], ["Cette lecture", "Une phrase par application."]],
    },
  },
  en: {
    title: "Before your go / no-go", portfolio: "Portfolio",
    updated: (at) => `Updated on ${at} · computed by each team's delivery chain`,
    setAside: (n) => `${esc(n)} ${plural(n, "check set aside", "checks set aside")}: the portfolio shows the last state published.`,
    uploads: "See the uploads", connect: "Connect an application", retry: "Try again",
    emptyTitle: "No application in your portfolio.",
    emptyText: "Connect an application: its next check will arrive here, with one sentence and what you need to check it yourself.",
    emptyAct: "Connect a first application",
    waitTitle: "Waiting for the first check.", waitAct: "See in Access",
    waitText: "These applications are declared. Their first check will arrive here, to be confirmed, with one sentence and what you need to check it yourself.",
    errorTitle: "The portfolio does not show.",
    errorText: "Your session is open, but the reading could not be loaded. Your checks are not lost: they are written before any answer.",
    unknownTitle: "This application is not in your portfolio.",
    unknownText: "It may have been removed, or the link is incomplete.",
    all: "All applications",
    verify: {
      title: "Check it yourself",
      lead: "It is not our screen saying so. The same check, run again on your side on the same commit, gives the same application, the same version, the same state and the same gaps.",
      application: "Application", repository: "Repository", commit: "Commit", version: "Engine version", run: "Run of the chain",
      runLabel: (n) => `no. ${esc(n)}`, runNote: "opens on GitHub for anyone who can read the repository",
      command: "The command, in one line",
      note: "Node.js 22.12 or newer. Run it outside the repository, hence the path: inside a repository itself named runward, npx would take the local runward. One line, with no extension option.",
      none: "No check received: there is nothing to run again yet.",
      refused: (field) => `No command: ${field} does not pass its strict pattern, and the command is only built from values that pass it.`,
      field: { repository: "the repository", commit: "the commit", version: "the engine version", path: "the path" },
      record: "A member can also download the record: it replays on their side and rebuilds the same index.",
      recordAct: "Download the record",
    },
    received: {
      title: "Checks received",
      none: "No check received for this application.",
      what: { "send-accepted": "accepted", "send-historical": "accepted, older than the current one", "send-pending": "first check, to be confirmed", "repository-confirmed": "first check confirmed", "send-not-accepted": "not accepted", "send-quarantined": "set aside" },
      commit: "commit", run: (n) => `run no. ${esc(n)}`,
      since: (n) => `${esc(n)} ${plural(n, "check not accepted", "checks not accepted")} since the last accepted check.`,
      note: "A check not accepted is added here with its reason; the portfolio keeps the last accepted check.",
      consent: "Consent is not given for this application: its checks are not accepted.",
      consentAct: "Give consent in Access",
      journal: "The whole journal of uploads",
    },
    reasons: {
      "workflow-not-pinned": "sent by another chain than the one declared",
      "ref-not-main": "sent from a branch other than the main one",
      "repository-not-declared": "repository not declared, or removed",
      "owner-changed": "the repository's owner changed",
      "digest-mismatch": "the file received does not match what was announced",
      "private-path": "a personal path would have reached the reading",
      "content-not-consented": "consent is not given for this repository",
      "index-build-refused": "this check cannot be read by this version of the service",
      "index-rule-broken": "the assembled portfolio would break a reading rule",
      "rate-limited": "too many uploads in the hour",
      "duplicate-in-run": "another upload of the same run already arrived",
    },
    reasonAsWritten: "reason as the service writes it",
    source: {
      title: "Where the information comes from",
      label: "Where the information comes from: the application, the check in the team's chain, the check received, this reading.",
      nodes: [["The application", "Its code stays with the team."], ["The check", "In the team's delivery chain."], ["Check received", "Dated on receipt."], ["This reading", "One sentence per application."]],
    },
  },
};

// ------------------------------------------------------------- « Vérifier par vous-même »: the command
// It is built with the team's data, so it is shown only when every value passes a strict pattern (the pivot,
// screen 4): the repository (owner and name as GitHub allows them, never starting with a dash or a dot), the
// commit (40 hexadecimal characters), the version (three numbers) and the path inside the repository (plain
// segments, no `..`). It never carries an extension option.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
const RUN_ID = /^[0-9]{1,20}$/;

/** The command that recomputes the verdict, or the first value that does not pass its pattern. */
export function verifyCommand({ repository, commit, version, path }) {
  const m = /^(?:github\.com\/)?([^/]+)\/([^/]+)$/.exec(String(repository ?? ""));
  if (!m || !OWNER.test(m[1]) || !NAME.test(m[2]) || m[2].endsWith(".git")) return { refused: "repository" };
  if (!COMMIT.test(String(commit ?? ""))) return { refused: "commit" };
  if (!VERSION.test(String(version ?? ""))) return { refused: "version" };
  const p = path === undefined || path === null || path === "" || path === "." ? [] : String(path).split("/");
  if (p.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) return { refused: "path" };
  const [owner, name] = [m[1], m[2]];
  const dir = [name, ...p].join("/");
  return {
    owner, name,
    command: `git clone https://github.com/${owner}/${name} && git -C ${name} checkout ${commit} && npx --yes runward@${version} check --strict --path ${dir}`,
  };
}

// ------------------------------------------------------------- the pieces of the screen
// The frame's header carries the trail, the language and the theme (web/views/shell.js). The panels beside a reading
// are windows of the public site, their title in the window's bar, in the mono (the author's decision of 2026-11-11).

function verifyPanel(w, m) {
  const V = w.verify, L = typeof m.latest === "object" && m.latest ? m.latest : null;
  const st = ligne(m.id);
  const win = (body) => fenetre(esc(V.title), body, { cls: "c-bar lecture-verif", attrs: ` aria-label="${esc(V.title)}"` });
  if (!L) return win(`<p>${esc(V.lead)}</p><p class="note">${esc(V.none)}</p>`);
  const repository = String(m.repository ?? "").replace(/^github\.com\//, "");
  // the index carries the commit with where it was read from: { value, source, commitSource } (runward-fleet build)
  const commit = m.commit && typeof m.commit === "object" ? m.commit.value : m.commit;
  const c = verifyCommand({ repository: m.repository, commit, version: L.runward, path: m.path });
  const run = st?.accepted && RUN_ID.test(String(st.accepted.runId ?? "")) && !c.refused
    ? `<dt>${esc(V.run)}</dt><dd><a href="https://github.com/${esc(c.owner)}/${esc(c.name)}/actions/runs/${esc(st.accepted.runId)}" rel="noreferrer">${V.runLabel(st.accepted.runNumber)}</a> <span class="soft">${esc(V.runNote)}</span></dd>` : "";
  const dl = `<dl class="lecture-dl"><dt>${esc(V.application)}</dt><dd translate="no">${esc(m.name)}</dd>
      <dt>${esc(V.repository)}</dt><dd><code translate="no">${esc(repository)}</code></dd>
      <dt>${esc(V.commit)}</dt><dd><code translate="no">${esc(commit ?? "")}</code></dd>
      <dt>${esc(V.version)}</dt><dd><code translate="no">runward ${esc(L.runward ?? "")}</code></dd>${run}</dl>`;
  // the command is copied as it is written, without the prompt and without a line end (a pasted line end would run it)
  const cmd = c.refused
    ? `<p class="lecture-refus">${esc(V.refused(V.field[c.refused]))}</p>`
    : `<p class="vh" id="cmd-${esc(m.id)}">${esc(V.command)}</p><pre class="term lecture-cmd" tabindex="0" aria-labelledby="cmd-${esc(m.id)}"><span class="inv" aria-hidden="true">$ </span><code translate="no" id="cmd-texte">${esc(c.command)}</code></pre>
      <div class="actions">${copier(mots().workflow.copyCommand, "cmd-texte", { plain: true })}</div>
      <p class="note">${esc(V.note)}</p>`;
  return win(`<p>${esc(V.lead)}</p>${dl}${cmd}
    <p class="note">${esc(V.record)}</p><div class="actions">${go("#/acces/export", V.recordAct, { q: true })}</div>`);
}

/** A refusal's code, as the service writes it, then its line for the screen; a code this lexicon does not know is shown as written. */
function reasonOf(w, lang, code) {
  const sep = lang === "fr" ? " : " : ": ";
  const known = Object.hasOwn(w.reasons, code) ? w.reasons[code] : null;
  return known ? `${sep}<code translate="no">${esc(code)}</code>, ${esc(known)}` : `${sep}<span class="soft">${esc(w.reasonAsWritten)}</span> <code translate="no">${esc(code)}</code>`;
}

function receivedPanel(w, lang, m) {
  const R = w.received, st = ligne(m.id);
  // the uploads of this mission and the confirmation of its first one; the other acts are in the journal
  const sends = (st?.activity ?? []).filter((e) => typeof e.what === "string" && (e.what.startsWith("send-") || e.what === "repository-confirmed"));
  const items = sends.map((e) => {
    const word = Object.hasOwn(R.what, e.what) ? R.what[e.what] : e.what;
    const meta = [e.commit ? `${esc(R.commit)} <code translate="no">${esc(String(e.commit).slice(0, 12))}</code>` : "", e.runNumber ? R.run(e.runNumber) : ""].filter(Boolean).join(" · ");
    return `<li>${when(e.at, { sec: false })} · ${esc(word)}${e.refusal ? reasonOf(w, lang, e.refusal) : ""}${meta ? `<span class="sub">${meta}</span>` : ""}</li>`;
  }).join("");
  const consent = st && st.consent === false ? `<p>${esc(R.consent)}</p><div class="actions">${go("#/acces", R.consentAct, { q: true })}</div>` : "";
  const since = st?.notAcceptedSince ? `<p>${R.since(st.notAcceptedSince)}</p>` : "";
  return fenetre(esc(R.title), `${items ? `<ul class="lecture-recus">${items}</ul>` : `<p class="note">${esc(R.none)}</p>`}${since}${consent}
    <p class="note">${esc(R.note)} <a href="#/envois">${esc(R.journal)}</a></p>`, { plat: true, cls: "c-bar lecture-recu", attrs: ` aria-label="${esc(R.title)}"` });
}

function source(w) {
  const S0 = w.source;
  return `<section class="lecture-source" aria-labelledby="h-source"><h2 class="h2" id="h-source">${esc(S0.title)}</h2>
    <ol class="lecture-schema" aria-label="${esc(S0.label)}">${S0.nodes.map(([b, s]) => `<li><b>${esc(b)}</b><span>${esc(s)}</span></li>`).join("")}</ol></section>`;
}

const frame = (lang, html, vue = "") => `<div class="lecture" lang="${lang}"${vue ? ` data-vue="${vue}"` : ""}>${html}</div>`;
const tete = (h1, p = "") => `<div class="tete"><h1 class="t1">${esc(h1)}</h1>${p}</div>`;

// ------------------------------------------------------------- the screen
/** The missions the service knows as declared and the index does not carry yet: their first check is awaited. */
function awaited(w, lines) {
  if (!lines.length) return "";
  return `<ul class="lecture-attente">${lines.map((l) => `<li><span class="etq" data-state="not-observed"><span data-role="mark" aria-hidden="true"></span><span translate="no">${esc(l.repository)}${l.path && l.path !== "." ? ` · ${esc(l.path)}` : ""}</span></span></li>`).join("")}</ul>`;
}

export function viewDecision(sub) {
  const lang = readingLang(), w = WORDS[lang];
  let id = "";
  try { id = sub ? decodeURIComponent(sub) : ""; } catch { return null; }
  const base = { key: "fleet", signed: "in", fleetRoute: "decision", decision: id };
  if (S.fleetError) return { ...base, title: w.portfolio, html: frame(lang, `<div class="tete" data-erreur><h1 class="t1">${esc(w.errorTitle)}</h1><p class="sous">${esc(w.errorText)}${reqNote(S.fleetError)}</p><div class="actions">${act("reload-screen", w.retry)}${go("#/envois", w.uploads, { q: true })}</div></div>`) };
  if (!S.status) return loadingView(w.portfolio);
  const st = S.status;
  const missions = S.index?.missions ?? [];
  const waiting = st.lines.filter((l) => !missions.some((m) => m.id === l.mission));
  if (!missions.length && !id) {
    // nothing to read: no index yet, or every application removed. The mock-up's empty state, in a window whose bar
    // says where one is; the declared ones, if any, are named while their first check is awaited
    const body = waiting.length
      ? `<h2 class="h2">${esc(w.waitTitle)}</h2><p class="sous">${esc(w.waitText)}</p>${awaited(w, waiting)}<div class="actions">${go("#/acces", w.waitAct)}${go("#/declarer", w.connect, { q: true })}</div>`
      : `<h2 class="h2">${esc(w.emptyTitle)}</h2><p class="sous">${esc(w.emptyText)}</p><div class="actions">${go("#/declarer", w.emptyAct)}</div>`;
    return { ...base, title: w.portfolio, html: frame(lang, `${tete(w.title)}${fenetre(esc(w.portfolio), body, { tag: "div", h: "p", cls: "lecture-vide" })}`) };
  }
  const idx = S.index && S.index.lang !== lang ? { ...S.index, lang } : S.index;
  const setAside = st.quarantined ? `<p class="avert">${w.setAside(st.quarantined)} <a href="#/envois">${esc(w.uploads)}</a></p>` : "";
  if (!id) {
    // the portfolio: runward-fleet's reading, whose parts the layer lays out (web/app.css): the title and its lede,
    // the tiles in a glass window whose bar is the line « Mis à jour le… », the applications on a sheet
    const updated = st.index ? `<p class="lecture-maj scr-bar num">${w.updated(when(st.index.publishedAt, { sec: false }))}</p>` : `<p class="lecture-maj scr-bar">${esc(w.portfolio)}</p>`;
    const pending = waiting.length ? `<section class="bandeau lecture-attendues" aria-labelledby="h-attente"><h2 class="h2" id="h-attente">${esc(w.waitTitle)}</h2><p class="soft">${esc(w.waitText)}</p>${awaited(w, waiting)}<div class="actions">${go("#/acces", w.waitAct, { q: true })}</div></section>` : "";
    return { ...base, title: w.portfolio, html: frame(lang, `${setAside}${updated}${renderView(idx, "decision")}${pending}
      <div class="actions lecture-actions">${go("#/declarer", w.connect, { q: true })}</div>`, "port") };
  }
  const m = missions.find((x) => x.id === id);
  const crumb = (name) => [[w.portfolio, "#/"], [name, null, true]];
  if (!m) return { ...base, title: w.portfolio, crumb: crumb(id), html: frame(lang, `<div class="tete"><h1 class="t1">${esc(w.unknownTitle)}</h1><p class="sous">${esc(w.unknownText)} <code translate="no">${esc(id)}</code></p><div class="actions">${go("#/", w.all)}</div></div>`) };
  return { ...base, title: m.name, crumb: crumb(m.name), html: frame(lang, `${setAside}<div class="lecture-fiche"><div class="lecture-g">${renderView(idx, "decision", m.id)}</div>
    <aside class="lecture-d">${verifyPanel(w, m)}${receivedPanel(w, lang, m)}</aside></div>${source(w)}`, "app") };
}
