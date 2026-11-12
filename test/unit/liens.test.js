// Where each link of the app lands (web/views/liens.js): no button or link drops a member at the top of Accès without
// the action they came for (the author's witness of 2026-11-11, « beaucoup de pages renvoient vers #/acces, un
// utilisateur ne saurait pas quoi faire »). The modules are run as the app serves them (the pinned views' slot filled,
// as src/http/assets.js serves them), over a tenant built by the real application: a repository whose first upload
// arrived (kept, to confirm), one that has sent nothing, one confirmed without consent, and published missions.
//
// What is held here: the link map, origin by origin, each landing on its intended target, and that target is the
// screen of the action (its button, its section, its focus); every link and button of every screen painted leads to a
// screen that exists; the only link to the bare top of Accès is the sidebar's « Accès »; a task sends back where it
// was opened from, never to the top of Accès; a repository whose first upload arrived says so, with its date, and
// carries its confirmation as its first gesture. Each guard has its planted control.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULES } from "../../src/http/assets.js";
import { harness, founder, gesture, send, SEND_SHA } from "../helpers.js";

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
const served = mkdtempSync(join(tmpdir(), "rw-liens-"));
after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) {
  const p = join(served, f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href)));
}
const mod = (f) => import(pathToFileURL(join(served, `views/${f}.js`)).href);
const { S } = await mod("base");
const L = await mod("liens");
const { frame } = await mod("shell");
const screens = {
  arrivee: (await mod("arrivee")).viewArrivee, declarer: (await mod("declarer")).viewDeclarer, envois: (await mod("envois")).viewEnvois,
  fleet: (await mod("fleet")).viewFleet, decision: (await mod("decision")).viewDecision, acces: (await mod("acces")).viewAcces,
  entree: (await mod("entree")).viewEntree, legal: (await mod("legal")).viewLegal,
};

// ---- a tenant built by the real application
async function tenant() {
  const h = harness();
  const f = await founder(h);
  const s0 = () => h.app.identity.sessionFrom(f.token);
  const declare = async (name, missions, consent = true) => {
    await gesture(h, await s0(), consent ? "declare-with-consent" : null, name.toLowerCase());
    return h.app.repositories.declare(await s0(), { name, consent, missions }, {});
  };
  // the confirmation is bound to the digest of the values the screen shows (ADR-0029 section 1)
  const confirm = async (d) => {
    const shown = (await h.app.identity.accessView(await s0())).repositories.find((r) => r.id === d.id).pending;
    await gesture(h, await s0(), "repository-confirm", `${d.id}:${shown.digest}`);
    await h.app.repositories.confirm(await s0(), d.id, { digest: shown.digest }, {});
  };
  // published: one application, read by the portfolio
  let d = await declare("stranxik/runward-hosted", [{ id: "runward-hosted", path: "." }]);
  await send(h, { repository: "stranxik/runward-hosted", repository_id: "7002", run_id: "42830000011", run_number: "11", sha: "a4ede1485323293609957a700aba13ddf99de27f" }, { mission: "runward-hosted", bytes: FIXTURE("hosted-proposed") });
  await confirm(d);
  // confirmed without consent: its first upload kept nothing, it is not in the portfolio
  d = await declare("stranxik/radar", [{ id: "radar", path: "." }], false);
  const radarFirst = await send(h, { repository: "stranxik/radar", repository_id: "7004", run_id: "42830000031", run_number: "4" }, { mission: "radar" });
  assert.equal(radarFirst.refusal, "content-not-consented");
  await confirm(d);
  // nothing sent yet
  const waiting = await declare("stranxik/next-one", [{ id: "next-one", path: "." }]);
  // its first upload arrived: kept, to confirm (202 repository-pending)
  h.clock.advance(60_000);
  const dropyour = await declare("stranxik/dropyour", [{ id: "dropyour", path: "." }]);
  const first = await send(h, { repository: "stranxik/dropyour", repository_id: "7005", run_id: "42830000041", run_number: "7" }, { mission: "dropyour" });
  assert.equal(first.status, 202);
  assert.equal(first.refusal, "repository-pending");
  const s = await s0();
  const json = (x) => JSON.parse(JSON.stringify(x));
  return {
    session: json({ ...(await h.app.identity.sessionView(s)), sendWorkflow: [SEND_SHA] }), access: json(await h.app.identity.accessView(s)),
    status: json(await h.app.reading.status(s)), index: JSON.parse((await h.app.reading.index(s.tenantId)).bytes.toString("utf8")),
    ids: { dropyour: dropyour.id, waiting: waiting.id, radar: d.id },
  };
}
const T = await tenant();
const repoOf = (name) => T.access.repositories.find((r) => r.name === name);
function state(over = {}) {
  kept.set("rw-accueil-lang", over.lang ?? "fr");
  Object.assign(S, { session: T.session, access: T.access, status: T.status, index: T.index, journal: null, fleetError: null, accessError: null, journalError: null, error: null, confirming: null, busy: null, failed: null, formError: null, formValues: null, addError: null, export: null, origine: null }, over);
}
/** Every button that goes somewhere and every in-app link of some HTML, as [label, target]. */
const text = (h) => h.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
function targets(html) {
  const out = [];
  for (const m of String(html).matchAll(/<button\b[^>]*\bdata-go="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)) out.push([text(m[2]), m[1].replace(/&amp;/g, "&")]);
  for (const m of String(html).matchAll(/<a\b[^>]*\bhref="(#[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) out.push([text(m[2]), m[1].replace(/&amp;/g, "&")]);
  return out;
}
const target = (html, label) => targets(html).find(([l]) => l === label)?.[1] ?? null;
/** The screen an address opens, as the router resolves it (web/views/router.js); null is « unknown address ». */
function open(hash) {
  location.hash = hash;
  const p = hash.replace(/^#\/?/, "").split("/"), route = p[0], sub = p.slice(1).join("/");
  if (route === "" || route === "decision") return screens.decision(sub);
  if (route === "acces") return screens.acces(sub);
  if (route === "declarer") return screens.declarer(sub);
  if (route === "arrivee") return screens.arrivee(sub);
  if (route === "envois") return screens.envois();
  if (route === "entree") return screens.entree(sub);
  if (route === "legal") return sub ? null : screens.legal();
  if (["flotte", "vue", "mission", "history", "proof", "signatures", "pr", "sources"].includes(route)) return screens.fleet(route, sub ? decodeURIComponent(sub) : "");
  return null;
}

test("the portfolio: each application awaited says its next step, and its button lands where that step is done", () => {
  state();
  const v = screens.decision("");
  const enc = (n) => encodeURIComponent(n);
  // its first check arrived: « Confirmer le premier contrôle », with its date, to its confirmation
  assert.match(v.html, /Premier contrôle reçu le <time datetime="[^"]+">[^<]+<\/time>, à confirmer\./);
  assert.equal(targets(v.html).filter(([l]) => l === "Confirmer le premier contrôle").map(([, t]) => t).join(), `#/declarer/confirmer/${enc("stranxik/dropyour")}`);
  // nothing sent: what the team adds, the snippet
  assert.equal(target(v.html, "Voir ce que l'équipe ajoute"), `#/declarer/attente/${enc("stranxik/next-one")}`);
  // confirmed without consent: its consent
  // confirmed without consent: the index carries it (not observed); its reading leads to its consent
  assert.ok(T.index.missions.some((m) => m.id === "radar"));
  assert.equal(target(open("#/decision/radar").html, "Donner l'accord dans Compte"), `#/acces/depot/${enc("stranxik/radar")}/accord`);
  // the list of them: the repositories' section, never the top of Accès
  assert.equal(target(v.html, "Tous les dépôts déclarés"), "#/acces/depots");
  assert.equal(targets(v.html).some(([, t]) => t === "#/acces"), false);
  // and each lands on its action
  const c = open(`#/declarer/confirmer/${enc("stranxik/dropyour")}`);
  assert.ok(c.html.includes(`data-k="confirm:${T.ids.dropyour}"`) && c.html.includes("Confirmer ce dépôt"), "the confirmation of that repository, its button");
  const w = open(`#/declarer/attente/${enc("stranxik/next-one")}`);
  assert.ok(w.html.includes('id="extrait"') && w.html.includes("mission: next-one"), "the snippet the team adds");
  const a = open(`#/acces/depot/${enc("stranxik/radar")}/accord`);
  assert.equal(a.cible, "#depot-accord button");
  assert.equal(a.focus, "#depot-accord button");
  assert.match(a.html, /<div id="depot-accord"><button class="btn" type="button" data-do="ask" data-k="consentir:[^"]+"[^>]*>Consentir au contenu<\/button>/);
  // planted control: the old portfolio's « Voir dans Accès » would be caught
  assert.equal(targets(`<button class="btn" type="button" data-go="#/acces">Voir dans Accès</button>`).some(([, t]) => t === "#/acces"), true);
});

test("the next step of a status line: confirm, owner, install, consent, wait", () => {
  const line = (m) => T.status.lines.find((l) => l.mission === m);
  assert.deepEqual([line("dropyour"), line("next-one"), line("radar"), line("runward-hosted")].map((l) => L.prochainPas(l).kind), ["confirm", "install", "consent", "wait"]);
  assert.ok(L.prochainPas(line("dropyour")).at, "the first upload is dated");
  assert.equal(L.prochainPas({ ...line("runward-hosted"), lastRefusal: "owner-changed" }).kind, "owner");
  assert.equal(L.prochainPas({ ...line("runward-hosted"), lastRefusal: "owner-changed" }).href, `#/declarer/confirmer/${encodeURIComponent("stranxik/runward-hosted")}`);
  // planted control: a pending line whose activity carries no upload is « install », never « confirm »
  assert.equal(L.prochainPas({ ...line("dropyour"), activity: [] }).kind, "install");
});

test("Accès: a repository whose first upload arrived says so, with its date, its confirmation first; one that has sent nothing says it waits", () => {
  state();
  // Compte is its sections as a list and the one chosen beside it (ADR-0037 point 3): the repositories' section
  const v = screens.acces("depots");
  const row = (id) => new RegExp(`<div class="arow" id="depot-${id}">[\\s\\S]*?(?=<div class="arow"|</section>)`).exec(v.html)?.[0] ?? "";
  const d = row(T.ids.dropyour);
  assert.ok(d.includes("premier envoi reçu") && /le <time datetime="[^"]+">[^<]+<\/time>, à confirmer/.test(d), "received, with its date, to confirm");
  assert.equal(d.includes("en attente du premier envoi"), false, "never « waiting for the first upload » once it arrived");
  assert.equal(target(d, "Confirmer le premier envoi"), `#/declarer/confirmer/${T.ids.dropyour}`);
  assert.match(d, /<div class="actions etat-geste"><button class="btn" type="button" data-go="#\/declarer\/confirmer\//, "a primary button, not a link in a line");
  const w = row(T.ids.waiting);
  assert.ok(w.includes("en attente du premier envoi") && /la déclaration expire le <time/.test(w));
  assert.equal(target(w, "Voir ce que l'équipe ajoute au dépôt"), `#/declarer/attente/${T.ids.waiting}`);
  // each name opens its repository's screen
  assert.equal(target(d, "stranxik/dropyour"), `#/acces/depot/${T.ids.dropyour}`);
  // the repository's own screen: where it stands and its next gesture first
  const s = open(`#/acces/depot/${T.ids.dropyour}`);
  assert.equal(s.title, "stranxik/dropyour");
  assert.deepEqual(s.crumb.map(([l, h]) => [l, h ?? null]), [["Compte", "#/acces"], ["Dépôts déclarés", "#/acces/depots"], ["stranxik/dropyour", null]]);
  const first = s.html.indexOf("Où en est ce dépôt");
  assert.ok(first > 0 && s.html.indexOf("Confirmer le premier envoi") > first && s.html.indexOf("Confirmer le premier envoi") < s.html.indexOf("Accord sur le contenu"));
  assert.match(s.html, /premier envoi reçu<\/span> <span class="soft">le <time datetime="[^"]+">[^<]+<\/time>, à confirmer<\/span>[\s\S]*Il attend votre confirmation/);
  // by its name too (the status lines name a repository, they do not carry its id), and a name unknown is said
  assert.equal(open(`#/acces/depot/${encodeURIComponent("STRANXIK/dropyour")}`).title, "stranxik/dropyour");
  assert.ok(open("#/acces/depot/nope").html.includes("Ce dépôt n'est pas dans votre flotte."));
  assert.equal(open("#/acces/depot/%E0%A4%A"), null, "an address that does not decode leads nowhere");
  // planted control: the row as it was (« en attente du premier envoi · confirmer le premier envoi ») is refused
  const old = `<div class="arow"><span class="st"><span class="mk mk-half" aria-hidden="true"></span>en attente du premier envoi</span> · <a href="#/declarer/confirmer/x">confirmer le premier envoi</a></div>`;
  assert.equal(old.includes("en attente du premier envoi") && !old.includes("premier envoi reçu"), true);
});

test("Compte opened on a section: the section an address names is shown beside the list and takes the focus; the list names each one", () => {
  state();
  // Compte is its sections as a list and the one chosen beside it (ADR-0037 point 3): the list names every section
  const all = screens.acces("");
  for (const [k, id] of Object.entries(L.SECTIONS_ACCES)) {
    assert.equal(target(all.html, targets(all.html).find(([, t]) => t === `#/acces/${k}`)?.[0]), `#/acces/${k}`, `${k}: in the list`);
    const v = screens.acces(k);
    assert.equal((v.html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `${id}: once, in the detail`);
    assert.equal(v.focus, `#${id}`);
    assert.equal(v.ecran, "detail", "a phone shows the section, with its way back");
    assert.match(v.html, new RegExp(`id="${id}" tabindex="-1" aria-label`), `${id}: it can take the focus, and is named`);
    assert.match(v.html, new RegExp(`<a class="row crow" href="#/acces/${k}"[^>]*aria-current="true"`), `${k}: its row is the current one`);
  }
  assert.equal(screens.acces("nowhere"), null, "a section that does not exist leads nowhere");
  assert.equal(all.cible, null, "the bare address opens at the top");
  assert.equal(all.ecran, "liste", "a phone opens the list");
  assert.match(all.html, /<a class="row crow choisie" href="#\/acces\/cles"/, "a desk shows the first section beside the list, without saying it is current");
});

test("every link and button of every screen painted leads to a screen that exists; the bare top of Accès is the sidebar's « Accès » only", () => {
  const painted = [];
  const paint = (name, f) => { state(); const v = f(); assert.ok(v, `${name}: a screen`); painted.push([name, v.html]); };
  paint("portfolio", () => open("#/"));
  for (const m of T.index.missions) paint(`decision ${m.id}`, () => open(`#/decision/${m.id}`));
  for (const m of T.index.missions) paint(`mission ${m.id}`, () => open(`#/mission/${m.id}`));
  paint("flotte", () => open("#/flotte"));
  paint("acces", () => open("#/acces"));
  for (const k of Object.keys(L.SECTIONS_ACCES)) paint(`acces ${k}`, () => open(`#/acces/${k}`));
  for (const r of T.access.repositories) { paint(`depot ${r.name}`, () => open(`#/acces/depot/${r.id}`)); paint(`depot ${r.name} accord`, () => open(`#/acces/depot/${r.id}/accord`)); }
  for (const sub of ["ajout", "export", "effacer"]) paint(`acces ${sub}`, () => open(`#/acces/${sub}`));
  paint("declarer", () => open("#/declarer"));
  for (const r of T.access.repositories) for (const w of ["attente", "confirmer", "modifier"]) paint(`declarer ${w} ${r.name}`, () => open(`#/declarer/${w}/${r.id}`));
  paint("arrivee", () => { S.session = { ...T.session, arrivalDone: false, arrivalOpen: true }; return open("#/arrivee"); });
  // the frame: the sidebar and the banners (a passkey added elsewhere, a single passkey)
  state(); S.session = { ...T.session, passkeys: 1, addedElsewhere: [{ id: "p", createdAt: "2026-11-10T09:00:00.000Z" }] };
  const f = frame(true, "decision", "", {});
  painted.push(["frame", `${f.lat}${f.bandeaux}`]);
  assert.equal(target(f.bandeaux, "Voir mes passkeys"), "#/acces/cles", "a passkey added elsewhere: the passkeys");
  const bare = [];
  for (const [name, html] of painted) {
    for (const [label, to] of targets(html)) {
      state();
      if (to === "#/acces") { bare.push(`${name}: ${label}`); continue; }
      const v = open(to);
      assert.ok(v, `${name}: « ${label} » leads to ${to}, a screen that exists`);
    }
  }
  // the sidebar's entry « Compte » (the screen once called Accès, ADR-0034), and the trail's first step on a repository's screen
  assert.deepEqual([...new Set(bare)].sort(), ["frame: Compte"]);
});

test("no source sends to the bare top of Accès: no go(), data-go or location write names #/acces alone", () => {
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } };
  walk(join(WEB, "views"));
  files.push(join(WEB, "app.js"));
  const BARE = /\bgo\(\s*"#\/acces"|data-go="#\/acces"|location\.(?:hash\s*=|replace\()\s*"#\/acces"/;
  assert.deepEqual(files.filter((p) => BARE.test(readFileSync(p, "utf8"))).map((p) => p.slice(WEB.length)), []);
  // planted controls: each way of writing it is seen
  for (const planted of ['go("#/acces", C.backToAccess)', '<button data-go="#/acces">', 'location.hash = "#/acces";', 'location.replace("#/acces")']) assert.equal(BARE.test(planted), true, planted);
});

test("a task sends back where it was opened from, never to the top of Accès", () => {
  // the origin: noted on entering a task, kept between tasks, forgotten on leaving them
  let o = L.origineApres(null, "#/", "#/declarer/confirmer/x");
  assert.equal(o, "#/");
  o = L.origineApres(o, "#/declarer", "#/declarer/attente/x");
  assert.equal(o, "#/", "declare, then its waiting screen: the same origin");
  assert.equal(L.origineApres(o, "#/declarer/attente/x", "#/decision"), null);
  assert.equal(L.origineApres(null, "#/entree/connexion", "#/acces/ajout"), null, "a sign-in is not an origin");
  // where it sends back
  assert.equal(L.retour("#/acces/cles", "#/decision/runward-hosted"), "#/decision/runward-hosted");
  assert.equal(L.retour("#/acces/cles", "#/acces"), "#/acces/cles", "from the top of Accès: the task's own place");
  assert.equal(L.retour("#/acces/cles", null), "#/acces/cles");
  assert.equal(L.retour("#/", "#/declarer"), "#/", "never to another task");
  assert.equal(L.hashOf("https://app.runward.dev/"), "#/");
  assert.equal(L.hashOf("https://app.runward.dev/#/acces/depot/x"), "#/acces/depot/x");
  // on the screens: add a passkey, export, erase, modify, declare, the waiting screen
  state();
  assert.equal(target(open("#/acces/ajout").html, "Revenir aux passkeys"), "#/acces/cles");
  assert.equal(target(open("#/acces/export").html, "Revenir à vos données"), "#/acces/donnees");
  assert.equal(target(open("#/acces/effacer").html, "Revenir à vos données"), "#/acces/donnees");
  assert.equal(target(open(`#/declarer/modifier/${T.ids.dropyour}`).html, "Annuler"), `#/acces/depot/${T.ids.dropyour}`);
  assert.equal(target(open("#/declarer").html, "Annuler"), "#/acces/depots");
  // the connect flow (ADR-0037): its list is its way between repositories; the waiting one is current in it
  assert.match(open(`#/declarer/attente/${T.ids.waiting}`).html, new RegExp(`<a class="row frow" href="#/declarer/attente/${T.ids.waiting}"[^>]*aria-current="true"`));
  state({ origine: "#/" });
  assert.equal(target(open("#/acces/ajout").html, "Revenir aux applications"), "#/", "opened from the portfolio's banner: back there");
  state({ origine: "#/decision/runward-hosted" });
  assert.equal(target(open("#/acces/export").html, "Revenir à l'application"), "#/decision/runward-hosted");
  state({ origine: "#/acces" });
  assert.equal(target(open(`#/declarer/modifier/${T.ids.dropyour}`).html, "Annuler"), `#/acces/depot/${T.ids.dropyour}`, "opened from the top of Accès: its repository");
  // the gestures' own returns, in the sources (they run in a browser): each names its place
  const src = (f) => readFileSync(join(WEB, "views", f), "utf8");
  assert.match(src("events.js"), /location\.hash = retour\(versDepot\(id\)\)/, "a modification saved: its repository");
  assert.match(src("events.js"), /location\.hash = S\.session\.arrivalDone \? retour\("#\/"\) : "#\/arrivee"/, "a new owner confirmed, or nothing published");
  assert.match(src("events.js"), /if \(S\.session\.arrivalDone && mission && done\.published && !done\.quarantine\) \{ etat\(\)\.premier = mission; S\.fluxVue = null; const to = `#\/declarer\/confirmer\/\$\{encodeURIComponent\(repo\.id\)\}`;/, "a first check confirmed and published: the flow's fifth gesture, its first verdict (ADR-0037)");
  assert.match(src("gestures.js"), /location\.hash = retour\(versSection\("cles"\)\)/, "a passkey added: the passkeys");
  // planted control: an origin that is the top of Accès is never a way back
  assert.notEqual(L.retour("#/acces/donnees", "#/acces"), "#/acces");
});

test("in English, the new words are English", () => {
  state({ lang: "en" });
  const v = screens.decision("");
  assert.match(v.html, /First check received on <time/);
  assert.ok(v.html.includes(">Confirm the first check<") && v.html.includes(">See what the team adds<") && v.html.includes(">All declared repositories<"));
  assert.ok(screens.decision("radar").html.includes(">Give consent in Account<"));
  const a = screens.acces("depots");
  assert.ok(a.html.includes("first upload received") && a.html.includes("to be confirmed") && a.html.includes(">Declared repositories<"));
  const d = open(`#/acces/depot/${T.ids.waiting}`);
  assert.ok(d.html.includes("Where this repository stands") && d.html.includes("No upload has arrived yet."));
});
