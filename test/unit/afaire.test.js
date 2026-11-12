// « La piste », its common part (ADR-0034): what the status line and the session add for the frame, « À faire » as the
// first block of the portfolio, the menu of four entries with its count, the technical views folded and closed until
// the first check is confirmed, the control account's banner, and the sign-in in the decision maker's words. The
// modules are run as the app serves them (the pinned views' slot filled, as src/http/assets.js serves them), over a
// tenant built by the real application: a published application, a repository whose first upload waits for its
// confirmation, one that has sent nothing, one confirmed without consent.
//
// What is held here: each additive field says what the service holds, and no deadline it does not hold (a declaration
// expires only while nothing arrived: the daily pass is run to prove it); each item of « À faire » says what to do, why,
// its deadline, and its button lands on the screen of that gesture; an item goes once its gesture is done; the menu's
// count is the items', none while they are not known; the control account hides what has no use there. Each guard has
// its planted control.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { MODULES } from "../../src/http/assets.js";
import { PENDING_LIFE } from "../../src/domain/repository.js";
import { harness, founder, gesture, send, sha, confirmRepository } from "../helpers.js";

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
const served = mkdtempSync(join(tmpdir(), "rw-afaire-"));
after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) {
  const p = join(served, f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href)));
}
const mod = (f) => import(pathToFileURL(join(served, `views/${f}.js`)).href);
const { S } = await mod("base");
const A = await mod("afaire");
const { frame } = await mod("shell");
const screens = { declarer: (await mod("declarer")).viewDeclarer, acces: (await mod("acces")).viewAcces, arrivee: (await mod("arrivee")).viewArrivee, entree: (await mod("entree")).viewEntree, fleet: await mod("fleet") };

// ---- a tenant built by the real application
async function tenant({ witness = false } = {}) {
  const h = harness();
  const tok = randomBytes(32).toString("base64url");
  const opened = (await h.app.operator.openBootstrap({ hash: sha(Buffer.from(tok)), witness })).tenant;
  const f = await founder(h, { token: tok, tenant: opened });
  const s0 = () => h.app.identity.sessionFrom(f.token);
  const declare = async (name, missions, consent = true) => {
    await gesture(h, await s0(), consent ? "declare-with-consent" : null, name.toLowerCase());
    return h.app.repositories.declare(await s0(), { name, consent, missions }, {});
  };
  const hosted = await declare("stranxik/runward-hosted", [{ id: "runward-hosted", path: "." }]);
  await send(h, { repository: "stranxik/runward-hosted", repository_id: "7002", run_id: "42830000011", run_number: "11", sha: "a4ede1485323293609957a700aba13ddf99de27f" }, { mission: "runward-hosted", bytes: FIXTURE("hosted-proposed") });
  await confirmRepository(h, f, hosted.id);
  const radar = await declare("stranxik/radar", [{ id: "radar", path: "." }], false);
  await send(h, { repository: "stranxik/radar", repository_id: "7004", run_id: "42830000031", run_number: "4" }, { mission: "radar" });
  await confirmRepository(h, f, radar.id);
  h.clock.advance(60_000);
  const waiting = await declare("stranxik/next-one", [{ id: "next-one", path: "." }]);
  const dropyour = await declare("stranxik/dropyour", [{ id: "dropyour", path: "." }]);
  h.clock.advance(60_000);
  const first = await send(h, { repository: "stranxik/dropyour", repository_id: "7005", run_id: "42830000041", run_number: "7" }, { mission: "dropyour" });
  assert.equal(first.status, 202);
  const json = (x) => JSON.parse(JSON.stringify(x));
  const read = async () => {
    const s = await s0();
    return { session: json(await h.app.identity.sessionView(s)), access: json(await h.app.identity.accessView(s)), status: json(await h.app.reading.status(s)), index: JSON.parse((await h.app.reading.index(s.tenantId)).bytes.toString("utf8")) };
  };
  return { h, f, ids: { hosted: hosted.id, radar: radar.id, waiting: waiting.id, dropyour: dropyour.id }, read, ...(await read()) };
}
const T = await tenant();
const line = (st, m) => st.lines.find((l) => l.mission === m);
function state(over = {}, data = T) {
  kept.set("rw-accueil-lang", over.lang ?? "fr");
  Object.assign(S, { session: data.session, access: data.access, status: data.status, index: data.index, journal: null, fleetError: null, accessError: null, journalError: null, error: null, confirming: null, busy: null, failed: null, formError: null, formValues: null, addError: null, export: null, origine: null, newVersion: false }, over);
}
const text = (h) => h.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
function targets(html) {
  const out = [];
  for (const m of String(html).matchAll(/<button\b[^>]*\bdata-go="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)) out.push([text(m[2]), m[1].replace(/&amp;/g, "&")]);
  for (const m of String(html).matchAll(/<a\b[^>]*\bhref="(#[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) out.push([text(m[2]), m[1].replace(/&amp;/g, "&")]);
  return out;
}
const items = (html) => [...String(html).matchAll(/<li class="af-i">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const NEVER = /\b(compliant|compliance|certified|certifi\w*|guarantee\w*|garanti\w*|platforms?|plateformes?|sovereign\w*|souverain\w*|conformes?|conformit\w*|infalsifiable|tamper-?proof)\b|—/i;

// ------------------------------------------------------------- the data
test("the status line carries what the to-do reads: the repository's id, its declaration's dates, the upload that waits", () => {
  const w = line(T.status, "next-one"), d = line(T.status, "dropyour"), p = line(T.status, "runward-hosted"), r = line(T.status, "radar");
  assert.deepEqual([w, d, p, r].map((l) => l.repositoryRef), [T.ids.waiting, T.ids.dropyour, T.ids.hosted, T.ids.radar], "the repository's own id");
  for (const l of [w, d, p, r]) assert.match(l.declaredAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(w.expiresAt, new Date(Date.parse(w.declaredAt) + PENDING_LIFE).toISOString(), "nothing arrived: it expires 7 days after its declaration");
  assert.equal(w.pendingReceivedAt, null);
  assert.equal(d.expiresAt, null, "a first upload arrived: it waits for the confirmation, with no date");
  assert.match(d.pendingReceivedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(p.expiresAt, null); assert.equal(p.pendingReceivedAt, null, "confirmed: nothing waits");
  assert.equal(r.consent, false);
});

test("the rule the dates say is the daily pass's: past 7 days, the declaration with nothing received expires, the one whose first upload arrived stays", async () => {
  const t = await tenant();
  t.h.clock.advance(PENDING_LIFE + 60_000);
  await t.h.app.operator.retention();
  // read as the witness reader does: the member's session has ended after 7 days
  const now = { status: JSON.parse(JSON.stringify(await t.h.app.reading.status({ tenantId: t.f.tenant }))) };
  assert.equal(line(now.status, "next-one"), undefined, "expired at the date its line said");
  assert.equal(line(now.status, "dropyour").state, "pending", "kept: no date was said, and none applied");
  // planted control: a date written for every declaration still pending (the access view's rule) would have said one
  // for dropyour, which did not expire
  const naive = (r) => (r.state === "pending" ? new Date(Date.parse(r.declaredAt) + PENDING_LIFE).toISOString() : null);
  assert.notEqual(naive(t.access.repositories.find((r) => r.name === "stranxik/dropyour")), line(t.status, "dropyour").expiresAt);
});

test("the session says the service's control account, and only it", async () => {
  assert.equal(T.session.tenant.witness, false);
  const W = await tenant({ witness: true });
  assert.equal(W.session.tenant.witness, true);
});

// ------------------------------------------------------------- « À faire »
test("« À faire »: one item per gesture, what to do, why, its deadline, its button landing on the screen of that gesture", () => {
  state();
  assert.deepEqual(A.aFaire().map((i) => [i.kind, i.name]), [["confirm", "dropyour"], ["install", "next-one"], ["consent", "radar"]], "a check that arrived first, then a deadline, then the rest");
  // the drawer of the top bar holds the whole block (ADR-0036); the strip at the head of the list says the same items
  const b = A.blocAFaire();
  assert.ok(b.startsWith('<section class="afaire"'), "the whole block");
  assert.ok(frame(true, "decision", "", {}).tiroir.includes(b), "the drawer « À faire » opens on it");
  const [confirm, install, consent] = items(b);
  // the first upload: its date, no deadline (none is held), its confirmation
  assert.match(confirm, /Confirmez le premier contrôle de <span translate="no">dropyour<\/span>\./);
  assert.match(confirm, /Il est arrivé le <time datetime="[^"]+">[^<]+<\/time>\. Tant que vous ne l'avez pas confirmé, rien n'est publié\./);
  assert.match(confirm, /Pas de date limite\./);
  assert.deepEqual(targets(confirm), [["Confirmer", `#/declarer/confirmer/${T.ids.dropyour}`]]);
  // nothing received: the step to add, and the date the declaration expires
  assert.match(install, /Avant le <time datetime="[^"]+">[^<]+<\/time>, sinon la déclaration expire\./);
  assert.deepEqual(targets(install), [["Voir l'étape à ajouter", `#/declarer/attente/${T.ids.waiting}`]]);
  // confirmed without consent
  assert.match(consent, /Donnez votre accord pour <span translate="no">radar<\/span>\./);
  assert.deepEqual(targets(consent), [["Donner l'accord", `#/acces/depot/${T.ids.radar}/accord`]]);
  // each lands on its gesture
  const c = screens.declarer(`confirmer/${T.ids.dropyour}`);
  assert.ok(c.html.includes(`data-k="confirm:${T.ids.dropyour}"`), "the confirmation of that repository, its button");
  assert.ok(screens.declarer(`attente/${T.ids.waiting}`).html.includes('id="extrait"'), "the step the team adds");
  assert.equal(screens.acces(`depot/${T.ids.radar}/accord`).cible, "#depot-accord button", "its consent, focused");
  assert.equal(NEVER.test(text(b)), false);
  // the strip: each item's question, deadline and button, without its reason
  const strip = A.bandeAFaire();
  assert.ok(strip.startsWith('<section class="afaire af-strip"'));
  assert.deepEqual(items(strip).map((i) => targets(i)[0][1]), [`#/declarer/confirmer/${T.ids.dropyour}`, `#/declarer/attente/${T.ids.waiting}`, `#/acces/depot/${T.ids.radar}/accord`]);
  assert.equal(strip.includes("Tant que vous ne l'avez pas confirmé"), false, "the strip says what to do and by when, the drawer why");
  // an application's own item, in its reading
  assert.match(A.aFairePour(line(T.status, "dropyour")), /Confirmez le premier contrôle de <span translate="no">dropyour<\/span>\./);
  assert.equal(A.aFairePour(line(T.status, "runward-hosted")), "", "the control: nothing waits for it");
  // no banner carries the block any more, on any screen
  assert.equal(frame(true, "envois", "", {}).bandeaux.includes("afaire"), false);
  assert.equal(frame(true, "decision", "", {}).bandeaux.includes("afaire"), false);
  // the top bar's count: the items', and its label says it
  assert.match(frame(true, "envois", "", {}).afaire, /<button class="afaire-btn" type="button" data-do="afaire"[^>]*data-n="3"[^>]*aria-label="À faire, 3 gestes attendus">À faire<span class="badge num" aria-hidden="true">3<\/span><\/button>/);
});

test("an item goes once its gesture is done: the first upload confirmed leaves « À faire »", async () => {
  const t = await tenant();
  await confirmRepository(t.h, t.f, t.ids.dropyour);
  const now = await t.read();
  state({}, now);
  assert.deepEqual(A.aFaire().map((i) => i.kind), ["install", "consent"]);
  // planted control: the line as it was keeps the item
  state({}, t);
  assert.ok(A.aFaire().some((i) => i.kind === "confirm"));
});

test("the second passkey is an item of the portfolio, and the banner that says it is not repeated there; elsewhere the banner stays", () => {
  state({ session: { ...T.session, passkeys: 1 } });
  assert.equal(A.aFaire().at(-1).kind, "passkey");
  const port = frame(true, "decision", "", {}).bandeaux;
  assert.match(A.bandeAFaire(), /Ajoutez une seconde passkey\./);
  assert.equal(port.includes("Vous n'avez qu'une passkey."), false, "on Applications the strip says it");
  assert.ok(frame(true, "envois", "", {}).bandeaux.includes("Vous n'avez qu'une passkey."));
  // with nothing else to do, the block is the passkey alone; with nothing at all, no block
  state({ session: { ...T.session, passkeys: 2 }, status: { ...T.status, lines: [] } });
  assert.equal(frame(true, "decision", "", {}).bandeaux, "");
  assert.equal(A.bandeAFaire(), "", "nothing waits: no strip");
  assert.match(frame(true, "decision", "", {}).tiroir, /Rien à faire pour l&#39;instant\./, "the drawer says so");
  assert.match(frame(true, "decision", "", {}).afaire, /data-n="0"/);
  // the items not known (a screen opened cold): no button, no count
  state({ status: null, index: null });
  assert.equal(frame(true, "envois", "", {}).afaire, "");
});

test("in English, « À faire » says the same in English", () => {
  state({ lang: "en" });
  const b = A.blocAFaire() + A.bandeAFaire() + frame(true, "decision", "", {}).afaire;
  assert.ok(b.includes(">To do<") && b.includes("Confirm the first check of") && b.includes("No deadline.") && b.includes("or the declaration expires.") && b.includes("To do, 3 gestures waiting"));
  assert.equal(/À faire|Confirmez|délai|Avant le/.test(b), false);
});

// ------------------------------------------------------------- the menu
test("the menu: four entries, the count of what waits on « Applications », no line per application (the list of Applications says them), the export inside the account; the same four in the phone's tab bar", () => {
  state();
  const f = frame(true, "decision", "", {});
  const main = /<nav aria-label="Navigation principale">([\s\S]*?)<\/nav>/.exec(f.lat)[1];
  const unesc = (h) => h.replace(/&#39;/g, "'");
  assert.deepEqual(targets(main).map(([l, h]) => [l.replace(/, \d+ à faire$/, "").replace(/\d+$/, ""), h]), [["Applications", "#/"], ["Brancher une application", "#/declarer"], ["Journal", "#/envois"], ["Compte", "#/acces"]]);
  assert.match(main, /<span class="badge num" aria-hidden="true">3<\/span><span class="vh">, 3 à faire<\/span>/);
  assert.equal(f.lat.includes("#/acces/export"), false, "the export is a section of the account, not an entry");
  assert.ok(screens.acces("").html.includes("Récupérer vos données") && screens.acces("").html.includes('data-go="#/acces/export"'));
  // the applications leave the sidebar (ADR-0036): the list of Applications says them, each to its reading
  assert.equal(/#\/decision\/|#\/declarer\/(confirmer|attente)/.test(unesc(f.lat)), false, "no line per application in the sidebar");
  // the phone: the tab bar carries the four entries and the count; the menu keeps the language, the technical views and the sign-out
  assert.deepEqual(targets(f.tabs).map(([l, h]) => [l.replace(/\d+, \d+ à faire$/, ""), h]), [["Applications", "#/"], ["Brancher", "#/declarer"], ["Journal", "#/envois"], ["Compte", "#/acces"]]);
  assert.match(f.tabs, /<a class="tab" href="#\/" aria-current="page">[\s\S]*?<span class="badge num" aria-hidden="true">3<\/span>/);
  assert.ok(f.mobnav.includes('data-do="lecture-lang"') && f.mobnav.includes('data-do="logout"') && f.mobnav.includes("Vues techniques"));
  assert.equal(f.mobnav.includes("Brancher une application"), false, "the four entries are the tab bar's");
  // the count is none while the items are not known (a screen opened cold, before the portfolio was read)
  state({ status: null, index: null });
  assert.equal(frame(true, "envois", "", {}).lat.includes("badge"), false);
  // planted control: the count is the items', not a fixed one
  state({ session: { ...T.session, passkeys: 1 } });
  assert.match(frame(true, "envois", "", {}).lat, /class="badge num" aria-hidden="true">4</);
});

test("the technical views: folded, and closed with their reason until the first check of an application is confirmed; their address says so", () => {
  state();
  let f = frame(true, "decision", "", {});
  assert.match(f.lat, /<details class="tech"><summary class="sec">Vues techniques<\/summary>/, "folded");
  assert.ok(targets(f.lat).some(([, h]) => h === "#/flotte"));
  assert.match(frame(true, "flotte", "", {}).lat, /<details class="tech" open>/, "open on one of them");
  state({ session: { ...T.session, arrivalDone: false } });
  f = frame(true, "decision", "", {});
  assert.match(f.lat.replace(/&#39;/g, "'"), /<div class="tech ferme"><p class="sec">Vues techniques<\/p><p class="tech-note">S'ouvrent quand le premier contrôle d'une application est confirmé\.<\/p><\/div>/);
  for (const r of ["flotte", "vue", "history", "proof", "signatures", "pr", "sources"]) assert.equal(targets(f.lat).some(([, h]) => h === `#/${r}`), false, `${r}: no link while closed`);
  const v = screens.fleet.viewVuesFermees("flotte");
  assert.match(text(v.html), /S'ouvrent quand le premier contrôle d'une application est confirmé\./);
  assert.deepEqual(targets(v.html), [["Revenir aux applications", "#/"]]);
  // the router: the arrival not open goes to the arrival; open with nothing confirmed, the closed screen, never a redirect
  const router = readFileSync(join(WEB, "views/router.js"), "utf8");
  assert.match(router, /!S\.session\.arrivalOpen && screen\?\.reads === "fleet"\) \{ location\.replace\("#\/arrivee"\)/);
  assert.match(router, /!S\.session\.arrivalDone && screen === FLEET\) \{ paint\(viewVuesFermees\(route\)\)/);
});

// ------------------------------------------------------------- the control account
test("the control account: its banner on every screen, no « Brancher une application », no item of an application", async () => {
  const W = await tenant({ witness: true });
  state({}, W);
  const f = frame(true, "decision", "", {});
  assert.ok(f.bandeaux.startsWith('<div class="bandeau temoin" role="note"><p>'));
  assert.equal(text(/^<div class="bandeau temoin"[^>]*>([\s\S]*?)<\/div>/.exec(f.bandeaux)[1]), "Compte de contrôle du service : chaque mise en production y dépose le contrôle de runward hébergé ; son premier envoi reste en attente, c'est normal.");
  assert.ok(frame(true, "acces", "", {}).bandeaux.includes("bandeau temoin"), "on every screen");
  assert.equal(f.lat.includes("Brancher une application"), false);
  assert.equal(f.tabs.includes("#/declarer"), false, "nor in the phone's tab bar");
  assert.ok(f.lat.includes("<b>Compte de contrôle du service</b>"));
  assert.deepEqual(A.aFaire(), [], "its first upload waits on purpose");
  assert.equal(A.compteTemoin(), true);
  // the hook the portfolio uses to hide its waiting block there
  assert.match(readFileSync(join(WEB, "app.css"), "utf8"), /body\.temoin \[data-hors-temoin\], body\.temoin \.lecture-attendues, body\.temoin \.lecture-actions, body\.temoin \.lecture-vide\{ display:none !important; \}/);
  // planted control: the same tenant, not the control account, has its items and its entry
  state({ session: { ...W.session, tenant: { ...W.session.tenant, witness: false } } }, W);
  assert.ok(A.aFaire().length > 0 && frame(true, "decision", "", {}).lat.includes("Brancher une application"));
});

// ------------------------------------------------------------- the sign-in
test("the sign-in, in the decision maker's words, with the public demo's two checks drawn as « La piste »", () => {
  state({ session: null });
  const v = screens.entree("connexion");
  assert.match(v.html, /<h1 class="t-hero">Avant chaque mise en production, ce qui bloque et pourquoi\.<\/h1>/);
  assert.ok(v.html.includes("Vos équipes livrent avec des agents d'IA.") && v.html.includes("data-do=\"signin\""));
  const pistes = [...v.html.matchAll(/<ol class="ex-piste"( data-arret="(\d)")?/g)].map((m) => m[2] ?? null);
  assert.deepEqual(pistes, ["3", null], "the refused check stops at Plancher; the repaired one runs to the end");
  for (const step of ["Cadrer", "Architecturer", "Plancher", "Itérer", "Gouverner", "Transmettre"]) assert.equal(v.html.split(`>${step}<`).length - 1, 2, step);
  assert.ok(v.html.includes("97fce96") && v.html.includes("0b56196"));
  assert.equal(NEVER.test(text(v.html)), false);
  // the other states keep their window
  assert.equal(screens.entree("expiree").html.includes("ex-piste"), false);
  state({ session: null, lang: "en" });
  assert.match(screens.entree("connexion").html, /Before every release to production, what blocks it and why\./);
});

test("the code size is on the scale: 12 px, 14 px in a lede, never a fraction of its line", () => {
  const css = readFileSync(join(WEB, "app.css"), "utf8");
  assert.match(css, /\ncode, \.hash\{ font-size:var\(--fs-releve\); \}/);
  assert.equal(/code[^{]*\{[^}]*font-size:[^;}]*em\b/.test(css), false, "no em size for code");
  // planted control: the old rule is seen
  assert.equal(/code[^{]*\{[^}]*font-size:[^;}]*em\b/.test("code, .hash{ font-size:max(var(--fs-releve), .86em); }"), true);
});
