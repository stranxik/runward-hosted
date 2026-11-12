// Lot 2 of the fixed shell (ADR-0037): the connect flow in five gestures, the journal as list and detail with its
// filters in the address, Compte as sections and detail. The modules are run as the app serves them, over a tenant
// built by the real application, and the router is run for real: its reads go to the application through a fetch that
// answers as the API does (the same views the routes return), so a check planted after a first read is seen by the
// next screen of the flow without a reload (the defect seen in production on 2026-11-12: a tab open since the
// declaration said « Il n'y a rien à confirmer » until the page was reloaded).
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

// ---- the browser the modules expect: enough of a page for the router to paint a screen into it
const kept = new Map();
const el = () => {
  const e = { innerHTML: "", className: "", hidden: false, inert: false, dataset: {}, textContent: "", style: { setProperty() {} }, attrs: {} };
  e.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  Object.assign(e, { setAttribute: (k, v) => { e.attrs[k] = v; }, getAttribute: (k) => e.attrs[k] ?? null, focus() {}, querySelector: () => null, querySelectorAll: () => [], contains: () => false, addEventListener() {}, getClientRects: () => [] });
  return e;
};
const els = new Map();
globalThis.window = globalThis;
globalThis.document = {
  getElementById: (id) => { if (!els.has(id)) els.set(id, el()); return els.get(id); },
  querySelector: () => null, querySelectorAll: () => [], title: "", documentElement: { lang: "fr" }, body: el(), activeElement: null,
  createTreeWalker: () => ({ nextNode: () => false }),
};
globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
globalThis.location = { host: "app.runward.dev", hash: "#/", replace(h) { this.hash = h; } };
globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
globalThis.CSS = { escape: (s) => String(s) };
globalThis.NodeFilter = { SHOW_TEXT: 4 };

// ---- the modules as served
const served = mkdtempSync(join(tmpdir(), "rw-parcours-"));
after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) {
  const p = join(served, f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href)));
}
const mod = (f) => import(pathToFileURL(join(served, `views/${f}.js`)).href);

// ---- a tenant built by the real application: one application published, two declared and awaited
const h = harness();
const f = await founder(h);
const s0 = () => h.app.identity.sessionFrom(f.token);
const declare = async (name, mission) => {
  await gesture(h, await s0(), "declare-with-consent", name.toLowerCase());
  return h.app.repositories.declare(await s0(), { name, consent: true, missions: [{ id: mission, path: "." }] }, {});
};
const hosted = await declare("stranxik/runward-hosted", "runward-hosted");
await send(h, { repository: "stranxik/runward-hosted", repository_id: "7002", run_id: "42830000011", run_number: "11" }, { mission: "runward-hosted", bytes: FIXTURE("hosted-proposed") });
await confirmRepository(h, f, hosted.id);
const dropyour = await declare("stranxik/dropyour", "dropyour");
const radar = await declare("stranxik/radar", "radar");

// the API, answered by the application as its routes answer it
const json = (x) => JSON.parse(JSON.stringify(x));
const reads = [];
globalThis.fetch = async (path, init = {}) => {
  const u = new URL(path, "https://app.runward.dev"), s = await s0();
  reads.push(`${init.method ?? "GET"} ${u.pathname}`);
  const ok = (body) => new Response(JSON.stringify(json(body)), { status: 200, headers: { "content-type": "application/json" } });
  if (u.pathname === "/api/v0/session") return ok({ ...(await h.app.identity.sessionView(s)), sendWorkflow: [SEND_SHA] });
  if (u.pathname === "/api/v0/access") return ok(await h.app.identity.accessView(s));
  if (u.pathname === "/api/v0/fleet/status") return ok(await h.app.reading.status(s));
  if (u.pathname === "/api/v0/journal") return ok(await journalRoutes(h.app)[0][3]({ session: s, url: u, lang: "fr" }));
  if (u.pathname === `/f/${s.tenantId}/index.json`) { const i = await h.app.reading.index(s.tenantId); return i ? new Response(i.bytes, { status: 200 }) : new Response("{}", { status: 404 }); }
  return new Response(JSON.stringify({ refusal: "not-found" }), { status: 404 });
};

const { S, main } = await mod("base");
const { show, rerender } = await mod("router");
const flux = await mod("flux");
const vif = await mod("flux-vif");
const JF = await mod("journal-filtres");
const { viewEnvois } = await mod("envois");
const { viewAcces, SECTIONS } = await mod("acces");
const { viewDeclarer } = await mod("declarer");
kept.set("rw-accueil-lang", "fr");
const go = async (hash) => { location.hash = hash; await show(); return main.innerHTML; };

test("a first check planted after the first read is seen by the next screen of the flow, without a reload", async () => {
  // the waiting screen, read once: nothing has arrived
  let html = await go(`#/declarer/attente/${dropyour.id}`);
  assert.ok(html.includes("Ajoutez l'étape runward à la chaîne de dropyour."), "step 2: the step to add");
  assert.ok(html.includes('id="extrait"') && html.includes("mission: dropyour"), "the extract, with its mission");
  // the CI sends: the first check arrives, kept to confirm
  const first = await send(h, { repository: "stranxik/dropyour", repository_id: "7005", run_id: "42830000041", run_number: "7" }, { mission: "dropyour" });
  assert.equal(first.status, 202);
  // planted control: painting again from what was read shows the old state (the defect, as it was)
  rerender();
  assert.ok(main.innerHTML.includes("Ajoutez l'étape runward") && !main.innerHTML.includes("est arrivé"), "the control: no read, no news");
  // entering the confirmation reads again: the first upload is there, its pins shown before the gesture
  reads.length = 0;
  html = await go(`#/declarer/confirmer/${dropyour.id}`);
  assert.ok(reads.includes("GET /api/v0/access") && reads.includes("GET /api/v0/fleet/status"), "the flow's reads, made again at its entry");
  assert.ok(html.includes("Le premier envoi de stranxik/dropyour est arrivé."), "step 4, without a reload");
  assert.ok(html.includes(`data-k="confirm:${dropyour.id}"`) && html.includes("Ce que la confirmation épingle"), "its gesture, the values it pins");
  assert.equal(html.includes("Il n'y a rien à confirmer"), false);
  // the same address entered again reads again too
  reads.length = 0;
  await show();
  assert.ok(reads.includes("GET /api/v0/access"), "a second entry on the same address reads again");
});

test("the waiting screen moves to the confirmation by itself when the live re-read sees the first upload", async () => {
  await go(`#/declarer/attente/${radar.id}`);
  assert.equal(await vif.verifier(), "same", "nothing new: nothing painted, no move");
  await send(h, { repository: "stranxik/radar", repository_id: "7006", run_id: "42830000051", run_number: "3" }, { mission: "radar" });
  assert.equal(await vif.verifier(), "moved");
  assert.equal(location.hash, `#/declarer/confirmer/${encodeURIComponent(radar.id)}`);
  assert.equal(vif.suite(`#/declarer/attente/${radar.id}`, S.access), `#/declarer/confirmer/${encodeURIComponent(radar.id)}`);
  assert.equal(vif.suite(`#/declarer/confirmer/${radar.id}`, S.access), null, "only the waiting screen moves on");
  // away from the flow, the live re-read of the flow reads nothing
  location.hash = "#/envois";
  assert.equal(await vif.verifier(), "skipped");
});

test("the five gestures: where a repository stands, read from the service; « c'est fait » only moves the screen", async () => {
  location.hash = "#/declarer"; await show();
  const a = S.access, lines = S.status.lines;
  const by = (id) => a.repositories.find((r) => r.id === id);
  assert.deepEqual(flux.etape(null), { step: 1, variant: null, refusal: null, mission: null });
  assert.equal(flux.etape(by(hosted.id), lines).step, 5);
  assert.equal(flux.etape(by(dropyour.id), lines).step, 4);
  // a repository that has sent nothing: step 2; the marker moves it to 3, and nothing else
  const n = await declare("stranxik/next-one", "next-one");
  await show();
  const r = S.access.repositories.find((x) => x.id === n.id);
  assert.equal(flux.etape(r, S.status.lines).step, 2);
  assert.equal(flux.etape(r, S.status.lines, { merged: true }).step, 3);
  const before = reads.length;
  flux.marquerFusionne(n.id);
  assert.equal(reads.length, before, "the marker is never sent to the service");
  assert.ok(flux.fusionne(n.id));
  assert.ok(viewDeclarer(`attente/${n.id}`).html.includes("Livrez : le premier envoi arrive ici."), "step 3: the waiting");
  flux.marquerFusionne(n.id, false);
  // an upload refused: step 3, its variant, its words, a link to its entry in the journal filtered
  await send(h, { repository: "stranxik/next-one", repository_id: "7007", run_id: "42830000061", run_number: "1", workflow_ref: "stranxik/next-one/.github/workflows/other.yml@refs/heads/main" }, { mission: "next-one" });
  await show();
  const e = flux.etape(S.access.repositories.find((x) => x.id === n.id), S.status.lines);
  assert.deepEqual([e.step, e.variant, e.refusal.code], [3, "refused", "workflow-not-pinned"]);
  const v = viewDeclarer(`attente/${n.id}`);
  assert.ok(v.html.includes("n'a pas été accepté : workflow appelant non déclaré"));
  assert.ok(v.html.includes("#/envois?app=next-one&amp;quoi=envois-refuses&amp;entree="), "the entry, in the journal filtered for it");
  // expired: 7 days without an upload received
  // (the shape the access view gives a declaration the daily pass removed: src/application/operator.js#retention)
  const ex = { ...r, state: "removed", pendingSend: null, expiresAt: "2026-11-01T10:00:00.000Z", removedAt: "2026-11-01T10:00:01.000Z" };
  assert.equal(flux.etape(ex, []).variant, "expired");
  assert.equal(flux.etape({ ...ex, removedAt: "2026-10-30T10:00:00.000Z" }, []).variant, "removed", "removed by the member before it expired");
  // the owner changed, a GitLab definition to confirm again: step 4 with its variant
  assert.equal(flux.etape({ ...by(hosted.id), pendingSend: { reason: "owner-changed", claims: {} } }, lines).variant, "owner");
  assert.equal(flux.etape({ ...by(hosted.id), pendingSend: { reason: "definition-not-pinned", claims: {} } }, lines).variant, "definition");
  // the addresses the app always had
  assert.equal(flux.adresse(by(dropyour.id), { step: 4 }), `#/declarer/confirmer/${dropyour.id}`);
  assert.equal(flux.adresse(r, { step: 2 }), `#/declarer/attente/${n.id}`);
});

test("step 1: a short form; the consent is never ticked for the member; mission, path, branch and workflow folded with their defaults", () => {
  S.formError = null; S.formValues = null;
  const v = viewDeclarer("");
  assert.match(v.html, /<input type="checkbox" name="content">/, "the consent box, unticked");
  assert.match(v.html, /<details class="pli" data-pli="plus"><summary[^>]*>Mission, chemin, branche et workflow<\/summary>/, "folded, closed");
  for (const [name, value] of [["path", "."], ["branch", "main"], ["wf", ".github/workflows/runward.yml"]]) assert.match(v.html, new RegExp(`name="${name}" value="${value.replace(/[.]/g, "\\.")}"`), name);
  assert.equal(viewDeclarer("nouveau").ecran, "detail", "a phone opens the form at #/declarer/nouveau");
  // the fold opens on a field the service refused, which takes the focus
  S.formError = { field: "mission", message: "Cette mission existe déjà dans cette flotte.", action: "Choisir un autre identifiant." };
  const e = viewDeclarer("");
  assert.match(e.html, /<details class="pli" data-pli="plus" open>/);
  assert.equal(e.focus, "#e-mission");
  S.formError = null;
  // the default mission is the one the service writes from the name
  const D = viewDeclarer("");
  assert.ok(D.html.includes("la mission porte le nom du dépôt"));
});

test("step 5: the first verdict, with the way to its application; a gesture done is read again", async () => {
  location.hash = `#/declarer/confirmer/${hosted.id}`; await show();
  const html = main.innerHTML;
  assert.ok(html.includes("Premier verdict de runward-hosted."));
  assert.ok(html.includes('href="#/decision/runward-hosted" data-flux-premier="runward-hosted"'), "its application, whose reading says it is the first");
  S.fluxVue = { id: hosted.id, n: 1 };
  assert.ok(viewDeclarer(`confirmer/${hosted.id}`).html.includes("stranxik/runward-hosted"), "what was declared, read again");
  S.fluxVue = null;
});

test("the journal's filters: the address keeps them, a link round-trips, each maps to the service's", () => {
  const f = { app: "dropyour", quoi: "envois-refuses", periode: "7j", entree: 12 };
  assert.deepEqual(JF.lireFiltres(JF.ecrireFiltres(f)), f);
  assert.equal(JF.versJournal(f), "#/envois?app=dropyour&quoi=envois-refuses&periode=7j&entree=12");
  assert.equal(JF.versJournal(f, "40"), "#/envois/40?app=dropyour&quoi=envois-refuses&periode=7j&entree=12");
  assert.equal(JF.versJournal({}), "#/envois");
  assert.equal(JF.journalApiQuery("app=dropyour&quoi=envois-refuses&periode=7j&entree=12"), "mission=dropyour&kind=sends-refused&days=7");
  for (const [w, k] of Object.entries(JF.QUOI)) assert.equal(JF.journalApiQuery(`quoi=${w}`), `kind=${k}`);
  for (const [w, d] of Object.entries(JF.PERIODES)) assert.equal(JF.journalApiQuery(`periode=${w}`), `days=${d}`);
  // the entry shown is not a read; a change of filter is
  assert.equal(JF.journalKey("quoi=connexions&entree=4"), JF.journalKey("quoi=connexions"));
  assert.notEqual(JF.journalKey("quoi=connexions"), JF.journalKey("quoi=compte"));
  // a value this page does not know is left out, so a link never asks a filter the service refuses
  assert.deepEqual(JF.lireFiltres("app=Not_A_Mission&quoi=tout&periode=2j&entree=-1"), { app: null, quoi: null, periode: null, entree: null });
  assert.equal(JF.ecrireFiltres({ app: "", quoi: null }), "");
});

test("the journal as list and detail: the filters read from the address, the entry shown, the empty and no-result states", async () => {
  // the address with filters: the service is asked them, the bar shows them chosen
  reads.length = 0;
  let html = await go("#/envois?quoi=confirmations");
  assert.ok(reads.includes("GET /api/v0/journal"), "read");
  assert.match(html, /<option value="confirmations" selected>Confirmations<\/option>/);
  assert.ok(S.journal.filter && S.journal.entries.every((e) => e.body.what === "repository-confirmed") && S.journal.entries.length >= 1);
  assert.ok(html.includes("Retirer les filtres"));
  // an entry shown: its detail; on a phone the detail with its way back
  const seq = S.journal.entries[0].seq;
  location.hash = `#/envois?quoi=confirmations&entree=${seq}`;
  reads.length = 0; await show();
  assert.equal(reads.includes("GET /api/v0/journal"), false, "showing an entry is not a read");
  const v = viewEnvois("", `quoi=confirmations&entree=${seq}`);
  assert.equal(v.ecran, "detail");
  assert.ok(v.html.includes(`Entrée n° ${seq} · dépôt confirmé`));
  assert.match(v.html, new RegExp(`<a class="row jrow" href="#/envois\\?quoi=confirmations&amp;entree=${seq}"[^>]*aria-current="true"`));
  // an entry the page does not hold
  assert.ok(viewEnvois("", "quoi=confirmations&entree=1").html.includes("Cette entrée n'est pas dans la page affichée."));
  // filters that keep nothing: said, with the way to clear them
  await go("#/envois?app=radar&quoi=confirmations");
  assert.ok(main.innerHTML.includes("Aucune entrée pour ces filtres.") && main.innerHTML.includes('href="#/envois"'));
  // a journal with nothing at all
  S.journal = { head: null, entries: [], next: null, end: true, note: "" };
  assert.ok(viewEnvois("", "").html.includes("Aucun envoi reçu pour l'instant."));
  // an unknown cursor is no screen
  assert.equal(viewEnvois("abc", ""), null);
});

test("Compte: its sections as a list, each with what it holds now; the one chosen beside it; the tasks open beside the list", async () => {
  await go("#/acces");
  const a = S.access;
  const v = viewAcces("");
  assert.deepEqual(SECTIONS.map(([k]) => k), ["cles", "sessions", "depots", "instances", "reglages", "membres", "donnees", "limites"]);
  for (const [k] of SECTIONS) assert.ok(v.html.includes(`href="#/acces/${k}"`), k);
  const live = a.repositories.filter((r) => r.state !== "removed");
  assert.ok(v.html.includes(`${live.length} dépôts déclarés : ${live.filter((r) => r.state === "pinned").length} confirmé`), "the repositories, counted whole");
  assert.ok(v.html.includes("2 passkeys"));
  for (const sub of ["ajout", "export", "effacer", "instance", `depot/${dropyour.id}`]) {
    const t = viewAcces(sub);
    assert.equal(t.ecran, "detail", sub);
    assert.ok(t.html.includes('class="d-body compte-tache"') && t.html.includes('href="#/acces/cles"'), `${sub}: beside the list`);
  }
  assert.match(viewAcces("export").html, /<a class="row crow" href="#\/acces\/donnees"[^>]*aria-current="true"/, "the export belongs to « Récupérer vos données »");
  // the gestures are those of before: the same confirmation boxes and keys
  assert.ok(viewAcces("cles").html.includes('data-do="ask" data-k="passkey:'));
  assert.ok(viewAcces("depots").html.includes(`data-k="consent:${dropyour.id}"`));
});

test("the arrival counts every repository declared, the ones awaiting their first check too", async () => {
  location.hash = "#/arrivee"; await show();
  const n = S.access.repositories.filter((r) => r.state !== "removed").length;
  assert.ok(n >= 3);
  assert.ok(main.innerHTML.includes(`${n} dépôts déclarés`), `« ${n} dépôts déclarés »`);
  // planted control: the count of before (the confirmed ones only) is not what is said
  const pinned = S.access.repositories.filter((r) => r.state === "pinned").length;
  assert.notEqual(pinned, n);
  assert.equal(main.innerHTML.includes(`${pinned} dépôt déclaré<`) || main.innerHTML.includes(`· ${pinned} dépôt déclaré`), false);
});
