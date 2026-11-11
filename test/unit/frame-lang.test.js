// The app's frame and every screen follow the reader's language (web/views/lexique.js): the one the decision
// reading and the public site keep under the same key, else the index's own. The modules are run as the app serves
// them (each with the pinned views' slot filled, as src/http/assets.js serves them), over a tenant built by the real
// application: its session, access and journal views as the API answers them, its index from runward's real exports.
//
// What is held here: the frame (the sidebar, the phone menu, the top bar, the banners, the foot) and every screen
// painted in English carry no French word, values from the tenant set aside; the page's own words (web/index.html)
// are each written by the shell from the lexicon; the lexicon holds the same keys in both languages, none of the words
// never said, no em dash; the switch reaches the frame at once; the API is asked for the reader's language. Each
// guard has its planted control: one string left in French is found.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULES } from "../../src/http/assets.js";
import { journalRoutes } from "../../src/http/routes/journal.js";
import { harness, founder, gesture, send, SEND_SHA, confirmRepository } from "../helpers.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const VIEWS = new URL("../../node_modules/runward-fleet/ui/views.js", import.meta.url);
const FIXTURE = (name) => readFileSync(new URL(`../fixtures/decision/${name}.check.json`, import.meta.url));

// ---- the browser the modules expect, reduced to what they touch at import and at paint
const kept = new Map();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => ({}) };
globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
globalThis.location = { host: "app.runward.dev", hash: "#/" };
globalThis.matchMedia = () => ({ matches: true });

// ---- the modules as served
const served = mkdtempSync(join(tmpdir(), "rw-frame-"));
after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) {
  const p = join(served, f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href)));
}
const mod = (f) => import(pathToFileURL(join(served, `views/${f}.js`)).href);
const { S } = await mod("base");
const Lx = await mod("lexique");
const { frame } = await mod("shell");
const { confirmBox, KINDS } = await mod("confirm");
const { api } = await mod("api");
const screens = {
  entree: (await mod("entree")).viewEntree, lien: (await mod("lien")).viewLien, reprise: (await mod("reprise")).viewReprise, arrivee: (await mod("arrivee")).viewArrivee,
  declarer: (await mod("declarer")).viewDeclarer, envois: (await mod("envois")).viewEnvois, fleet: (await mod("fleet")).viewFleet, decision: (await mod("decision")).viewDecision,
  acces: (await mod("acces")).viewAcces, panne: (await mod("panne")).viewPanne, legal: (await mod("legal")).viewLegal, introuvable: (await mod("introuvable")).view404,
};

// ---- a tenant built by the real application: published missions, one declared and awaited, an upload not accepted
async function tenant() {
  const h = harness();
  const f = await founder(h);
  const declare = async (name, missions) => {
    await gesture(h, f.session, "declare-with-consent", name.toLowerCase());
    return h.app.repositories.declare(await h.app.identity.sessionFrom(f.token), { name, consent: true, missions }, {});
  };
  const confirm = async (d) => {
    await confirmRepository(h, f, d.id);
  };
  let d = await declare("stranxik/runward-hosted", [{ id: "runward-hosted", path: "." }]);
  await send(h, { repository: "stranxik/runward-hosted", repository_id: "7002", run_id: "42830000011", run_number: "11", sha: "a4ede1485323293609957a700aba13ddf99de27f" }, { mission: "runward-hosted", bytes: FIXTURE("hosted-proposed") });
  await confirm(d);
  d = await declare("stranxik/examples", [{ id: "agent-ratified", path: "agents" }, { id: "silent", path: "quiet" }]);
  await send(h, { repository: "stranxik/examples", repository_id: "7003", run_id: "42830000021", run_number: "3", sha: "9a1f3c5e7b2d4f6a8c0e1b3d5f7a9c2e4b6d8f01" }, { mission: "agent-ratified", bytes: FIXTURE("agent-ratified") });
  await confirm(d);
  h.clock.advance(60_000);
  await send(h, { repository: "stranxik/runward-hosted", repository_id: "7002", run_id: "42830000099", run_number: "12", workflow_ref: "stranxik/runward-hosted/.github/workflows/other.yml@refs/heads/main" }, { mission: "runward-hosted", bytes: FIXTURE("hosted-proposed") });
  const pending = await declare("stranxik/next-one", [{ id: "next-one", path: "." }]);
  const s = await h.app.identity.sessionFrom(f.token);
  const json = (x) => JSON.parse(JSON.stringify(x));
  const session = json({ ...(await h.app.identity.sessionView(s)), sendWorkflow: [SEND_SHA] });
  const journalAs = async (lang) => json(await journalRoutes(h.app)[0][3]({ session: s, url: new URL("https://app.runward.dev/api/v0/journal"), lang }));
  return {
    session, access: json(await h.app.identity.accessView(s)), status: json(await h.app.reading.status(s)),
    index: JSON.parse((await h.app.reading.index(s.tenantId)).bytes.toString("utf8")), journal: { en: await journalAs("en"), fr: await journalAs("fr") }, pending,
  };
}
const T = await tenant();
const setLang = (l) => (l ? kept.set("rw-accueil-lang", l) : kept.delete("rw-accueil-lang"));
function state({ lang = "en", ...over } = {}) {
  setLang(lang);
  Object.assign(S, { session: T.session, access: T.access, status: T.status, index: T.index, journal: T.journal[lang ?? "fr"], fleetError: null, accessError: null, journalError: null, error: null, link: null, linkInfo: null, confirming: null, busy: null, failed: null, failedText: null, formError: null, formValues: null, addError: null, export: null, intent: null, newVersion: false, lastError: null }, over);
}

// ---- French, seen in what a reader reads: the text of the HTML, the values of its labels; the tenant's own values
// (names in code, in data-verbatim, in translate="no", or declared French) set aside
const FRENCH = /[àâçéèêëîïôûùüÿœæ«»]|\b(le|la|les|des|du|une|un|vous|votre|vos|est|et|pour|dans|sur|pas|ce|cette|qui|que|aucun|aucune|au|aux|ne|avec|sans|par|depuis|jusqu|envoi|envois|flotte|trousseau|gestionnaire|mots|jeton|geste|porte|livrables?|lecteur|retirer|remettre|fermer|ouvrir|voir|rien|tout|toutes|tous|chaque|ici|encore)\b|\b(?:l|d|n|qu|s|c)['’][a-z]/i;
const DATA = /<(code|pre|time)\b[^>]*>[\s\S]*?<\/\1>|<(\w+)\b[^>]*(?:translate="no"|data-verbatim|lang="fr")[^>]*>[\s\S]*?<\/\2>/g;
const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** Every run of French words a reader would meet in `html` (its text and the values of its labels). */
export function frenchIn(html) {
  const labels = [...String(html).matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map((m) => m[1]);
  const text = decode(String(html).replace(/<!--[\s\S]*?-->/g, "").replace(DATA, " ").replace(/<[^>]+>/g, "\n"));
  return [...text.split(/\n+/), ...labels.map(decode)].map((t) => t.trim()).filter((t) => t && FRENCH.test(t));
}

/** The frame around a few screens, signed in and out, with every banner: its parts, flattened. */
function frames() {
  const s = { ...T.session, passkeys: 1, recovery: { id: "rec-1", openedAt: "2026-11-10T10:00:00.000Z", usableFrom: "2026-11-11T10:00:00.000Z" }, addedElsewhere: [{ id: "p", createdAt: "2026-11-10T09:00:00.000Z", provider: "Trousseau iCloud", device: "Chrome sur macOS" }], maintenance: { until: "2026-11-12T10:00:00.000Z" } };
  const out = [];
  for (const [signed, route, sub, v] of [[true, "decision", "", {}], [true, "decision", "runward-hosted", {}], [true, "acces", "export", {}], [true, "flotte", "", {}], [false, "entree", "connexion", {}], [false, "", "", { public: true }]]) {
    S.session = signed ? s : null; S.newVersion = true; S.confirming = "recovery:rec-1";
    out.push(...Object.values(frame(signed, route, sub, v)).filter((x) => typeof x === "string"));
  }
  return out.join("\n");
}

test("the frame follows the reader's language: in English, no French word in the sidebar, the menu, the top bar, the banners or the foot", () => {
  state({ lang: "en" });
  const en = frames();
  assert.ok(en.includes("Portfolio") && en.includes("Uploads") && en.includes("Technical views") && en.includes("Legal notice") && en.includes("Sign out"), "the frame is painted, in English");
  assert.ok(en.includes("An access recovery is under way") && en.includes("Chrome on macOS") && en.includes("runward hosted"), "the banners, a device's label and the default title, in English");
  assert.ok(en.includes("“iCloud Keychain”"), "a provider the service names in French, in English");
  assert.ok(en.includes("runward<span> hosted</span>"), "the brand's word, in the sidebar's mark (translate=\"no\", so read here)");
  assert.deepEqual(frenchIn(en), []);
  // the control the other way: the same frame in French is seen as French, word for word as before
  state({ lang: "fr" });
  const fr = frames();
  assert.ok(fr.includes("Portefeuille") && fr.includes("Vues techniques") && fr.includes("Mentions légales") && fr.includes("Se déconnecter") && fr.includes("runward hébergé"));
  assert.ok(frenchIn(fr).length > 20, "the detector sees French");
});

// ---- the public site (ADR-0028): runward.dev, French at /<page>, English at /en/<page>; the shell links to it in the
//      reader's language, in the same tab, from the foot, the legal notice and the sign-in's « how to get in »
test("the shell's links to the public site follow the reader's language: runward.dev in French, runward.dev/en in English, in the same tab", () => {
  const links = (html) => [...html.matchAll(/<a\b[^>]*href="(https:\/\/runward\.dev[^"]*)"[^>]*>/g)].map((m) => m[0]);
  const hrefs = (html) => links(html).map((a) => /href="([^"]*)"/.exec(a)[1]);
  for (const [lang, home, legal] of [["fr", "https://runward.dev/", "https://runward.dev/mentions"], ["en", "https://runward.dev/en", "https://runward.dev/en/mentions"]]) {
    state({ lang });
    assert.equal(Lx.siteUrl(), home, lang);
    assert.equal(Lx.siteUrl("mentions"), legal, lang);
    assert.equal(Lx.siteUrl("stand"), lang === "en" ? "https://runward.dev/en/stand" : "https://runward.dev/stand", lang);
    for (const signed of [true, false]) {
      state({ lang }); if (!signed) S.session = null;
      assert.deepEqual(hrefs(frame(signed, signed ? "decision" : "entree", "", {}).pied), [home], `${lang} ${signed}: the foot`);
    }
    state({ lang });
    assert.deepEqual(hrefs(screens.legal().html), [legal], `${lang}: the legal notice`);
    S.session = null;
    assert.deepEqual(hrefs(screens.entree("sans-compte").html), [home], `${lang}: how to get in`);
    // the same tab: no target on any of them
    for (const a of [...links(frame(false, "entree", "", {}).pied), ...links(screens.legal().html), ...links(screens.entree("sans-compte").html)]) assert.equal(/\starget=/.test(a), false, a);
  }
  // no screen links to a public page of this origin: they answer a redirection now (src/http/moved.js)
  const sources = MODULES.map((f) => readFileSync(join(WEB, f), "utf8")).join("\n");
  assert.deepEqual([...sources.matchAll(/href=\\?"\/(pourquoi|comment|pour-qui|formats|donnees|stand|releve|mentions|index\.html)?["?#\\]/g)].map((m) => m[0]), []);
  // planted control: the French address under the English reader is seen
  state({ lang: "en" });
  assert.notEqual(Lx.siteUrl("mentions"), "https://runward.dev/mentions");
});

// ---- the house's signature (ADR-0026): the same in every foot, "runward" in lower case, the house's name the link
/** What is wrong with a foot's signature for `lang`; [] when it is the house's. */
export function signatureFaults(html, lang) {
  const want = `runward, ${lang === "fr" ? "par" : "by"} <a href="https://anotherframework.dev/studio.html?depuis=runward"`;
  const faults = [];
  if (!html.includes(want)) faults.push(`${lang}: the signature is not « ${want}…>Another Framework</a> »`);
  if (!/>Another Framework<\/a>/.test(html)) faults.push(`${lang}: the house's name is not the link`);
  if (/Runward,|RUNWARD,/.test(html)) faults.push(`${lang}: runward is not in lower case`);
  if (/<(img|svg)\b/.test(html)) faults.push(`${lang}: a logo in the foot`);
  return faults;
}
test("the foot carries the house's signature in the reader's language, signed in and signed out: « runward, par Another Framework », the name linking to the studio's page", () => {
  for (const lang of ["fr", "en"]) for (const signed of [true, false]) {
    state({ lang }); if (!signed) S.session = null;
    assert.deepEqual(signatureFaults(frame(signed, signed ? "decision" : "entree", "", {}).pied, lang), [], `${lang} ${signed}`);
  }
  // planted controls: the other language's word, a capital, no link, a logo
  state({ lang: "en" });
  const pied = frame(true, "decision", "", {}).pied;
  assert.equal(signatureFaults(pied, "fr").length, 1);
  assert.deepEqual(signatureFaults(pied.replace("runward, by", "Runward, by"), "en"), ["en: the signature is not « runward, by <a href=\"https://anotherframework.dev/studio.html?depuis=runward\"…>Another Framework</a> »", "en: runward is not in lower case"]);
  assert.equal(signatureFaults(pied.replace(/<a href="https:\/\/anotherframework[^>]*>Another Framework<\/a>/, "Another Framework"), "en").length, 2);
  assert.deepEqual(signatureFaults(`${pied}<svg></svg>`, "en"), ["en: a logo in the foot"]);
  // the address is written once, beside the lexicon, by language (the same page in both for now)
  for (const lang of ["fr", "en"]) { state({ lang }); assert.equal(Lx.studioUrl(), "https://anotherframework.dev/studio.html?depuis=runward", lang); }
  assert.equal(/anotherframework\.dev/.test(readFileSync(join(WEB, "views/shell.js"), "utf8")), false, "not in the shell");
});

test("planted control: one string of the frame left in French is found in the English frame", () => {
  const en = Lx.MOTS.en.frame;
  const was = en.legal;
  en.legal = Lx.MOTS.fr.frame.legal;
  try {
    state({ lang: "en" });
    assert.deepEqual(frenchIn(frames()).filter((t) => t.includes("Mentions")).length > 0, true);
    assert.ok(frenchIn(frames()).every((t) => t.includes("Mentions légales")), "only the planted string");
  } finally { en.legal = was; }
  state({ lang: "en" });
  assert.deepEqual(frenchIn(frames()), [], "and the frame is English again");
});

/** Every screen of the shell, in each of its states, as [name, view]. */
function allScreens() {
  const r = T.access.repositories.find((x) => x.state === "pinned"), pk = T.access.passkeys[0];
  const link = (state, kind, sub = "") => [`lien ${state} ${kind} ${sub}`, () => { S.link = "t"; S.linkInfo = { state, kind, fleet: "runward hébergé", expiresAt: "2026-11-12T10:00:00.000Z", usableFrom: "2026-11-11T10:00:00.000Z" }; return screens.lien(sub); }];
  return [
    ...["connexion", "attente", "echec", "inconnue", "expiree", "sans-passkey", "sans-compte", "sortie", "session-fermee", "fin"].map((sub) => [`entree ${sub}`, () => { S.intent = "#/acces"; return screens.entree(sub); }]),
    ["lien absent", () => screens.lien("")], ["lien lecture", () => { S.link = "t"; return screens.lien(""); }],
    link("link-live", "bootstrap", "attente"), link("link-live", "bootstrap", "annulee"), link("link-live", "bootstrap", "panne"),
    ...["link-invalid", "link-signed-in", "link-used", "link-expired", "link-cancelled", "link-not-yet", "link-live"].flatMap((st) => ["bootstrap", "recovery", "invitation"].map((k) => link(st, k))),
    ["reprise", () => screens.reprise()],
    ...["", "seule", "seconde-annulee", "seconde-existe"].map((sub) => [`arrivee ${sub}`, () => { S.session = { ...T.session, arrivalOpen: true }; return screens.arrivee(sub); }]),
    ["arrivee awaited", () => { S.session = { ...T.session, arrivalOpen: true }; S.access = { ...T.access, repositories: T.access.repositories.map((x) => (x.state === "pinned" ? { ...x, state: "pending", pendingSend: { claims: {} } } : x)) }; return screens.arrivee(""); }],
    ["declarer", () => screens.declarer("")], ["declarer refused", () => { S.formError = { message: "Repository malformed.", action: "Write owner/name." }; return screens.declarer(""); }],
    ["declarer attente", () => screens.declarer(`attente/${T.pending.id}`)], ["declarer confirmer, nothing", () => screens.declarer(`confirmer/${r.id}`)],
    ["declarer confirmer", () => { S.access = { ...T.access, repositories: [{ ...r, state: "pending", pendingSend: { claims: { repository: r.name, repositoryId: "7002", repositoryOwnerId: "2002", runNumber: "11", runAttempt: "1" } } }] }; return screens.declarer(`confirmer/${r.id}`); }],
    ["declarer owner changed", () => { S.access = { ...T.access, repositories: [{ ...r, ownerId: "1", pendingSend: { reason: "owner-changed", claims: { repositoryId: "7002", repositoryOwnerId: "2002" } } }] }; S.failed = `confirm:${r.id}`; return screens.declarer(`confirmer/${r.id}`); }],
    ["declarer modifier", () => screens.declarer(`modifier/${r.id}`)],
    ["envois", () => screens.envois()], ["envois error", () => { S.journalError = { requestId: "r-1" }; return screens.envois(); }],
    ["envois empty", () => { S.journal = { ...T.journal.en, entries: [], end: true }; return screens.envois(); }],
    ["acces", () => screens.acces("")], ["acces error", () => { S.accessError = { requestId: "r-1" }; return screens.acces(""); }],
    ["acces export", () => screens.acces("export")], ["acces export busy", () => { S.export = { busy: true }; return screens.acces("export"); }],
    ["acces export ready", () => { S.export = { ready: { id: "x", size: 1234567, sha256: "a".repeat(64), expiresAt: "2026-11-12T10:00:00.000Z" } }; return screens.acces("export"); }],
    ["acces export error", () => { S.export = { error: { requestId: "r-1" } }; return screens.acces("export"); }],
    ["acces ajout", () => screens.acces("ajout")], ["acces ajout exists", () => { S.addError = "exists"; return screens.acces("ajout"); }], ["acces ajout cancelled", () => { S.addError = "cancelled"; return screens.acces("ajout"); }],
    ["acces effacer", () => screens.acces("effacer")],
    ["acces removed", () => { S.access = { ...T.access, sameProvider: true, passkeys: [...T.access.passkeys, { ...pk, id: "gone", removedAt: "2026-11-10T10:00:00.000Z", restorableUntil: "2026-11-11T10:00:00.000Z" }], repositories: [...T.access.repositories, { ...r, state: "removed", restorableUntil: "2026-12-10T10:00:00.000Z" }] }; return screens.acces(""); }],
    ...Object.keys(KINDS).map((k) => [`confirm ${k}`, () => { S.confirming = `${k}:${k === "passkey" ? pk.id : "x"}`; return { html: confirmBox(S.confirming) }; }]),
    ["confirm busy", () => { S.confirming = S.busy = "repo:x"; return { html: confirmBox("repo:x") }; }],
    ["confirm failed", () => { S.confirming = S.failed = "repo:x"; return { html: confirmBox("repo:x") }; }],
    ...["", "hors-ligne", "lent"].map((sub) => [`panne ${sub}`, () => { S.error = { requestId: "r-1" }; return screens.panne(sub); }]),
    ["legal", () => screens.legal()], ["404", () => screens.introuvable("#/nowhere")], ["404 signed out", () => { S.session = null; return screens.introuvable("#/nowhere"); }],
    ...["flotte", "vue", "history", "proof", "signatures", "pr", "sources"].map((route) => [`fleet ${route}`, () => screens.fleet(route, "")]),
    ...T.index.missions.map((m) => [`mission ${m.id}`, () => screens.fleet("mission", m.id)]),
    ["fleet error", () => { S.fleetError = { requestId: "r-1" }; return screens.fleet("vue", ""); }], ["fleet empty", () => { S.index = null; return screens.fleet("flotte", ""); }],
    ["fleet no index", () => { S.index = null; return screens.fleet("vue", ""); }], ["fleet loading", () => { S.status = null; return screens.fleet("vue", ""); }],
    ["decision", () => screens.decision("")], ...T.index.missions.map((m) => [`decision ${m.id}`, () => screens.decision(m.id)]),
  ];
}
const paintAll = (lang) => allScreens().map(([name, view]) => { state({ lang }); const v = view(); assert.ok(v && typeof v.html === "string", `${name}: a screen`); return [name, `${v.html}\n${v.title ?? ""}`]; });

test("every screen of the shell, in each of its states, painted in English, carries no French word", async () => {
  const painted = paintAll("en");
  assert.ok(painted.length >= 90, `the guard must see every screen, or it proves nothing (${painted.length})`);
  const found = painted.flatMap(([name, html]) => frenchIn(html).map((t) => `${name}: ${t}`));
  assert.deepEqual(found, []);
  // and in French, every screen is French: the detector reads what it should
  const fr = paintAll("fr"), quiet = fr.filter(([, html]) => !frenchIn(html).length).map(([name]) => name);
  if (process.env.PEEK) (await import("node:fs")).writeFileSync(process.env.PEEK, [...new Set(painted.flatMap(([, h]) => decode(h.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "\n")).split(/\n+/).map((x) => x.trim()).filter(Boolean)))].join("\n"));
  assert.ok(fr.length - quiet.length >= painted.length - 2, `in French, every screen is seen as French: ${quiet.join(", ")}`);
});

test("planted control: one screen's string left in French is found in the English screen", () => {
  const en = Lx.MOTS.en.acces.membres;
  const was = en.lastOwner;
  en.lastOwner = Lx.MOTS.fr.acces.membres.lastOwner;
  try {
    state({ lang: "en" });
    assert.deepEqual(frenchIn(screens.acces("").html), ["Le dernier propriétaire ne se retire pas."]);
  } finally { en.lastOwner = was; }
});

// ---- the page's own words: each element of web/index.html with a word carries the key the shell writes it from
const PAGE = readFileSync(join(WEB, "index.html"), "utf8");
/**
 * The words of the page the shell does not write: a text or a label on an element without its hook (data-mot,
 * data-mot-aria), and a hook the lexicon does not know. The page carries no tenant data: every word counts, French or
 * not, the brand's own name aside; the message for a browser without scripts is said in both languages, each declared.
 */
export function pageFaults(html, words) {
  const faults = [];
  for (const m of html.matchAll(/data-mot(-aria)?="([^"]+)"/g)) for (const lang of ["fr", "en"]) if (!Object.hasOwn(words[lang].frame.page, m[2])) faults.push(`${lang} lacks frame.page.${m[2]}`);
  const rest = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "")
    .replace(/<(\w+)\b[^>]*\bdata-mot="[^"]+"[^>]*>[^<]*<\/\1>/g, "")
    .replace(/<span lang="(?:fr|en)">[^<]*<\/span>/g, "");
  for (const m of rest.matchAll(/<[^>]*\baria-label="([^"]*)"[^>]*>/g)) if (!/\bdata-mot-aria="/.test(m[0])) faults.push(`label not written by the shell: ${m[1]}`);
  for (const t of rest.replace(/<[^>]+>/g, "\n").split(/\n+/).map((x) => x.trim())) if (/\p{L}/u.test(t) && t !== "runward") faults.push(`not written by the shell: ${t}`);
  return faults;
}
test("every word of web/index.html is written by the shell in the reader's language (data-mot, data-mot-aria)", () => {
  assert.ok((PAGE.match(/data-mot(-aria)?=/g) ?? []).length >= 8, "the guard must see the hooks");
  assert.deepEqual(pageFaults(PAGE, Lx.MOTS), []);
  // the scan reads the page: the same page with its hooks taken off shows each of its words
  assert.deepEqual(pageFaults(PAGE.replace(/ data-mot(-aria)?="[^"]+"/g, ""), Lx.MOTS), [
    "label not written by the shell: Navigation de l'app", "label not written by the shell: Fil d'Ariane", "label not written by the shell: Langue",
    "label not written by the shell: Changer de thème, clair ou sombre", "label not written by the shell: Navigation de l'app",
    "label not written by the shell: Fil d'Ariane", "label not written by the shell: Langue",
    "not written by the shell: runward hébergé", "not written by the shell: Aller au contenu", "not written by the shell: hébergé", "not written by the shell: Menu",
  ]);
  // planted controls: a word with no hook, a hook the lexicon does not know
  assert.deepEqual(pageFaults(PAGE.replace('<div id="bandeaux"', '<p>Aller au contenu</p><div id="bandeaux"'), Lx.MOTS), ["not written by the shell: Aller au contenu"]);
  assert.deepEqual(pageFaults(PAGE.replace('data-mot="menu"', 'data-mot="menu-planted"'), Lx.MOTS), ["fr lacks frame.page.menu-planted", "en lacks frame.page.menu-planted"]);
});

// ---- the lexicon: closed, the same keys in both languages, none of the words never said, no em dash
const sample = (v) => v("1", "1", "1", "1");
const flatten = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[`${p}${k}`, v]] : typeof v === "function" ? [[`${p}${k}`, sample(v)], [`${p}${k}:n`, v("2", "2", "2", "2")], [`${p}${k}/${v.length}`, ""]] : Array.isArray(v) ? v.map((x, i) => [`${p}${k}.${i}`, String(x)]) : flatten(v, `${p}${k}.`)));
const NEVER = /\b(compliant|compliance|certified|certifi\w*|guarantee\w*|garanti\w*|platforms?|plateformes?|sovereign\w*|souverain\w*|conformes?|infalsifiable|tamper-?proof)\b|—/i;
export function lexiconProblems(words) {
  const fr = new Map(flatten(words.fr)), en = new Map(flatten(words.en));
  const out = [];
  for (const k of fr.keys()) if (!en.has(k)) out.push(`en lacks ${k}`);
  for (const k of en.keys()) if (!fr.has(k)) out.push(`fr lacks ${k}`);
  for (const [lang, m] of [["fr", fr], ["en", en]]) for (const [k, v] of m) if (NEVER.test(v)) out.push(`${lang} ${k}: ${v.match(NEVER)[0]}`);
  // an English value that is a French one: a word not translated (the same word in both, a proper name, is allowed)
  for (const [k, v] of en) if (v && fr.get(k) === v && FRENCH.test(v)) out.push(`en ${k}: left in French`);
  return out;
}
test("the lexicon: the same keys and the same arities in French and English, none of the words never said, no em dash", () => {
  assert.ok(flatten(Lx.MOTS.fr).length > 400, "the guard must see the lexicon");
  assert.deepEqual(lexiconProblems(Lx.MOTS), []);
  // each language's plural: English for any number but one, French from two on
  assert.deepEqual([0, 1, 2].map((n) => Lx.MOTS.en.arrivee.count(1, n)), ["1 passkey · 0 repositories declared", "1 passkey · 1 repository declared", "1 passkey · 2 repositories declared"]);
  assert.deepEqual([0, 1, 2].map((n) => Lx.MOTS.fr.envois.head(n, "h")), ["journal du locataire · 0 entrée · tête <b>h</b>", "journal du locataire · 1 entrée · tête <b>h</b>", "journal du locataire · 2 entrées · tête <b>h</b>"]);
  assert.equal(Lx.MOTS.en.envois.head(0, "h"), "tenant's journal · 0 entries · head <b>h</b>");
  // planted controls: a key missing in one language, a banned word, an em dash, an arity changed, a value left in French
  const copy = (w) => ({ ...w, frame: { ...w.frame }, common: { ...w.common } });
  const planted = { fr: copy(Lx.MOTS.fr), en: copy(Lx.MOTS.en) };
  delete planted.en.frame.reload;
  planted.fr.common.declare = "Déclarer votre plateforme";
  planted.en.common.retry = "Try again — now";
  planted.en.frame.you = (role) => `you · ${role}`;
  planted.en.common.cancel = Lx.MOTS.fr.common.cancel;
  planted.en.frame.legal = Lx.MOTS.fr.frame.legal;
  assert.deepEqual(lexiconProblems(planted).sort(), ["en lacks frame.reload", "en common.retry: —", "fr common.declare: plateforme", "en lacks frame.you/2", "fr lacks frame.you/1", "en frame.legal: left in French"].sort());
});

test("one language for the reading and its frame: the switch of the decision reading reaches the frame, the index's language when no choice is kept", async () => {
  const D = await mod("decision");
  state({ lang: null });
  assert.equal(Lx.lang(), "fr", "the index is French and nothing is kept: French");
  D.setReadingLang("en");
  assert.equal(kept.get("rw-accueil-lang"), "en", "the key of the public site's switch");
  assert.equal(D.readingLang(), "en");
  assert.ok(frame(true, "decision", "", {}).lat.includes("Portfolio"), "the frame follows the reading's switch");
  assert.ok(D.viewDecision("").html.startsWith('<div class="lecture" lang="en" data-vue="port">'));
  kept.delete("rw-accueil-lang");
  S.index = { ...T.index, lang: "en" };
  assert.equal(Lx.lang(), "en", "no choice kept: the index's own language");
  assert.ok(frame(true, "decision", "", {}).lat.includes("Technical views"));
  Lx.setLang("de");
  assert.equal(kept.has("rw-accueil-lang"), false, "a language the app does not have is never kept");
});

test("the API is asked in the reader's language (the service already answers its refusals in the one Accept-Language names)", async () => {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, init) => { asked.push(init.headers); return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); };
  try { for (const lang of ["en", "fr"]) { state({ lang }); await api("GET", "/api/v0/session"); await api("POST", "/api/v0/auth/options", {}); } } finally { globalThis.fetch = real; }
  assert.deepEqual(asked, [{ "accept-language": "en" }, { "accept-language": "en", "content-type": "application/json" }, { "accept-language": "fr" }, { "accept-language": "fr", "content-type": "application/json" }]);
});
