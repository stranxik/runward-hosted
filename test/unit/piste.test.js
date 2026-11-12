// « La piste » (ADR-0035): the portfolio drawn as rails and an application's reading, held on the real exports of
// test/fixtures/decision/ (runward's own, see decision.test.js) assembled by the real application into a tenant's real
// index and status. What is held: every value the rails show is derived from the index or the status, and from nothing
// else (the step of each refusal, the count of requirements per step only when every row is listed and placed, where
// the line stops); every refusal of the index is in exactly one block of « Ce qui bloque », with its file and line;
// « Ce qui s'est passé » says only what the check and the service recorded; what moved is computed between two checks
// the page held, and never otherwise; the words are closed, the same keys in French and English, none of the words
// runward never says. Each guard has its planted control.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULES } from "../../src/http/assets.js";
import { harness, founder, gesture, send, confirmRepository } from "../helpers.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const VIEWS = new URL("../../node_modules/runward-fleet/ui/views.js", import.meta.url);
const FIXTURE = (name) => readFileSync(new URL(`../fixtures/decision/${name}.check.json`, import.meta.url));

const kept = new Map();
globalThis.window = globalThis;
globalThis.document ??= { querySelector: () => null, getElementById: () => ({}) };
globalThis.localStorage ??= { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };

const served = mkdtempSync(join(tmpdir(), "rw-piste-"));
after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) {
  const p = join(served, f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href)));
}
const mod = (f) => import(pathToFileURL(join(served, f)).href);
const D = await mod("views/decision.js");
const Dn = await mod("views/piste/donnees.js");
const M = await mod("views/piste/mots.js");
const { S } = await mod("views/base.js");

// ---- a tenant's real index and status: the five exports, each its own application
async function five() {
  const h = harness();
  const f = await founder(h);
  let n = 7300;
  for (const name of ["demo-repaired", "agent-ratified", "level-not-met", "hosted-proposed", "demo-renamed"]) {
    n++;
    await gesture(h, f.session, "declare-with-consent", `stranxik/${name}`);
    const s = await h.app.identity.sessionFrom(f.token);
    const d = await h.app.repositories.declare(s, { name: `stranxik/${name}`, consent: true, missions: [{ id: name, path: "." }] }, {});
    await send(h, { repository: `stranxik/${name}`, repository_id: String(n), run_id: `4283${n}`, run_number: "11", sha: "97fce96d901d0d07cad8a230950d391b223736af" }, { mission: name, bytes: FIXTURE(name) });
    await confirmRepository(h, f, d.id);
  }
  const s = await h.app.identity.sessionFrom(f.token);
  return { s, index: JSON.parse((await h.app.reading.index(s.tenantId)).bytes.toString("utf8")), status: JSON.parse(JSON.stringify(await h.app.reading.status(s))) };
}
const F = await five();
const mission = (id, index = F.index) => index.missions.find((m) => m.id === id);
const paint = (sub, { index = F.index, status = F.status, lang = "fr" } = {}) => {
  kept.set("rw-accueil-lang", lang);
  S.index = index; S.status = status; S.fleetError = null; S.session = F.s; S.piste = undefined;
  return D.viewDecision(sub);
};
const conformance = (name) => JSON.parse(FIXTURE(name).toString("utf8")).conformance ?? [];

test("the stations come from the index: where the check refuses, where nothing is required, and where the line stops", () => {
  const shape = (id) => Dn.stations(mission(id)).stations.map((x) => x.state).join(" ");
  assert.equal(shape("demo-renamed"), "ok ok refus vide refus ok", "the two refused pieces of evidence, at Plancher and Gouverner (their phaseId)");
  assert.equal(Dn.stations(mission("demo-renamed")).stop, 3);
  assert.equal(Dn.stations(mission("demo-renamed")).reach, 0.4, "the line is solid from Cadrer to Plancher");
  assert.equal(shape("hosted-proposed"), "ok refus refus vide refus refus");
  assert.equal(Dn.stations(mission("hosted-proposed")).stop, 2);
  for (const id of ["demo-repaired", "agent-ratified", "level-not-met"]) { assert.equal(shape(id), "ok ok ok vide ok ok", id); assert.equal(Dn.stations(mission(id)).reach, 1, id); }
  // a mission with no check: dotted from end to end, nothing drawn
  const none = Dn.stations({ id: "x", latest: "not-observed" });
  assert.equal(none.stations.every((x) => x.state === "attente") && none.reach === 0 && none.stop === null, true);
  // the step of a refusal whose phaseId is not one of the six: the step of the document its file is
  const L = mission("hosted-proposed").latest;
  const topo = L.conformance.find((c) => c.phaseId === "topology");
  assert.ok(topo, "the fixture carries a refusal of the execution topology");
  assert.equal(Dn.stepOfRefusal(L, topo), "architect", "runward/execution-topology.md is a document of Architecturer");
  assert.equal(Dn.stepOfRefusal(L, { phaseId: "elsewhere", file: "notes/other.md" }), null, "the control: neither its step nor a document of a step, none");
  // the gate as runward writes it
  assert.deepEqual(Dn.gateSteps("deliverables filled, gate red at Floor, Govern"), ["floor", "govern"]);
  assert.deepEqual(Dn.gateSteps("6 · Hand over"), ["handover"]);
  assert.deepEqual(Dn.gateSteps("all gates passed"), []);
});

test("the requirements per step are shown only when every row of the record is listed and placed: never a guess", () => {
  assert.deepEqual(Dn.rowsByStep(mission("demo-renamed").latest), { total: 36, by: { frame: 0, architect: 10, floor: 10, iterate: 0, govern: 12, handover: 4 } });
  assert.equal(Dn.rowsByStep(mission("agent-ratified").latest).total, 46);
  assert.equal(Dn.rowsByStep(mission("hosted-proposed").latest), null, "its export lists no row: no count");
  // planted controls: a row missing from the lists, a row whose document is no document of a step
  const L = JSON.parse(JSON.stringify(mission("demo-renamed").latest));
  L.ratification.byState.find((g) => g.list.length).list.pop();
  assert.equal(Dn.rowsByStep(L), null, "35 rows listed for 36: no count");
  const L2 = JSON.parse(JSON.stringify(mission("demo-renamed").latest));
  const g = L2.ratification.byState.find((x) => x.list.length);
  g.list[0] = "somewhere.md · a-rule";
  assert.equal(Dn.rowsByStep(L2), null, "a row of an unknown document: no count");
  // on the screen: the counts where known, none where not
  assert.match(paint("demo-renamed").html, /<span class="pi-sub">5 pièces, 10 exigences<\/span>/);
  assert.equal(/exigences?<\/span>/.test(paint("hosted-proposed").html.split('id="pi-pan"')[0]), false, "no count of requirements on a rail that cannot derive it");
});

test("« Ce qui bloque »: every refusal of the index in exactly one block, with its file and its line, by step", () => {
  for (const id of ["demo-renamed", "hosted-proposed", "demo-repaired"]) {
    const groups = Dn.blockGroups(Dn.stations(mission(id)));
    const places = groups.flatMap((g) => g.places.map((p) => p.i)).sort((a, b) => a - b);
    assert.deepEqual(places, conformance(id).map((_, i) => i), `${id}: each refusal once`);
  }
  const html = paint("demo-renamed").html;
  assert.ok(html.includes("<code translate=\"no\">runward/floor.md, ligne 22</code>") && html.includes("<code translate=\"no\">runward/governance/threat-model.md, ligne 50</code>"));
  assert.ok(html.includes("2 lignes bloquent la livraison."));
  // the cited name no longer found: the pointer and the name as runward writes them, the name struck
  assert.deepEqual(Dn.renamed(conformance("demo-renamed")[0].problem), { pointer: "code/src/core/domain/guard.ts#guardFields", symbol: "guardFields" });
  assert.match(html, /<span class="d-k">cite<\/span><code translate="no">code\/src\/core\/domain\/guard\.ts#<del>guardFields<\/del><\/code>/);
  assert.equal(html.includes("applyFieldGuards"), false, "the new name is not in the check: it is never shown");
  // the 46 refusals of the hosted export: 47 lines with its missing document, every place listed
  const hosted = paint("hosted-proposed").html;
  assert.ok(hosted.includes("47 lignes bloquent la livraison."));
  assert.equal((hosted.split('id="pi-pan-1"')[0].match(/, ligne \d+<\/code>|, sans ligne<\/code>/g) ?? []).length, 46);
  assert.ok(hosted.includes("Note de passation : pièce manquante"), "the missing document, in runward-fleet's words");
  // a clean application: nothing blocks, said
  assert.ok(paint("demo-repaired").html.includes("Rien ne bloque la livraison selon les exigences de l&#39;équipe."));
});

test("one sentence per row, and the sentence that says the whole portfolio", () => {
  const html = paint("").html;
  assert.ok(html.includes("5 applications : 2 refusées par le contrôle, 1 sous le niveau de preuve exigé, 2 où rien ne bloque."));
  const row = (id) => new RegExp(`<li class="pi-rg[^"]*" data-mission="${id}">[\\s\\S]*?<div class="pi-dit"><p>([^]*?)</p>`).exec(html)?.[1];
  assert.equal(row("demo-renamed"), "Arrêtée à l&#39;étape 3, Plancher. 2 preuves citent un nom que le contrôle ne trouve plus dans le code.");
  assert.equal(row("hosted-proposed"), "Arrêtée à l&#39;étape 2, Architecturer. 42 points proposés ne sont pas encore validés. Et 4 autres refus.");
  assert.equal(row("demo-repaired"), "Les six étapes passent. 36 exigences de l&#39;équipe, aucune refusée.");
  assert.equal(row("level-not-met"), "Rien ne manque, mais la preuve n&#39;atteint pas le niveau exigé par l&#39;équipe.");
  // the rows in the reading's order: refused first, then the level, then the others
  assert.deepEqual([...html.matchAll(/<li class="pi-rg[^"]*" data-mission="([^"]+)"/g)].map((m) => m[1]), ["demo-renamed", "hosted-proposed", "level-not-met", "agent-ratified", "demo-repaired"]);
  // the refused mark is the app's refused token only: the rail's stations carry a class, the layer draws it in --refus
  const css = readFileSync(join(WEB, "app.css"), "utf8");
  assert.match(css, /\.pi-mk-refus\{[^}]*background:var\(--refus\)/);
  const piste = css.slice(css.indexOf("6 bis. « LA PISTE »"), css.indexOf("7. THE DECISION READING")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[\s\S]*?\*\//, "");
  assert.equal(/var\(--(direct|or|hit)\)|#[0-9a-f]{3,8}\b|\bgreen\b/i.test(piste), false, "no new accent: no blue, no gold, no literal colour in the rails' section");
  // in English, English
  const en = paint("", { lang: "en" }).html;
  assert.ok(en.includes("5 applications: 2 refused by the check, 1 below the required level of evidence, 2 with nothing blocking."));
  assert.ok(en.includes("Stopped at step 3, Floor. 2 pieces of evidence cite a name the check no longer finds in the code."));
});

test("« Ce qui s'est passé » says only what the check and the service recorded", () => {
  const html = paint("demo-renamed").html;
  const told = /<section class="scr verre pi-fen pi-recit-f"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  const items = [...told.matchAll(/<li><span class="pi-mk[^"]*" aria-hidden="true"><\/span><p>([\s\S]*?)<\/p><\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&#39;/g, "'"));
  assert.equal(items.length, 4);
  assert.match(items[0], /^Livraison contrôlée le 2026-11-06 13:00 \+01:00, commit 97fce96, exécution n° 11 de la chaîne \.github\/workflows\/runward\.yml\.$/);
  assert.equal(items[1], "Le contrôle de runward 0.46.0 a lu 13 pièces remplies sur 13 exigées, et 36 exigences de l'équipe.");
  assert.equal(items[2], "Il refuse 2 lignes, à l'étape 3, Plancher et l'étape 5, Gouverner.");
  assert.match(items[3], /^Premier contrôle confirmé le 2026-11-06 13:00 \+01:00/);
  // nothing the index does not carry: no agent, no tests, no renamed function's new name
  assert.equal(/agent|tests? (restent|verts)|applyFieldGuards/i.test(told), false);
});

test("what moved is computed between two checks the page held, and only then", () => {
  const d = Dn.moved(mission("demo-renamed"), mission("demo-repaired"));
  assert.deepEqual({ verdict: d.verdict, lifted: d.lifted, raised: d.raised, steps: d.steps, same: d.same }, { verdict: ["gaps", "clean"], lifted: ["floor", "govern"], raised: [], steps: ["floor", "govern"], same: false });
  assert.deepEqual(Dn.moved(mission("demo-repaired"), mission("demo-renamed")).raised, ["floor", "govern"], "the other way: two refusals raised");
  assert.equal(Dn.moved(mission("demo-repaired"), mission("demo-repaired")).same, true);
  assert.equal(Dn.moved({ id: "x", latest: "not-observed" }, mission("demo-repaired")), null, "the control: no earlier check held, nothing compared");
  // on the screen, only when the page holds the comparison (a live read, web/views/piste/vif.js)
  assert.equal(paint("demo-renamed").html.includes("ce qui a bougé"), false);
  kept.set("rw-accueil-lang", "fr");
  S.index = F.index; S.status = F.status; S.piste = { moved: { "demo-renamed": d }, neuf: {}, sel: null, premier: null, open: [] };
  const html = D.viewDecision("demo-renamed").html;
  assert.ok(html.includes("Le verdict passe de « Refusée par le contrôle » à « Rien ne bloque ».") && html.includes("2 refus levés, à l&#39;étape 3, Plancher et l&#39;étape 5, Gouverner."));
  assert.equal((html.split('id="pi-pan"')[0].match(/class="pi-bouge"/g) ?? []).length, 2, "the two steps that moved are marked on the rail");
  S.piste = undefined;
});

test("the first verdict is said once, on the reading the confirmation opens", () => {
  kept.set("rw-accueil-lang", "fr");
  S.index = F.index; S.status = F.status; S.piste = { moved: {}, neuf: {}, sel: null, premier: "demo-renamed", open: [] };
  assert.ok(D.viewDecision("demo-renamed").html.includes("Premier verdict de demo-renamed, publié à votre confirmation."));
  D.viewDecision("");
  assert.equal(S.piste.premier, null, "the portfolio painted: it is said no more");
  S.piste.premier = "demo-renamed";
  assert.equal(D.viewDecision("demo-repaired").html.includes("Premier verdict"), false, "the control: another application says nothing of it");
  S.piste = undefined;
});

// ---- the words: closed, the same keys (and arities) in both languages, none of the words runward never says
const flatten = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[`${p}${k}`, v]] : typeof v === "function" ? [[`${p}${k}/${v.length}`, v("1", "x")], [`${p}${k}:n`, v("2", "x")]] : Array.isArray(v) ? v.map((x, i) => [`${p}${k}.${i}`, String(x)]) : flatten(v, `${p}${k}.`)));
const NEVER = /(?<![\p{L}])(compliant|compliance|certified|certifi\p{L}*|certify|guarantee\p{L}*|garanti\p{L}*|platforms?|plateformes?|sovereign\p{L}*|souverain\p{L}*|conform\p{L}*|infalsifiable|tamper-?proof)(?![\p{L}])|—/iu;
function lexiconProblems(words) {
  const fr = new Map(flatten(words.fr)), en = new Map(flatten(words.en));
  const out = [];
  for (const k of fr.keys()) if (!en.has(k)) out.push(`en lacks ${k}`);
  for (const k of en.keys()) if (!fr.has(k)) out.push(`fr lacks ${k}`);
  for (const [lang, m] of [["fr", fr], ["en", en]]) for (const [k, v] of m) if (NEVER.test(v)) out.push(`${lang} ${k}: ${v.match(NEVER)[0]}`);
  return out;
}
test("the words of « la piste »: the same keys in French and English, none of the words runward never says, no em dash", () => {
  assert.deepEqual(lexiconProblems(M.PISTE), []);
  const planted = JSON.parse(JSON.stringify(M.PISTE, (k, v) => (typeof v === "function" ? undefined : v)));
  planted.fr.blocks.title = "Ce qui bloque la conformité";
  planted.en.read = "Read — now";
  delete planted.en.board;
  assert.deepEqual(lexiconProblems(planted).sort(), ["en lacks board", "en read: —", "fr blocks.title: conformité"].sort());
});

test("the deadline of a declaration is read defensively: said when the status carries it, the sentence as before when not", () => {
  const line = { mission: "next", repository: "stranxik/next", path: ".", state: "pending", consent: true, accepted: null, notAcceptedSince: 0, activity: [] };
  const status = (l) => ({ ...F.status, lines: [...F.status.lines, l] });
  const row = (html) => /<li class="pi-rg r-attente" data-mission="next">[\s\S]*?<\/div><\/li>/.exec(html)?.[0] ?? "";
  const without = row(paint("", { status: status(line) }).html);
  assert.ok(without.includes("Rien n&#39;est encore arrivé") && !without.includes("expire"), "no field: the sentence as before");
  const withIt = row(paint("", { status: status({ ...line, expiresAt: "2026-11-18T15:40:00.000Z" }) }).html);
  assert.match(withIt, /Avant le <time datetime="2026-11-18T15:40:00.000Z">2026-11-18 16:40&nbsp;\+01:00<\/time>, sinon la déclaration expire\./);
  // a first check received carries no deadline: none is said even if a field were there
  const received = row(paint("", { status: status({ ...line, expiresAt: "2026-11-18T15:40:00.000Z", activity: [{ seq: 9, what: "send-pending", at: "2026-11-12T00:40:00.000Z" }] }) }).html);
  assert.equal(received.includes("expire"), false);
});
