// The decision reading as the app's main screen (runward's ADR-0125, grouped by ADR-0128; pinned by ADR-0021, then
// at main@d052814 by ADR-0024; the journal notes of 2026-11-11): the screen web/views/decision.js paints, run on the bytes the app serves (each module with the
// pinned views' slot filled, as src/http/assets.js serves them) over a tenant's real index and status, built by
// the real application from real `check --strict --json` exports.
//
// The fixtures (test/fixtures/decision/) are runward's own, copied byte for byte from
// test/fixtures/fleet/decision/ at runward main@d05b597 (PR #499), the same bytes at main@d052814, the commit
// runward-fleet is pinned at: real
// exports of real runs (demo-renamed, demo-repaired: runward 0.46.0 in CI on stranxik/runward-demo-renaming;
// hosted-proposed: runward 0.46.0 from npm on this repository at a4ede14; agent-ratified: `init --example`
// with two rows ratified by `ratify --agent`; level-not-met: `--require attested` by the CLI at 5a9cdf0).
//
// What is held here: the screen is the reading of runward-fleet, byte for byte, never rewritten (and in either
// language, chosen per viewer); the date the service accepted each upload reaches the reading as the export's
// `at` label; « Vérifier par vous-même » builds its command only from values that pass strict patterns and
// never with an extension option; what only the service knows is said in its own closed lexicon, the same keys
// in French and in English, with none of the words runward never says; the empty portfolio is the mock-up's;
// every role and state the reading carries is styled by the app's layer, a state by its shape and hue; and the
// reading is the grouped one (runward's ADR-0128): the applications refused first, every state with its n / N,
// the refusals by kind then by the check's text, shown once and folded, every refusal listed once.
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
  // the refusals by kind: on the application's page in its section of refusals, on the portfolio in a few lines
  assert.match(hosted, /data-role="refusal-kind" data-kind="proposed"/);
  assert.match(hosted, /data-role="refusal-kind" data-kind="missing-row"/);
  const card = /<li data-role="application" data-state="gaps" data-mission="runward-hosted">[\s\S]*?<\/li>\s*(?=<li data-role="application"|<\/ol>)/.exec(paint("").html)?.[0] ?? "";
  assert.match(card, /data-role="kind" data-kind="proposed"/);
  assert.match(card, /data-role="kind" data-kind="missing-row"/);
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

// ---- the grouped reading (runward's ADR-0128, pinned by ADR-0024), held on the five real exports
// One application each, declared in an order that is not the reading's: the service lists them by mission id.
async function five() {
  const h = harness();
  const f = await founder(h);
  let n = 7200;
  for (const name of ["demo-repaired", "agent-ratified", "level-not-met", "hosted-proposed", "demo-renamed"]) {
    n++;
    await declared(h, f, { name: `stranxik/${name}`, id: String(n), missions: [{ id: name, path: "." }], first: { mission: name, bytes: FIXTURE(name), claims: { sha: COMMITS.example } } });
  }
  const s = await h.app.identity.sessionFrom(f.token);
  return { index: JSON.parse((await h.app.reading.index(s.tenantId)).bytes.toString("utf8")), status: JSON.parse(JSON.stringify(await h.app.reading.status(s))) };
}
const F = await five();
const count = (s, re) => (s.match(re) ?? []).length;
/** What the export itself says, read from the fixture and never from the index: [kind, n, [the n of each text]] in its order. */
function refusalsOf(name) {
  const rows = JSON.parse(FIXTURE(name).toString("utf8")).conformance ?? [];
  const kinds = new Map();
  for (const c of rows) {
    const k = c.kind ?? "not-observed";
    if (!kinds.has(k)) kinds.set(k, new Map());
    kinds.get(k).set(c.problem, (kinds.get(k).get(c.problem) ?? 0) + 1);
  }
  return { total: rows.length, kinds: [...kinds].map(([k, texts]) => [k, [...texts.values()].reduce((a, b) => a + b, 0), [...texts.values()]]) };
}
/**
 * Is this page of one application the grouped, folded reading of what its export refuses? `want` is refusalsOf().
 * Every refusal is listed once under its index path; a kind is said once with its n / N; a text the check wrote
 * is shown once per kind, folded, the first of the page alone open; the refusals a text stands for are behind a
 * second fold when there are several, each fold's label carrying its n / N.
 */
export function groupingProblems(html, want, id) {
  const out = [];
  const section = /<section data-role="problems">[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  if (!want.total) return section ? ["a section of refusals with nothing refused"] : [];
  if (!section) return ["no section of refusals"];
  const listed = [...section.matchAll(/data-role="problem" data-kind="[^"]*" data-index="([^"]+)"/g)].map((m) => m[1]);
  const paths = Array.from({ length: want.total }, (_, i) => `missions[id=${id}].latest.conformance[${i}]`);
  if (listed.length !== want.total || paths.some((p) => listed.filter((x) => x === p).length !== 1)) out.push(`${listed.length} refusals listed for ${want.total}, each once expected`);
  const kinds = [...section.matchAll(/<li data-role="refusal-kind" data-kind="([^"]*)">/g)].map((m) => m[1]);
  if (JSON.stringify(kinds) !== JSON.stringify(want.kinds.map(([k]) => k))) out.push(`${kinds.length} entries, not the ${want.kinds.length} kinds of the export in its order: ungrouped`);
  const texts = want.kinds.reduce((n, [, , t]) => n + t.length, 0);
  if (count(section, /data-role="verbatim"/g) !== texts) out.push(`${count(section, /data-role="verbatim"/g)} texts shown, ${texts} written by the check: a text is not shown once`);
  if (count(section, /<details data-role="detail"/g) !== count(section, /data-role="verbatim"/g)) out.push("a text is not behind a fold");
  if (count(section, /<details data-role="detail" open>/g) !== 1 || section.indexOf('<details data-role="detail" open>') !== section.indexOf('<details data-role="detail"')) out.push("the first text of the page is not the only one open");
  const several = want.kinds.reduce((n, [, , t]) => n + t.filter((x) => x > 1).length, 0);
  if (count(section, /<details data-role="where"><summary data-role="where-label">/g) !== several) out.push("the refusals of a text that stands for several are not behind a second fold");
  if (/<details data-role="where"[^>]* open/.test(section)) out.push("a list of refusals is open");
  // n / N everywhere: a kind's n of the export's total, a text's n of its kind's n
  const fracs = (role, close) => [...section.matchAll(new RegExp(`data-role="${role}">((?:(?!${close})[\\s\\S])*)${close}`, "g"))].flatMap((m) => {
    const f = /<span class="n"[^>]*>(\d+)<\/span> \/ <span class="n"[^>]*>(\d+)<\/span>/.exec(m[1]);
    return f ? [`${f[1]}/${f[2]}`] : [];
  });
  const wantKinds = want.kinds.map(([, n]) => `${n}/${want.total}`);
  if (JSON.stringify(fracs("sentence", "</p>")) !== JSON.stringify(wantKinds)) out.push(`the kinds read ${fracs("sentence", "</p>").join(" ") || "no n / N"}, not ${wantKinds.join(" ")}`);
  const wantTexts = want.kinds.flatMap(([, n, t]) => t.filter((x) => x > 1).map((x) => `${x}/${n}`));
  if (JSON.stringify(fracs("detail-label", "</summary>")) !== JSON.stringify(wantTexts)) out.push(`the texts read ${fracs("detail-label", "</summary>").join(" ") || "no n / N"}, not ${wantTexts.join(" ")}`);
  return out;
}
/** The portfolio: every state with its n / N (0 / N included), the applications refused first, then level not met, then the others. */
export function portfolioProblems(html, index) {
  const out = [];
  const N = index.missions.length;
  const groups = [...html.matchAll(/<li data-role="group" data-state="([^"]+)">[\s\S]*?<span class="n"[^>]*>(\d+)<\/span> \/ <span class="n"[^>]*>(\d+)<\/span>/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
  const by = new Map(index.fleet.byVerdict.map((g) => [g.state, g.n]));
  if (groups.length !== index.fleet.byVerdict.length) out.push(`${groups.length} states said, the index groups ${index.fleet.byVerdict.length}: a state with no application is left out`);
  for (const [state, n, of] of groups) if (n !== by.get(state) || of !== N) out.push(`state ${state} reads ${n} / ${of}`);
  const rank = (st) => (st === "gaps" ? 0 : st === "level-not-met" ? 1 : 2);
  if (groups.some(([st], i) => i > 0 && rank(groups[i - 1][0]) > rank(st))) out.push("the states are not said refused first");
  const apps = [...html.matchAll(/data-role="application" data-state="([^"]+)" data-mission="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  if (apps.length !== N || new Set(apps.map(([, id]) => id)).size !== N) out.push(`${apps.length} applications listed for ${N}`);
  if (apps.some(([st], i) => i > 0 && rank(apps[i - 1][0]) > rank(st))) out.push("the applications are not listed refused first");
  const inventory = index.missions.map((m) => m.id);
  for (const r of [0, 1, 2]) {
    const ids = apps.filter(([st]) => rank(st) === r).map(([, id]) => id);
    if (ids.some((id, i) => i > 0 && inventory.indexOf(ids[i - 1]) > inventory.indexOf(id))) out.push("within a state, not the inventory's order");
  }
  return out;
}
test("the grouped reading on the five real exports: refused first, n / N for every state, the refusals by kind then by the check's text, once, folded, none hidden", async () => {
  // what the five exports refuse, counted from the files themselves
  assert.deepEqual(refusalsOf("hosted-proposed"), { total: 46, kinds: [["proposed", 42, [22, 19, 1]], ["missing-row", 4, [4]]] });
  assert.deepEqual(refusalsOf("demo-renamed"), { total: 2, kinds: [["evidence-refused", 2, [2]]] });
  for (const clean of ["demo-repaired", "agent-ratified", "level-not-met"]) assert.equal(refusalsOf(clean).total, 0, clean);
  const page = (id, { index = F.index, lang = null } = {}) => paint(id, { index, status: F.status, lang }).html;
  const { checkRefusals } = await import("runward-fleet/rules");
  for (const lang of ["fr", "en"]) for (const id of ["hosted-proposed", "demo-renamed", "demo-repaired", "agent-ratified", "level-not-met"]) {
    const html = page(id, { lang });
    assert.deepEqual(groupingProblems(html, refusalsOf(id), id), [], `${lang} ${id}`);
    assert.deepEqual(checkRefusals(html, F.index, id), [], `${lang} ${id}: runward-fleet's own rule R6, on the screen as the app paints it`);
  }
  // the page of the 46 refusals: 4 texts instead of 46, one open, three lists folded, the 46 places still there
  const hosted = page("hosted-proposed");
  assert.deepEqual([count(hosted, /data-role="verbatim"/g), count(hosted, /<details data-role="detail" open>/g), count(hosted, /<details data-role="where">/g), count(hosted, /data-role="problem"/g)], [4, 1, 3, 46]);
  assert.ok(hosted.includes("Détail du contrôle, tel quel (le même pour ") && hosted.includes("Où, refus par refus"));
  assert.equal(/<script|\son[a-z]+=/i.test(hosted), false, "the folds are <details>: no script and no handler, which the page's policy would refuse");
  // the portfolio: the five states, 0 / 5 included, and the order
  const all = page("");
  assert.deepEqual(portfolioProblems(all, F.index), []);
  assert.deepEqual([...all.matchAll(/<li data-role="group" data-state="([^"]+)">/g)].map((m) => m[1]), ["gaps", "level-not-met", "clean", "not-observed", "not-available"]);
  assert.deepEqual([...all.matchAll(/data-role="application" data-state="[^"]+" data-mission="([^"]+)"/g)].map((m) => m[1]), ["demo-renamed", "hosted-proposed", "level-not-met", "agent-ratified", "demo-repaired"]);
  assert.deepEqual(F.index.missions.map((m) => m.id), ["agent-ratified", "demo-renamed", "demo-repaired", "hosted-proposed", "level-not-met"], "the control: the inventory's order is another one");
  assert.ok(all.includes("Triées par état") && page("", { lang: "en" }).includes("Sorted by state: refused by the check first"));
  // planted control 1: an ungrouped reading. The same index without the grouping by text is what the archive pinned
  // before built (ADR-0024); the pinned views then show each refusal alone, with its own text: nothing is hidden
  // (R6 still holds), and the guard of the grouping is red.
  const before = JSON.parse(JSON.stringify(F.index));
  for (const m of before.missions) for (const g of m.latest?.conformanceByKind ?? []) delete g.byText;
  const alone = page("hosted-proposed", { index: before });
  assert.deepEqual(checkRefusals(alone, before, "hosted-proposed"), [], "ungrouped, every refusal is still listed once");
  assert.deepEqual(groupingProblems(alone, refusalsOf("hosted-proposed"), "hosted-proposed"), [
    "48 entries, not the 2 kinds of the export in its order: ungrouped",
    "46 texts shown, 4 written by the check: a text is not shown once",
    "the refusals of a text that stands for several are not behind a second fold",
    "the texts read no n / N, not 22/42 19/42 4/4",
  ]);
  // planted control 2: a refusal a grouping would hide
  const hidden = hosted.replace(/<li data-role="problem" data-kind="proposed" data-index="missions\[id=hosted-proposed\]\.latest\.conformance\[1\]">[\s\S]*?<\/li>/, "");
  assert.notEqual(hidden, hosted);
  assert.deepEqual(groupingProblems(hidden, refusalsOf("hosted-proposed"), "hosted-proposed"), ["45 refusals listed for 46, each once expected"]);
  assert.equal(checkRefusals(hidden, F.index, "hosted-proposed").length, 1);
  // planted control 3: every text open, and a wrong n / N
  assert.deepEqual(groupingProblems(hosted.replaceAll('<details data-role="detail">', '<details data-role="detail" open>'), refusalsOf("hosted-proposed"), "hosted-proposed"), ["the first text of the page is not the only one open"]);
  const wrong = hosted.replace(/(conformanceByKind\[0\]\.byText\[0\]\.n" title="[^"]*">)22</, "$121<");
  assert.notEqual(wrong, hosted);
  assert.deepEqual(groupingProblems(wrong, refusalsOf("hosted-proposed"), "hosted-proposed"), ["the texts read 21/42 19/42 4/4, not 22/42 19/42 4/4"]);
  // planted control 4: the portfolio in the inventory's order, and a state with no application left out
  const lis = [...all.matchAll(/<li data-role="application"[\s\S]*?<\/li>\s*(?=<li data-role="application"|<\/ol>)/g)].map((m) => m[0]);
  assert.equal(lis.length, 5);
  const idOf = (li) => /data-mission="([^"]+)"/.exec(li)[1];
  const inInventoryOrder = all.replace(lis.join(""), [...lis].sort((a, b) => idOf(a).localeCompare(idOf(b))).join(""));
  assert.notEqual(inInventoryOrder, all);
  assert.deepEqual(portfolioProblems(inInventoryOrder, F.index), ["the applications are not listed refused first"]);
  assert.deepEqual(portfolioProblems(all.replace(/<li data-role="group" data-state="not-available">[\s\S]*?<\/li>/, ""), F.index), ["4 states said, the index groups 5: a state with no application is left out"]);
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
  const all = [paint("").html, ...P.index.missions.map((m) => paint(m.id).html), views.renderView(P.index, "decision", "agent-ratified"),
    paint("", { index: F.index, status: F.status }).html, ...F.index.missions.map((m) => paint(m.id, { index: F.index, status: F.status }).html)].join("\n");
  for (const role of ["refusal-kinds", "refusal-kind", "refusal-text", "where", "where-label", "refusals", "problem", "detail", "detail-label", "verbatim"]) assert.ok(all.includes(`data-role="${role}"`), `the screens read here carry the role ${role}`);
  assert.deepEqual(mappingProblems(CSS, all), []);
  // planted controls: a role left to the fleet stylesheet, a state in the wrong hue, a ground inverted, the live blue
  const html = '<p data-role="state" data-state="gaps"><span data-role="mark"></span><span data-role="state-word">x</span></p><p data-role="planted-role">y</p>';
  assert.deepEqual(mappingProblems(CSS, html), ["role planted-role not styled by the layer"]);
  assert.deepEqual(mappingProblems(CSS.replace('[data-state="gaps"] > [data-role="mark"]{ color:var(--refus);', '[data-state="gaps"] > [data-role="mark"]{ color:var(--niveau);'), html.replace(/<p data-role="planted-role">y<\/p>/, "")), ["state gaps: not in --refus"]);
  assert.deepEqual(mappingProblems(CSS.replace(/(\.lecture \[data-role="state"\]\{[^}]*)background:none;/, "$1background:var(--text);"), ""), ["the state's word is not in ink on the page's ground"]);
  assert.deepEqual(mappingProblems(`${CSS}\n.lecture [data-role="date"]{ color:var(--direct); }`, ""), ["the live blue is used by the reading"]);
});
