// The decision reading (runward's ADR-0125): the screen a signed-in member lands on (#/ and #/decision), and the
// reading of one application at a stable address (#/decision/<mission id>).
//
// Since « la piste » (ADR-0035, refining ADR-0021 and ADR-0025), the screen is drawn by the app from the index's own
// fields (web/views/piste/); since the fixed shell (ADR-0036) it is one window of two panes (web/views/volets.js): the
// applications as a compact list, each with its six stations in small and one short reason, and beside it the reading
// of the one selected: its rail in large, what blocks as a table with each file and line, its documents, what the
// check and the service recorded, its checked deliveries, « Vérifier par vous-même » folded. runward-fleet's own HTML,
// renderView(index, "decision", id) from the pinned views, stays on the screen, byte for byte, folded below as the raw
// detail: for the index's language it is what `runward-fleet build` writes for the same fleet.json (runward's
// docs/spec/runward-fleet-decision.md §8), and the app adds no word inside it. Around it, the service says what only it
// knows, from its own closed lexicon below, in French and in English: the portfolio with nothing in it yet, the checks
// received and not accepted, and « Vérifier par vous-même », the one-line command that recomputes the same verdict
// from the repository (the pivot of 2026-11-10, screen 4). Everything is read from the index served and
// GET /api/v0/fleet/status, already loaded by the router for this screen: opening an application costs 0 more read
// (architecture §6); the live update reads the status again every 30 s while the screen is open (piste/vif.js). Every
// value from them is escaped here, in web/views/piste/ or by views.js; no example data.
import { S, esc } from "./base.js";
import { go, act, reqNote, mk } from "./marks.js";
import { when } from "./time.js";
import { renderView } from "./fleet-views.js";
import { lang, setLang, mots } from "./lexique.js";
import { ligne } from "./lignes.js";
import { niveauLigne, ordre } from "./claims.js";
import { versAccord } from "./liens.js";
import { piste } from "./piste/mots.js";
import { firstRun } from "./piste/rail.js";
import { entrees, categorie, barreApps, listeApps, etatTete } from "./piste/portefeuille.js";
import { reading, awaited } from "./piste/lecture.js";
import { etat } from "./piste/vif.js";
import { fenetre, barre, etat as etatVolet, squelette, VOLET_FOCUS } from "./volets.js";
import { bandeAFaire, aFairePour } from "./afaire.js";

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
    title: "Avant votre go / no-go", portfolio: "Applications",
    setAside: (n) => `${esc(n)} ${plural(n, "contrôle mis de côté", "contrôles mis de côté")} : vos applications montrent le dernier état publié.`,
    uploads: "Voir le journal", connect: "Brancher une application", retry: "Réessayer",
    emptyAct: "Brancher une première application",
    waitAct: "Tous les dépôts déclarés",
    // the next step of each application awaited, by its kind (web/views/liens.js#prochainPas), and its button
    next: {
      confirm: (at) => `Premier contrôle reçu le ${at}, à confirmer. Rien n'est publié avant.`, confirmAct: "Confirmer le premier contrôle",
      owner: "Le dépôt arrive sous un autre propriétaire : confirmez-le, ou retirez le dépôt.", ownerAct: "Confirmer le nouveau propriétaire",
      install: "Rien n'est encore arrivé : l'équipe ajoute l'envoi à sa chaîne de livraison, puis fusionne.", installAct: "Voir ce que l'équipe ajoute",
      consent: "L'accord sur le contenu n'est pas donné : ses contrôles ne sont pas acceptés.", consentAct: "Donner l'accord",
      wait: "Confirmé : son prochain contrôle arrivera ici.", waitAct: "Voir le dépôt",
    },
    errorTitle: "Vos applications ne s'affichent pas.",
    errorText: "Votre session est ouverte, mais la lecture n'a pas pu être chargée. Vos contrôles ne sont pas perdus : ils sont écrits avant toute réponse.",
    unknownTitle: "Cette application ne fait pas partie de vos applications.",
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
      what: { "send-accepted": "accepté", "send-historical": "accepté, plus ancien que le courant", "send-pending": "premier contrôle, à confirmer", "repository-confirmed": "premier contrôle confirmé", "send-not-accepted": "non accepté", "send-quarantined": "mis de côté" },
      since: (n) => `${esc(n)} ${plural(n, "contrôle non accepté", "contrôles non acceptés")} depuis le dernier contrôle accepté.`,
      consent: "L'accord n'est pas donné pour cette application : ses contrôles ne sont pas acceptés.",
      consentAct: "Donner l'accord dans Compte",
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
      "index-rule-broken": "la lecture assemblée casserait une de ses règles",
      "rate-limited": "trop d'envois dans l'heure",
      "duplicate-in-run": "un autre envoi de la même exécution est déjà arrivé",
    },
    reasonAsWritten: "motif tel que le service l'écrit",
  },
  en: {
    title: "Before your go / no-go", portfolio: "Applications",
    setAside: (n) => `${esc(n)} ${plural(n, "check set aside", "checks set aside")}: your applications show the last state published.`,
    uploads: "See the journal", connect: "Connect an application", retry: "Try again",
    emptyAct: "Connect a first application",
    waitAct: "All declared repositories",
    next: {
      confirm: (at) => `First check received on ${at}, to confirm. Nothing is published before.`, confirmAct: "Confirm the first check",
      owner: "The repository arrives under another owner: confirm it, or remove the repository.", ownerAct: "Confirm the new owner",
      install: "Nothing has arrived yet: the team adds the upload to its delivery chain, then merges.", installAct: "See what the team adds",
      consent: "Consent to the content is not given: its checks are not accepted.", consentAct: "Give consent",
      wait: "Confirmed: its next check will arrive here.", waitAct: "See the repository",
    },
    errorTitle: "Your applications do not show.",
    errorText: "Your session is open, but the reading could not be loaded. Your checks are not lost: they are written before any answer.",
    unknownTitle: "This application is not one of your applications.",
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
      what: { "send-accepted": "accepted", "send-historical": "accepted, older than the current one", "send-pending": "first check, to be confirmed", "repository-confirmed": "first check confirmed", "send-not-accepted": "not accepted", "send-quarantined": "set aside" },
      since: (n) => `${esc(n)} ${plural(n, "check not accepted", "checks not accepted")} since the last accepted check.`,
      consent: "Consent is not given for this application: its checks are not accepted.",
      consentAct: "Give consent in Account",
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
      "index-rule-broken": "the assembled reading would break one of its rules",
      "rate-limited": "too many uploads in the hour",
      "duplicate-in-run": "another upload of the same run already arrived",
    },
    reasonAsWritten: "reason as the service writes it",
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
  // the body of the fold « Vérifier par vous-même » in the reading's side column (web/views/piste/lecture.js)
  const win = (body) => `<div class="lecture-verif">${body}</div>`;
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
  // the command is built for a repository of github.com only: a GitLab repository is told so, in the app's words
  const cmd = c.refused
    ? `<p class="lecture-refus">${esc(st?.forge === "gitlab" && c.refused === "repository" ? mots().forge.verifyNote : V.refused(V.field[c.refused]))}</p>`
    : `<p class="vh" id="cmd-${esc(m.id)}">${esc(V.command)}</p><pre class="term lecture-cmd" tabindex="0" aria-labelledby="cmd-${esc(m.id)}"><span class="inv" aria-hidden="true">$ </span><code translate="no" id="cmd-texte">${esc(c.command)}</code></pre>
      <div class="actions"><button class="btn btn-q" type="button" data-do="copy" data-copy-target="cmd-texte" data-copy-plain data-label="${esc(mots().workflow.copyCommand)}">${esc(mots().workflow.copyCommand)}</button></div>
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

/**
 * The level of evidence of the path the file took (ADR-0029 section 2), in a window beside runward-fleet's reading,
 * never inside it: the sentence first, what it does not prove, then the code; GitLab's order signal with its gesture.
 * Its words are the app's lexicon (web/views/lexique.js), in the reading's language.
 */
function levelPanel(m) {
  const st = ligne(m.id), L = mots().forge.level;
  if (!st?.level) return "";
  return `<p class="note">${L.lead}</p>${niveauLigne(st)}${ordre(st)}`;
}

/** Consent not given for this application: its checks are not accepted, said under its reading with its button. */
function receivedNotes(w, m) {
  const R = w.received, st = ligne(m.id);
  return st && st.consent === false ? `<div class="bandeau"><p>${esc(R.consent)}</p><div class="actions">${go(versAccord(st), R.consentAct, { q: true })}</div></div>` : "";
}

// ------------------------------------------------------------- the screen
// The fixed shell (ADR-0036, refining ADR-0034 and ADR-0035): Applications is one window of two panes. The list on the
// left (« À faire » first when something waits, then the applications, each with its mark, its six stations in small,
// its short reason and the time of its check), the reading of the one selected on the right, each pane scrolling on its
// own (web/views/volets.js). The address is the one it has always been: #/ the list (on a desk, the first application
// read beside it, no address naming it), #/decision/<id> one application. An application declared whose first check is
// awaited has its reading at the same address: where it stands among the five gestures, and its button.

/** The service's words for a refusal's code, as text (a code this lexicon does not know, as written). */
const reasonText = (w) => (code) => (Object.hasOwn(w.reasons, code) ? w.reasons[code] : code);

/** Where the first run stands for an application awaited: a first check to confirm, delivered, or the step to add. */
const stepOf = (kind) => (kind === "confirm" || kind === "owner" ? 3 : kind === "wait" || kind === "consent" ? 2 : 1);

/** The pane screen, as the shell paints it (web/views/shell.js, `main: "volets"`). */
const volets = (base, { title, crumb, html, ecran = "liste", sel = null }) => ({ ...base, title, crumb, main: "volets", cle: "applications", ecran, sel, focus: VOLET_FOCUS, html: `<div class="lecture" lang="${readingLang()}" data-vue="volets">${html}</div>` });

/** The loading of Applications: the skeleton of the panes, no number (web/views/router.js asks it while it reads). */
export const loadingDecision = () => {
  const W = mots().coque;
  return { title: mots().frame.apps, key: "fleet", signed: "in", main: "volets", cle: "applications", ecran: "liste", html: squelette(6, W.states.loading) };
};

export function viewDecision(sub) {
  const lang = readingLang(), w = WORDS[lang], C = mots().coque;
  let id = "";
  try { id = sub ? decodeURIComponent(sub) : ""; } catch { return null; }
  const base = { key: "fleet", signed: "in", fleetRoute: "decision", decision: id };
  if (S.fleetError) {
    return volets(base, { title: w.portfolio, html: fenetre({ bar: barre({ titre: esc(w.portfolio) }), seul: etatVolet({ marque: `<p class="mk-etat">${mk("void", mots().common.notShown)}</p>`, titre: esc(w.errorTitle), h1: true, texte: `${esc(w.errorText)}${reqNote(S.fleetError)}`, actions: `${act("reload-screen", w.retry)}${go("#/envois", w.uploads, { q: true })}` }) }) });
  }
  if (!S.status) return loadingDecision();
  const st = S.status, E = etat();
  const missions = S.index?.missions ?? [];
  // the service's control account (ADR-0034): its first upload waits on purpose, the frame's banner says so; no row
  // awaited, no first run, no « Brancher » here (read defensively: absent, an account as any other)
  const temoin = Boolean(S.session?.tenant?.witness);
  const waiting = temoin ? [] : st.lines.filter((l) => !missions.some((m) => m.id === l.mission));
  const list = entrees(S.index, st, waiting);
  const F = piste().first;
  if (!list.length && !id) {
    // nothing to read yet: the first run, drawn as a rail of five gestures, the first one current
    E.premier = null;
    if (temoin) return volets(base, { title: w.portfolio, html: fenetre({ bar: barre({ titre: esc(C.apps(0)) }), seul: etatVolet({ titre: esc(w.title), h1: true }) }) });
    return volets(base, { title: w.portfolio, html: fenetre({ bar: barre({ titre: esc(C.apps(0)) }), seul: `<div class="d-body premier">${etatVolet({ titre: esc(F.emptyTitle), texte: esc(F.emptyText), h1: true })}${firstRun(0, `<p>${esc(F.emptyNote)}</p><div class="actions">${go("#/declarer", w.emptyAct)}</div>`)}</div>` }) });
  }
  const idx = S.index && S.index.lang !== lang ? { ...S.index, lang } : S.index;
  const setAside = st.quarantined ? `<p class="avert">${w.setAside(st.quarantined)} <a href="#/envois">${esc(w.uploads)}</a></p>` : "";
  const bouge = Object.fromEntries(Object.entries(E.moved).map(([k, d]) => [k, d.steps]));
  const filtre = S.coqueFiltre ?? null;
  const shown = list.filter((e) => !filtre || categorie(e) === filtre);
  // the one shown: the one the address names; on a desk with no address naming one, the first of the list
  const e = id ? list.find((x) => x.id === id) ?? null : shown[0] ?? list[0] ?? null;
  if (!id) E.premier = null;
  E.montre = e?.id ?? null;
  const at = e ? list.indexOf(e) : -1;
  const href = (x) => (x ? `#/decision/${encodeURIComponent(x.id)}` : null);
  const pos = e ? { i: at + 1, n: list.length, avant: href(list[at - 1]), apres: href(list[at + 1]) } : null;
  const ctx = { reasonOf: (code) => reasonOf(w, lang, code), reasonText: reasonText(w), received: w.received, verifyTitle: w.verify.title };
  let detail;
  if (!e) {
    detail = etatVolet({ titre: esc(w.unknownTitle), h1: true, texte: `${esc(w.unknownText)} <code translate="no">${esc(id)}</code>`, actions: go("#/", w.all, { q: true }) });
  } else if (e.m) {
    const premier = E.premier === e.id;
    if (E.premier && !premier) E.premier = null;
    const sel = E.sel && E.sel.id === e.id ? E.sel.n : null;
    detail = reading(e.m, e.line, {
      sel, premier, bouge: E.moved[e.id] ?? null, pos,
      verify: verifyPanel(w, e.m), level: levelPanel(e.m),
      detail: renderView(idx, "decision", e.id),
      ctx, avant: `${setAside}${receivedNotes(w, e.m)}`,
    });
  } else {
    const n = e.next, N = w.next;
    detail = awaited({
      name: e.name, state: etatTete(e), next: n, line: e.line, ctx, pos, cur: stepOf(n.kind),
      said: n.kind === "confirm" ? N.confirm(when(n.at, { sec: false })) : esc(N[n.kind]),
      act: go(n.href, N[`${n.kind}Act`], { q: n.kind === "install" || n.kind === "wait" }),
      todo: aFairePour(e.line),
    });
  }
  const crumb = id ? [[w.portfolio, "#/"], [e ? e.name : id, null, true]] : null;
  return volets(base, {
    title: id && e ? e.name : w.portfolio, crumb, ecran: id ? "detail" : "liste", sel: e?.id ?? id,
    html: fenetre({
      bar: barreApps(list, st, filtre),
      liste: listeApps(list, { w, sel: id || null, choisie: e?.id ?? null, filtre, bouge, neuf: E.neuf, afaire: bandeAFaire(), detail: idx?.missions?.length ? renderView(idx, "decision") : "" }),
      detail,
      label: C.listLabel,
    }),
  });
}
