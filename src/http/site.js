// NOT SERVED since ADR-0028 (2026-11-11): the public site is runward.dev, and this origin answers its former pages
// by a redirection (src/http/moved.js). This renderer and web/site/ stay in the tree, read by their tests only, until
// their removal, a change of its own. What follows describes the site as it was served (ADR-0022).
//
// The public site of runward hosted (ADR-0022): the landing at / and its pages, public, without an account, in
// French and English. Rendered once, at start, from web/site/ (the template, the page fragments, the data), by a
// port of the mini-site's build.py of 2026-11-11 that keeps its output: the same markup, the same 324 bilingual
// texts, and since ADR-0026 the house's signature in the foot, the 325th (web/site/textes_fr_en.tsv, which
// test/unit/site.test.js compares with what is served, text for text).
//
// What differs from build.py, so the pages pass the app's content security policy unchanged:
//   - no inline style or script: the template links the app's own files (web/famille.css, web/couche-runward-app.css,
//     the same digests as the shell) and the site's (web/site/site.css, aiguillage.js, site.js), all served by the
//     closed list of src/http/assets.js;
//   - no HTML in an attribute for a script to inject: an element marked `t` keeps its French and gains data-t="<k>",
//     and its English is the content of <template id="en-<k>">, before the script; the language switch moves nodes
//     (web/site/site.js), never a string of HTML, so it needs no Trusted Types policy;
//   - a value of the data is escaped as text (it came from a file the author wrote; on the day it comes from the
//     index, it comes from a CI).
//
// The data: web/site/donnees.json, the one place the public view (/) and the one-page summary (/releve) read. It is
// read here and nowhere else (siteData); the day it is the real index, this one read changes, the pages do not.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SITE = new URL("../../web/site/", import.meta.url).pathname;

/** The pages: [path, the fragment's name, title FR ||| EN, description (FR)]. The order of build.py. */
export const SITE_PAGES = Object.freeze([
  ["/", "index", "runward · Avant le go : ce qui bloque, et pourquoi ||| runward · Before the go: what blocks, and why", "Avant le go : ce qui bloque, et pourquoi. Une phrase par application. Et de quoi le vérifier vous-même."],
  ["/pourquoi", "pourquoi", "Pourquoi · runward ||| Why · runward", "Ce que runward vous évite : un go donné sur un dossier qui ne décrit plus le code, un audit qui reconstitue tout à la main."],
  ["/comment", "comment", "Comment ça marche · runward ||| How it works · runward", "Le contrôle tourne dans la chaîne de livraison de l'équipe, l'app le lit en langage courant, n'importe qui peut le relancer."],
  ["/pour-qui", "pour-qui", "Pour qui · runward ||| Who it is for · runward", "DSI, transformation, audit et risque, équipes qui livrent : la même lecture pour tous."],
  ["/formats", "formats", "Formats et référentiels · runward ||| Formats and frameworks · runward", "Les formats ouverts que runward écrit, les référentiels auxquels il rattache ses preuves, et neuf usages concrets, chacun avec sa limite."],
  ["/donnees", "donnees", "Données et sécurité · runward ||| Data and security · runward", "Le code ne sort jamais. Ce qui reste chez vous, ce qui remonte, où c'est hébergé."],
  ["/stand", "stand", "Sur notre stand, les 18 et 19 novembre · runward ||| At our stand, 18 and 19 November · runward", "Retrouvez-nous sur notre stand, les 18 et 19 novembre."],
  ["/mentions", "mentions", "Mentions légales · runward ||| Legal notice · runward", "Éditeur, hébergeur, et ce que deviennent les données d'une demande d'essai."],
  ["/releve", "releve", "Relevé d'une page · runward ||| One-page summary · runward", "Les applications publiques de runward, leur état, et la commande pour le vérifier."],
]);

// The lexicon of ADR-0125 (docs/spec/runward-fleet-decision.md of runward, main d05b597), copied character for
// character by build.py and from it.
const ETAT = { clean: ["Rien ne bloque", "Nothing is blocking"], gaps: ["Refusée par le contrôle", "Refused by the check"],
  "level-not-met": ["Niveau exigé non atteint", "Required level not met"], "not-observed": ["Aucun contrôle reçu", "No check received"],
  "not-available": ["Contenu non partagé", "Content not shared"] };
const FORME = { clean: "clean", gaps: "gaps", "level-not-met": "level", "not-observed": "none", "not-available": "part" };
const RAISON = { clean: ["Le contrôle n’a relevé aucune pièce manquante et ne refuse rien. La décision reste la vôtre.", "The check found no missing document and refuses nothing. The decision stays yours."],
  gaps: ["Le contrôle refuse cette version, pour les raisons qui suivent.", "The check refuses this version, for the reasons that follow."],
  "level-not-met": ["Aucun écart, mais le niveau de preuve que l’équipe exige n’est pas atteint.", "No gap was found, but the evidence does not reach the level the team requires."],
  "not-observed": ["Aucun contrôle n’a été reçu pour cette application.", "No check has been received for this application."],
  "not-available": ["Seules des empreintes remontent pour cette application : son contenu n’est pas partagé.", "Only fingerprints are sent for this application: its content is not shared."] };
const GENRE = { "evidence-refused": ["une preuve citée est refusée par le contrôle.", "a cited piece of evidence is refused by the check."],
  proposed: ["un point proposé n’est pas encore validé.", "a proposed answer is not yet endorsed."],
  "missing-row": ["une exigence de l’équipe n’a pas de réponse dans le dossier.", "a requirement of the team has no answer in the record."],
  "corpus-edited": ["une des règles de l’équipe a été modifiée depuis sa mise en place.", "one of the team’s rules was changed since it was set up."],
  "unresolved-pointer": ["le dossier cite un fichier ou un élément que le contrôle ne trouve pas.", "the record cites a file or an item the check cannot find."] };
const RANG = { gaps: 0, "level-not-met": 1, "not-available": 2, "not-observed": 3, clean: 4 };
const FLECHE = '<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M4 10 10 4M5 4h5v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Python's html.escape (quote=True): the text of a value, safe in an element and in an attribute. */
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]);
/** build.py's attr(): an attribute value that already is HTML text. */
const attr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
/** Python's str.replace: every occurrence, the replacement taken as it is. */
const all = (s, from, to) => s.split(from).join(to);
const pair = (s, where) => {
  const parts = s.split("|||");
  if (parts.length !== 2) throw new Error(`site: a pair needs one "|||" (${where}): ${s.slice(0, 120)}`);
  return parts.map((x) => x.trim());
};

/** The data the public view and the one-page summary show, from its one place. */
export function siteData(read = (f) => readFileSync(join(SITE, f), "utf8")) {
  return JSON.parse(read("donnees.json"));
}

/** The lines of the public view ("vue") or of the summary ("releve"), as build.py writes them; data escaped. */
function lignes(D, pour) {
  const e = escapeHtml;
  const apps = [...D.applications].sort((a, b) => (RANG[a.etat] ?? 9) - (RANG[b.etat] ?? 9)); // a stable sort, as Python's
  return apps.map((a, i) => {
    const st = a.etat;
    if (!Object.hasOwn(ETAT, st)) throw new Error(`site: an application's state is not of the lexicon: ${st}`);
    const [fr, en] = ETAT[st], [rfr, ren] = RAISON[st];
    let refus = "";
    for (const r of a.refus ?? []) {
      if (!Object.hasOwn(GENRE, r.genre)) throw new Error(`site: a refusal's kind is not of the lexicon: ${r.genre}`);
      const g = GENRE[r.genre];
      refus += `<div class="phrase" t>${e(r.piece_fr)} : ${g[0]} ||| ${e(r.piece_en)}: ${g[1]}</div><span class="ou">${e(r.ou)} · <span t>ligne ${e(r.ligne)} ||| line ${e(r.ligne)}</span></span>`;
    }
    const selon = st === "clean" ? '<div class="d" t>selon les exigences de l’équipe ||| according to the team’s requirements</div>' : "";
    const val = a.validation_fr ? `<div class="d2" t>${e(a.validation_fr)} ||| ${e(a.validation_en)}</div>` : "";
    const etat = `<div><div class="mot-e"><span><i class="f ${FORME[st]}"></i><b t>${fr} ||| ${en}</b></span></div>${selon}<div class="cm">commit ${e(String(a.commit).slice(0, 7))}</div></div>`;
    const corps = `<div><div class="phrase" t>${rfr} ||| ${ren}</div>${refus}${val}</div>`;
    if (pour === "vue") {
      return `      <div class="ligne-a w${i === 0 ? 1 : 2}" style="--i:${Math.max(0, i - 1)}">\n        <div class="n">${e(a.nom)}</div>\n        ${etat}\n        ${corps}\n        <a class="depot" href="https://github.com/${e(a.depot)}" rel="noopener" t-aria="Dépôt de ${e(a.nom)} ||| Repository of ${e(a.nom)}"><span t>Dépôt ||| Repository</span>${FLECHE}</a>\n      </div>`;
    }
    return `      <div class="f-l">\n        <div class="n">${e(a.nom)}<small class="mono">github.com/${e(a.depot)}</small></div>\n        ${etat}\n        ${corps}\n      </div>`;
  }).join("\n");
}

/** build.py's donnees(): the lines, then each {{a.b}} with the data's value (escaped). */
function donnees(D, t) {
  const withLines = all(all(t, "{{VUE_LIGNES}}", lignes(D, "vue")), "{{RELEVE_LIGNES}}", lignes(D, "releve"));
  return withLines.replace(/\{\{([a-z_0-9.]+)\}\}/g, (_, path) => {
    let v = D;
    for (const k of path.split(".")) { if (v === null || typeof v !== "object" || !Object.hasOwn(v, k)) throw new Error(`site: no value for {{${path}}}`); v = v[k]; }
    return escapeHtml(v);
  });
}

/** build.py's inclure(): <!--inclure _x.html--> replaced by the fragment, recursively. */
function inclure(read, t, depth = 0) {
  if (depth > 8) throw new Error("site: includes nested too deep");
  return t.replace(/<!--inclure ([\w.-]+)-->/g, (_, name) => inclure(read, read(`pages/${name}`), depth + 1));
}

/**
 * build.py's traduire(), with the English moved out of the attribute: an element marked `t` with "fr ||| en" keeps
 * its French and gains data-t="<k>"; its English goes to english[k]. t-aria and t-ph are attributes, as before.
 * Throws on a pair left untreated. `texts` receives each [fr, en], as build.py's textes.
 */
function traduire(page, texts) {
  const english = [];
  const attrPair = (frName, enName) => (_, g) => { const [fr, en] = pair(g, frName); texts.push([fr, en]); return `${frName}="${attr(fr)}" ${enName}="${attr(en)}"`; };
  let out = page.replace(/t-aria="([^"]*?\|\|\|[^"]*?)"/g, attrPair("aria-label", "data-en-aria"));
  out = out.replace(/t-ph="([^"]*?\|\|\|[^"]*?)"/g, attrPair("placeholder", "data-en-ph"));
  // the element regular expression of build.py: its content holds no element of its own name, the innermost first.
  // build.py writes the attributes ((?:\s[^<>]*?)?); here (\s[^<>]*?|), the same match in the same order of
  // tries, without a quantifier on a quantified group (security/detect-unsafe-regex)
  const element = /<([a-z0-9]+)(\s[^<>]*?|)\st>((?:(?!<\1[\s>]).)*?)\|\|\|(.*?)<\/\1>/gs;
  for (;;) {
    let n = 0;
    out = out.replace(element, (_, tag, attrs, fr, en) => {
      n++;
      const k = english.length;
      english.push(en.trim());
      texts.push([fr.trim(), en.trim()]);
      return `<${tag}${attrs} data-t="${k}">${fr.trim()}</${tag}>`;
    });
    if (!n) break;
  }
  // build.py checks its whole page, the English attributes included: here the English is checked with the page
  const whole = `${out}\n${english.join("\n")}`;
  const i = whole.indexOf("|||");
  if (i >= 0) throw new Error(`site: a "|||" was not treated near: ${whole.slice(Math.max(0, i - 200), i + 80)}`);
  const m = /\st>/.exec(whole);
  if (m) throw new Error(`site: a t marker is left near: ${whole.slice(Math.max(0, m.index - 160), m.index + 60)}`);
  return { html: out, english };
}

/**
 * Render every page. `links`: the served paths of famille, couche, site.css, aiguillage.js, site.js. `data`: the
 * public view's data (siteData). `read`: a file of web/site/ by its name. Returns { pages: [[path, html]], texts }.
 */
export function renderSite({ links, data, read = (f) => readFileSync(join(SITE, f), "utf8") }) {
  for (const k of ["famille", "couche", "css", "aiguillage", "js"]) {
    if (typeof links?.[k] !== "string" || !/^\/assets\/[a-z0-9.-]+\.(css|js)$/.test(links[k])) throw new Error(`site: the link ${k} is not a served file of the list: ${links?.[k]}`);
  }
  const D = structuredClone(data);
  D.scene.commit_principal7 = String(D.scene.commit_principal).slice(0, 7);
  D.scene.commit_changement7 = String(D.scene.commit_changement).slice(0, 7);
  const gabarit = read("gabarit.html");
  const texts = [];
  const pages = SITE_PAGES.map(([path, nom, titre, desc]) => {
    const corps = donnees(D, inclure(read, read(`pages/${nom}.html`)));
    const [tfr, ten] = pair(titre, `the title of ${nom}`);
    let page = all(all(all(all(all(gabarit, "{{CORPS}}", corps), "{{TITRE}}", escapeHtml(tfr)), "{{TITRE_EN}}", attr(ten)), "{{DESC}}", attr(desc)), "{{PAGE}}", nom);
    // the page in the navigation
    page = all(page, `href="/${nom}" data-nav`, `href="/${nom}" aria-current="page" data-nav`);
    const { html, english } = traduire(page, texts);
    const templates = english.map((en, k) => `<template id="en-${k}">${en}</template>`).join("\n");
    const slots = { "{{EN}}": templates, "{{AIGUILLAGE_JS}}": links.aiguillage, "{{FAMILLE_CSS}}": links.famille, "{{COUCHE_CSS}}": links.couche, "{{SITE_CSS}}": links.css, "{{SITE_JS}}": links.js };
    const filled = Object.entries(slots).reduce((h, [slot, value]) => all(h, slot, value), html);
    const left = /\{\{[A-Za-z_0-9.]+\}\}/.exec(filled);
    if (left) throw new Error(`site: a slot is left unfilled in ${nom}: ${left[0]}`);
    return [path, filled];
  });
  return { pages, texts };
}

/** Python's html.unescape for the entities the site writes, then build.py's nu(): tags out, one line, trimmed. */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " ", apos: "'" };
const unescapeHtml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, n) => (n[0] === "#" ? String.fromCodePoint(n[1].toLowerCase() === "x" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10)) : ENTITIES[n] ?? m));
export const plainText = (s) => unescapeHtml(s.replace(/<[^>]+>/g, "")).replace(/\n/g, " ").trim();

/**
 * The bilingual texts of a served page, read back from its HTML (not from the renderer): each element marked
 * data-t with its <template id="en-k">, then each aria-label with its data-en-aria and each placeholder with its
 * data-en-ph. Returns [fr, en] pairs, as build.py's textes.
 */
export function textsOf(html) {
  const out = [];
  const templates = new Map([...html.matchAll(/<template id="en-(\d+)">([\s\S]*?)<\/template>/g)].map((m) => [m[1], m[2]]));
  for (const m of html.matchAll(/<([a-z0-9]+)(?:\s[^<>]*?|)\sdata-t="(\d+)">/g)) {
    const tag = m[1], start = m.index + m[0].length;
    // the element's content: up to its own closing tag, counting the elements of the same name opened inside it
    const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
    re.lastIndex = start;
    let depth = 1, end = -1;
    for (let x = re.exec(html); x; x = re.exec(html)) { depth += x[0].startsWith("</") ? -1 : 1; if (depth === 0) { end = x.index; break; } }
    if (end < 0 || !templates.has(m[2])) throw new Error(`site: the element data-t="${m[2]}" has no end or no English`);
    out.push([html.slice(start, end), templates.get(m[2])]);
  }
  for (const m of html.matchAll(/aria-label="([^"]*)" data-en-aria="([^"]*)"/g)) out.push([m[1], m[2]]);
  for (const m of html.matchAll(/placeholder="([^"]*)" data-en-ph="([^"]*)"/g)) out.push([m[1], m[2]]);
  return out;
}

/** The texts of build.py's textes.tsv: [fr, en] made plain, the empty and repeated ones left out, in order. */
export function textsTable(pairs) {
  const seen = new Set(), rows = [];
  for (const [fr, en] of pairs) {
    const k = [plainText(fr), plainText(en)];
    const key = k.join("\t");
    if (seen.has(key) || !k[0]) continue;
    seen.add(key);
    rows.push(key);
  }
  return `${rows.join("\n")}\n`;
}
