// The decision reading as the app's main screen (runward's ADR-0125, pinned by ADR-0021, its journal note of
// 2026-11-11): the screen web/views/decision.js paints, run on the bytes the app serves (each module with the
// pinned views' slot filled, as src/http/assets.js serves them) over a tenant's real index and status, built by
// the real application from real `check --strict --json` exports.
//
// The fixtures (test/fixtures/decision/) are runward's own, copied byte for byte from
// test/fixtures/fleet/decision/ at runward main@d05b597 (PR #499), the commit runward-fleet is pinned at: real
// exports of real runs (demo-renamed, demo-repaired: runward 0.46.0 in CI on stranxik/runward-demo-renaming;
// hosted-proposed: runward 0.46.0 from npm on this repository at a4ede14; agent-ratified: `init --example`
// with two rows ratified by `ratify --agent`; level-not-met: `--require attested` by the CLI at 5a9cdf0).
//
// What is held here: the screen is the reading of runward-fleet, byte for byte, never rewritten (and in either
// language, chosen per viewer); the date the service accepted each upload reaches the reading as the export's
// `at` label; « Vérifier par vous-même » builds its command only from values that pass strict patterns and
// never with an extension option; what only the service knows is said in its own closed lexicon, the same keys
// in French and in English, with none of the words runward never says; the empty portfolio is the mock-up's;
// and every role and state the reading carries is styled by the app's layer, a state by its shape and hue.
// Each guard has its planted control.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULES } from "../../src/http/assets.js";
import { harness, founder, gesture, send } from "../helpers.js";
import { receivedLabel } from "../../src/application/context.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const VIEWS = new URL("../../node_modules/runward-fleet/ui/views.js", import.meta.url);
const FIXTURE = (name) => readFileSync(new URL(`../fixtures/decision/${name}.check.json`, import.meta.url));

// ---- the browser the modules expect, reduced to what they touch at import and at paint
const kept = new Map();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, getElementById: () => ({}) };
globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };

// ---- the modules as served: the slot of the pinned views filled (src/http/assets.js#buildAssets)
const served = mkdtempSync(join(tmpdir(), "rw-decision-"));
after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) {
  const p = join(served, f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href)));
}
const D = await import(pathToFileURL(join(served, "views/decision.js")).href);
const { S } = await import(pathToFileURL(join(served, "views/base.js")).href);
const views = await import(VIEWS.href);

// ---- a tenant's real index and status, from the real application
const COMMITS = { renamed: "97fce96d901d0d07cad8a230950d391b223736af", hosted: "a4ede1485323293609957a700aba13ddf99de27f", example: "9a1f3c5e7b2d4f6a8c0e1b3d5f7a9c2e4b6d8f01" };
async function declared(h, f, { name, id, missions, first = null }) {
  await gesture(h, f.session, "declare-with-consent", name.toLowerCase());
  const s = await h.app.identity.sessionFrom(f.token);
  const d = await h.app.repositories.declare(s, { name, consent: true, missions }, {});
  if (!first) return d;
  const r = await send(h, { repository: name, repository_id: id, run_id: `4283${id}`, run_number: "11", ...first.claims }, { mission: first.mission, bytes: first.bytes });
  assert.equal(r.status, 202, `${name}: the first upload is kept, to confirm`);
  await gesture(h, s, "repository-confirm", d.id);
  await h.app.repositories.confirm(await h.app.identity.sessionFrom(f.token), d.id, {});
  return d;
}
async function portfolio() {
  const h = harness();
  const f = await founder(h);
  await declared(h, f, { name: "stranxik/runward-demo-renaming", id: "7001", missions: [{ id: "runward-demo-renaming", path: "." }], first: { mission: "runward-demo-renaming", bytes: FIXTURE("demo-renamed"), claims: { sha: COMMITS.renamed } } });
  await declared(h, f, { name: "stranxik/runward-hosted", id: "7002", missions: [{ id: "runward-hosted", path: "." }], first: { mission: "runward-hosted", bytes: FIXTURE("hosted-proposed"), claims: { sha: COMMITS.hosted } } });
  // one repository, two missions: one sends the agent-ratified export, the other has never sent (not observed)
  await declared(h, f, { name: "stranxik/examples", id: "7003", missions: [{ id: "agent-ratified", path: "agents" }, { id: "silent", path: "quiet" }], first: { mission: "agent-ratified", bytes: FIXTURE("agent-ratified"), claims: { sha: COMMITS.example } } });
  // an upload not accepted after the accepted one: another calling workflow
  h.clock.advance(60_000);
  const refused = await send(h, { repository: "stranxik/runward-hosted", repository_id: "7002", run_id: "42830000099", run_number: "12", workflow_ref: "stranxik/runward-hosted/.github/workflows/other.yml@refs/heads/main" }, { mission: "runward-hosted", bytes: FIXTURE("hosted-proposed") });
  assert.equal(refused.refusal, "workflow-not-pinned");
  const s = await h.app.identity.sessionFrom(f.token);
  const idx = await h.app.reading.index(s.tenantId);
  return { h, f, s, index: JSON.parse(idx.bytes.toString("utf8")), status: JSON.parse(JSON.stringify(await h.app.reading.status(s))) };
}
const P = await portfolio();
const paint = (sub, { index = P.index, status = P.status, lang = null, fleetError = null } = {}) => {
  if (lang) kept.set("rw-accueil-lang", lang); else kept.delete("rw-accueil-lang");
  S.index = index; S.status = status; S.fleetError = fleetError; S.session = P.s;
  return D.viewDecision(sub);
};

test("the date the service accepted an upload reaches the reading as the export's `at` label (spec §8): no « date non déclarée »", () => {
  const src = P.index.sources.find((x) => x.id === "runward-hosted:check");
  assert.match(src.at, /^2026-11-06 13:0\d \+01:00$/, "the label of the acceptance, to the minute, in the service's time with its offset, as the app shows every time");
  const line = P.status.lines.find((l) => l.mission === "runward-hosted");
  assert.equal(src.at, receivedLabel(Date.parse(line.accepted.receivedAt)), "the same instant the service serves as the last accepted upload");
  // the offset follows the date: summer time, and both sides of the change of 2026-03-29
  assert.deepEqual([Date.parse("2026-07-06T12:00:00Z"), Date.parse("2026-03-29T00:59:00Z"), Date.parse("2026-03-29T01:00:00Z")].map(receivedLabel), ["2026-07-06 14:00 +02:00", "2026-03-29 01:59 +01:00", "2026-03-29 03:00 +02:00"]);
  const html = views.renderView(P.index, "decision", "runward-hosted");
  assert.ok(html.includes(`Dernier contrôle reçu : <span data-verbatim>${src.at}</span>`), "the reading says when the last check was received");
  assert.equal(/date non déclarée/.test(views.renderView(P.index, "decision")), false, "no application of the portfolio is undated");
  assert.equal(views.decide(P.index).applications.filter((a) => a.date?.key === "/date/received" && a.date.text.endsWith("date non déclarée")).length, 0, "every application with a check is dated");
});

test("a later upload, accepted on the send path, dates the reading with its own acceptance; the first one's confirmation is said", async () => {
  const h = harness();
  const f = await founder(h);
  await declared(h, f, { name: "stranxik/runward-demo-renaming", id: "7101", missions: [{ id: "demo", path: "." }], first: { mission: "demo", bytes: FIXTURE("demo-renamed"), claims: { sha: COMMITS.renamed } } });
  h.clock.advance(3 * 3_600_000 + 17 * 60_000);
  const r = await send(h, { repository: "stranxik/runward-demo-renaming", repository_id: "7101", run_id: "42836073560", run_number: "12", sha: "0b56196b9c821358efcd890f279d00d29a744395" }, { mission: "demo", bytes: FIXTURE("demo-repaired") });
  assert.equal(r.status, 201);
  const s = await h.app.identity.sessionFrom(f.token);
  const index = JSON.parse((await h.app.reading.index(s.tenantId)).bytes.toString("utf8"));
  assert.equal(index.sources.find((x) => x.id === "demo:check").at, "2026-11-06 16:17 +01:00", "the label of the second acceptance");
  assert.equal(index.missions[0].latest.verdict, "clean");
  const status = JSON.parse(JSON.stringify(await h.app.reading.status(s)));
  const html = paint("demo", { index, status }).html;
  assert.ok(html.includes("Dernier contrôle reçu\u00a0: <span data-verbatim>2026-11-06 16:17 +01:00</span>"));
  assert.match(html, /· accepté<span class="sub">commit <code translate="no">0b56196b9c82<\/code> · exécution n° 12<\/span>/);
  assert.match(html, /· premier contrôle confirmé<\/li>/);
  // planted control: a service that would not write the label leaves the reading undated
  const unlabelled = JSON.parse(JSON.stringify(index));
  for (const x of unlabelled.sources) x.at = null;
  assert.ok(views.renderView(unlabelled, "decision", "demo").includes("date non déclarée"));
});

test("the main screen is runward-fleet's reading, byte for byte, in the index's language and in the other one the viewer chooses", () => {
  const fr = paint("");
  assert.equal(fr.fleetRoute, "decision");
  assert.ok(fr.html.includes(views.renderView(P.index, "decision")), "the portfolio as runward-fleet writes it for this index");
  assert.ok(fr.html.startsWith('<div class="lecture" lang="fr" data-vue="port">'));
  const en = paint("", { lang: "en" });
  assert.ok(en.html.includes(views.renderView({ ...P.index, lang: "en" }, "decision")), "the same index, read in English");
  assert.ok(en.html.startsWith('<div class="lecture" lang="en" data-vue="port">'));
  assert.ok(en.html.includes("Before your go / no-go") && !en.html.includes("Avant votre go"));
  // the choice is the viewer's, kept under the key of the public site's switch
  D.setReadingLang("en");
  assert.equal(kept.get("rw-accueil-lang"), "en");
  D.setReadingLang("de");
  assert.equal(kept.get("rw-accueil-lang"), "en", "a language the reading does not have is never kept");
  // one application, at a stable address
  for (const id of ["runward-hosted", "runward-demo-renaming", "agent-ratified", "silent"]) {
    const v = paint(id);
    assert.ok(v.html.includes(views.renderView(P.index, "decision", id)), `${id}: its reading as runward-fleet writes it`);
    assert.equal(v.decision, id);
  }
  // planted control: a reading the app had touched (one word changed) is not the pinned one
  const touched = views.renderView(P.index, "decision").replace("Refusée par le contrôle", "Refusée");
  assert.equal(paint("").html.includes(touched), false);
});

test("the five states, the reason, the refusals by kind with their text as written, the documents, the endorsements and the origin are all on the screen", () => {
  const hosted = paint("runward-hosted").html;
  assert.match(hosted, /<p data-role="state" data-state="gaps">/);
  assert.match(hosted, /<p data-role="reason">Le contrôle refuse cette version, pour les raisons qui suivent\.<\/p>/);
  assert.match(hosted, /data-role="kind" data-kind="proposed"/);
  assert.match(hosted, /data-role="kind" data-kind="missing-row"/);
  const doc = JSON.parse(FIXTURE("hosted-proposed").toString("utf8"));
  const someProblem = (doc.conformance ?? []).find((c) => typeof c.problem === "string" && c.problem.includes("`"))?.problem;
  assert.ok(someProblem, "the fixture carries a refusal's free text");
  assert.ok(hosted.includes(`<p data-role="verbatim" lang="en">${someProblem.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")}</p>`), "a refusal's text as written, marked as data");
  assert.match(hosted, /data-role="pieces"/);
  assert.match(hosted, /data-role="endorsement"/);
  assert.match(hosted, /data-role="origin">D&#39;où vient cette lecture/);
  // an agent's endorsement is never worded as a person's
  for (const lang of ["fr", "en"]) {
    const page = paint("agent-ratified", { lang }).html;
    const lines = [...page.matchAll(/<section data-role="endorsement">([\s\S]*?)<\/section>/g)].map((m) => m[1]).join("");
    assert.ok(lines.includes(lang === "fr" ? "validés par un agent relecteur" : "endorsed by a reviewing agent"), `${lang}: the agent's rows said as an agent's`);
    assert.equal(/(validés?|endorsed) par une personne|endorsed by a person|approved by/i.test(page), false, `${lang}: no row said as a person's`);
  }
  // the states the index holds, each in the reading with its own data-state
  const states = new Set([...paint("").html.matchAll(/data-role="application" data-state="([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...states].sort(), ["clean", "gaps", "not-observed"]);
});

test("« Vérifier par vous-même »: the command, built only from values that pass their pattern, never with an extension option", () => {
  const html = paint("runward-hosted").html;
  const cmd = `git clone https://github.com/stranxik/runward-hosted &amp;&amp; git -C runward-hosted checkout ${COMMITS.hosted} &amp;&amp; npx --yes runward@0.46.0 check --strict --path runward-hosted`;
  assert.ok(html.includes(`<code translate="no" id="cmd-texte">${cmd}</code>`), "the command for this application, its commit and its version");
  assert.ok(html.includes("Ce n&#39;est pas notre écran qui le dit."));
  assert.ok(html.includes(`href="https://github.com/stranxik/runward-hosted/actions/runs/42837002"`), "the run of the chain, by its id");
  assert.equal(/--hooks|--no-verify/.test(html), false);
  // a mission in a folder of its repository: the path follows it
  assert.match(paint("agent-ratified").html, /check --strict --path examples\/agents<\/code>/);
  // no check yet: nothing to run again
  const silent = paint("silent").html;
  assert.ok(silent.includes("Aucun contrôle reçu : il n&#39;y a encore rien à refaire."));
  assert.equal(/npx --yes/.test(silent), false);
  // the patterns, value by value, each with its planted value
  const ok = { repository: "github.com/stranxik/runward-hosted", commit: COMMITS.hosted, version: "0.46.0", path: "." };
  assert.ok(D.verifyCommand(ok).command);
  for (const [field, bad] of [
    ["repository", "github.com/stranxik/runward-hosted; rm -rf ~"], ["repository", "github.com/-x/runward"], ["repository", "github.com/stranxik/.hidden"],
    ["repository", "github.com/stranxik/a b"], ["repository", "gitlab.com/stranxik/runward"], ["repository", "github.com/stranxik/x.git"],
    ["commit", COMMITS.hosted.slice(0, 39)], ["commit", COMMITS.hosted.toUpperCase()], ["commit", `${COMMITS.hosted.slice(0, 39)};`], ["commit", null],
    ["version", "0.46.0 --hooks"], ["version", "latest"], ["version", "0.46"], ["version", undefined],
    ["path", "../outside"], ["path", "a/../../b"], ["path", "a b"], ["path", "-rf"], ["path", "a/./b"],
  ]) {
    const r = D.verifyCommand({ ...ok, [field]: bad });
    assert.deepEqual(r, { refused: field }, `${field} = ${JSON.stringify(bad)}`);
  }
  // on the screen: no command, and the reason
  const broken = { ...P.index, missions: P.index.missions.map((m) => (m.id === "runward-hosted" ? { ...m, commit: "a4ede14" } : m)) };
  const r = paint("runward-hosted", { index: broken }).html;
  assert.ok(r.includes("Pas de commande : le commit ne passe pas son motif strict"), "the reason, in the service's words");
  assert.equal(/npx --yes/.test(r), false);
});

test("the checks received: accepted and not accepted, by date, each refusal with its code as written and its line in the service's words", () => {
  const html = paint("runward-hosted").html;
  assert.match(html, /<h2 class="scr-bar">Contrôles reçus<\/h2>/, "the panel's title is the bar of its window");
  assert.match(html, /non accepté : <code translate="no">workflow-not-pinned<\/code>, envoyé par une autre chaîne que celle déclarée/);
  assert.match(html, /1 contrôle non accepté depuis le dernier contrôle accepté\./);
  assert.match(paint("runward-hosted", { lang: "en" }).html, /not accepted: <code translate="no">workflow-not-pinned<\/code>, sent by another chain than the one declared/);
  // a code this lexicon does not know is shown as written, and escaped
  const status = JSON.parse(JSON.stringify(P.status));
  const line = status.lines.find((l) => l.mission === "runward-hosted");
  line.activity = [{ seq: 99, what: "send-not-accepted", who: "workload", at: "2026-11-06T12:05:00.000Z", refusal: "<img src=x onerror=alert(1)>", commit: "abc", runNumber: "13" }];
  const odd = paint("runward-hosted", { status }).html;
  assert.ok(odd.includes("motif tel que le service l&#39;écrit</span> <code translate=\"no\">&lt;img src=x onerror=alert(1)&gt;</code>"));
  assert.equal(odd.includes("<img"), false);
});

test("the empty portfolio is the mock-up's; declared applications are named while their first check is awaited; errors and loading are named", () => {
  const empty = paint("", { index: null, status: { lines: [], quarantined: 0, recent: [], head: null, index: null } });
  assert.ok(empty.html.includes('<p class="h2">Aucune application dans votre portefeuille.</p>'));
  assert.ok(empty.html.includes("Branchez une application : son prochain contrôle arrivera ici, avec une phrase et de quoi le vérifier."));
  assert.ok(empty.html.includes('data-go="#/declarer">Brancher une première application</button>'));
  const emptyEn = paint("", { index: null, status: { lines: [], quarantined: 0, recent: [], head: null, index: null }, lang: "en" });
  assert.ok(emptyEn.html.includes('<p class="h2">No application in your portfolio.</p>'));
  const waiting = paint("", { index: null, status: { lines: [{ mission: "m", repository: "stranxik/<b>x</b>", path: ".", state: "pending", consent: true, accepted: null, notAcceptedSince: 0, activity: [] }], quarantined: 0, recent: [], head: null, index: null } });
  assert.ok(waiting.html.includes("En attente du premier contrôle."));
  assert.ok(waiting.html.includes("stranxik/&lt;b&gt;x&lt;/b&gt;"), "a name is data, escaped");
  // every application removed: the index carries no mission, and the screen says the same as before the first one
  const none = paint("", { index: { ...P.index, missions: [] }, status: { lines: [], quarantined: 0, recent: [], head: null, index: P.status.index } });
  assert.ok(none.html.includes('<p class="h2">Aucune application dans votre portefeuille.</p>'));
  // a repository declared beside published ones: the portfolio names it, its first check awaited
  const status = JSON.parse(JSON.stringify(P.status));
  status.lines.push({ mission: "next-one", repository: "stranxik/next", path: ".", state: "pending", consent: true, accepted: null, notAcceptedSince: 0, activity: [] });
  const beside = paint("", { status }).html;
  assert.ok(beside.includes(views.renderView(P.index, "decision")) && beside.includes('<p id="h-attente"><b>En attente du premier contrôle.</b></p>') && beside.includes("stranxik/next"));
  assert.equal(paint("").html.includes("h-attente"), false, "the control: nothing awaited, no such section");
  assert.equal(paint("", { status: null }).html.includes("Chargement"), true, "loading");
  const err = paint("", { fleetError: { status: 503, requestId: "req-1" } });
  assert.ok(err.html.includes("Le portefeuille ne s&#39;affiche pas.") && err.html.includes('data-do="reload-screen"') && err.html.includes("<code>req-1</code>"));
  // an application that is not in the portfolio is said, never replaced by the portfolio
  const unknown = paint("no-such-mission");
  assert.ok(unknown.html.includes("Cette application n&#39;est pas dans votre portefeuille."));
  assert.equal(unknown.html.includes('data-reading="decision"'), false);
  assert.equal(paint("%E0%A4%A"), null, "an address that does not decode leads nowhere");
});

// ---- the service's own lexicon: closed, the same keys in both languages, none of the words never said
const flatten = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[`${p}${k}`, v]] : typeof v === "function" ? [[`${p}${k}`, v("1")], [`${p}${k}:n`, v("2")]] : Array.isArray(v) ? v.flatMap((x, i) => flatten(Object.fromEntries(x.map((y, j) => [j, y])), `${p}${k}.${i}.`)) : flatten(v, `${p}${k}.`)));
const NEVER = /\b(compliant|compliance|certified|certifi\w*|guarantee\w*|garanti\w*|platforms?|plateformes?|sovereign\w*|souverain\w*|conformes?|infalsifiable|tamper-?proof)\b|\u2014/i;
export function lexiconProblems(words) {
  const fr = new Map(flatten(words.fr)), en = new Map(flatten(words.en));
  const out = [];
  for (const k of fr.keys()) if (!en.has(k)) out.push(`en lacks ${k}`);
  for (const k of en.keys()) if (!fr.has(k)) out.push(`fr lacks ${k}`);
  for (const [lang, m] of [["fr", fr], ["en", en]]) for (const [k, v] of m) if (NEVER.test(v)) out.push(`${lang} ${k}: ${v.match(NEVER)[0]}`);
  return out;
}
test("the service's lexicon: the same keys in French and English, none of the words runward never says, no em dash", () => {
  assert.deepEqual(lexiconProblems(D.WORDS), []);
  // planted controls: a key missing in one language, a banned word, an em dash
  const planted = JSON.parse(JSON.stringify(D.WORDS));
  delete planted.en.retry;
  planted.fr.connect = "Brancher votre plateforme";
  planted.en.uploads = "See the uploads \u2014 all";
  assert.deepEqual(lexiconProblems(planted).sort(), ["en lacks retry", "en uploads: \u2014", "fr connect: plateforme"].sort());
});

// ---- the mapping of the reading's roles onto the app's layer (web/app.css)
const CSS = readFileSync(join(WEB, "app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rulesOf = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
export function mappingProblems(css, html) {
  const rules = rulesOf(css);
  const out = [];
  const roles = new Set([...html.matchAll(/data-role="([^"]+)"/g)].map((m) => m[1]));
  for (const r of roles) if (!rules.some((x) => x.sel.includes(`[data-role="${r}"]`))) out.push(`role ${r} not styled by the layer`);
  const hue = { clean: "--text", gaps: "--refus", "level-not-met": "--niveau", "not-observed": "--bar", "not-available": "--bar" };
  for (const [state, token] of Object.entries(hue)) {
    const r = rules.find((x) => x.sel.split(",").some((s) => s.trim() === `[data-state="${state}"] > [data-role="mark"]`));
    if (!r) { out.push(`state ${state}: no mark`); continue; }
    if (!r.body.includes(`color:var(${token})`)) out.push(`state ${state}: not in ${token}`);
  }
  const state = rules.find((x) => x.sel === '.lecture [data-role="state"]');
  if (!state || !/background:none/.test(state.body) || !/color:var\(--text\)/.test(state.body)) out.push("the state's word is not in ink on the page's ground");
  const decision = css.slice(css.indexOf('[data-role="mark"]'));
  if (/var\(--direct\)/.test(decision)) out.push("the live blue is used by the reading");
  if (/green|#0[0-9a-f]{2}[89a-f][0-9a-f]{2}\b/i.test(decision)) out.push("a green");
  return out;
}
test("every role and state the reading carries is styled by the app's layer: a state by its shape and hue, the word in ink, no live blue", () => {
  const all = [paint("").html, ...P.index.missions.map((m) => paint(m.id).html), views.renderView(P.index, "decision", "agent-ratified")].join("\n");
  assert.deepEqual(mappingProblems(CSS, all), []);
  // planted controls: a role left to the fleet stylesheet, a state in the wrong hue, a ground inverted, the live blue
  const html = '<p data-role="state" data-state="gaps"><span data-role="mark"></span><span data-role="state-word">x</span></p><p data-role="planted-role">y</p>';
  assert.deepEqual(mappingProblems(CSS, html), ["role planted-role not styled by the layer"]);
  assert.deepEqual(mappingProblems(CSS.replace('[data-state="gaps"] > [data-role="mark"]{ color:var(--refus);', '[data-state="gaps"] > [data-role="mark"]{ color:var(--niveau);'), html.replace(/<p data-role="planted-role">y<\/p>/, "")), ["state gaps: not in --refus"]);
  assert.deepEqual(mappingProblems(CSS.replace(/(\.lecture \[data-role="state"\]\{[^}]*)background:none;/, "$1background:var(--text);"), ""), ["the state's word is not in ink on the page's ground"]);
  assert.deepEqual(mappingProblems(`${CSS}\n.lecture [data-role="date"]{ color:var(--direct); }`, ""), ["the live blue is used by the reading"]);
});
