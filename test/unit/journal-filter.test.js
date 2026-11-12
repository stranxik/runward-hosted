// The journal's filters (ADR-0037 point 2): GET /api/v0/journal?mission=&kind=&days= selects among the tenant's own
// entries, paged by the same cursor; without them the answer is the one it always was. Over a tenant built by the
// real application: two applications, a declaration, a confirmation, an upload accepted, one refused, sign-ins and
// account gestures, spread over forty days of the service's clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { harness, founder, gesture, send, pinnedRepository } from "../helpers.js";
import { journalRoutes } from "../../src/http/routes/journal.js";
import { JOURNAL_KINDS, JOURNAL_DAYS, readJournalFilter, entryMatches } from "../../src/domain/journal-filter.js";
import { Refusal } from "../../src/domain/refusals/index.js";

const DAY = 86_400_000;
const json = (x) => JSON.parse(JSON.stringify(x));

async function tenant() {
  const h = harness();
  const f = await founder(h);
  let tok = f.token;
  const s = () => h.app.identity.sessionFrom(tok);
  // a sign-in after the clock moved on (a session does not outlive its days)
  const signIn = async () => { const o = await h.app.identity.signInOptions(); tok = (await h.app.identity.signIn({ challengeId: o.challengeId, response: { id: f.creds[0], challenge: o.options.challenge }, ua: "Chrome/130 Macintosh" })).token; };
  // forty days ago: dropyour declared, its first upload, confirmed
  const dropyour = await pinnedRepository(h, f, { name: "stranxik/dropyour", mission: "dropyour" });
  h.clock.advance(35 * DAY);
  await signIn();
  // five days ago: hitpoint declared with consent; an upload from a workflow it did not declare, refused
  await gesture(h, await s(), "declare-with-consent", "stranxik/hitpoint");
  const hitpoint = await h.app.repositories.declare(await s(), { name: "stranxik/hitpoint", consent: true, missions: [{ id: "hitpoint", path: "." }] }, {});
  const refused = await send(h, { repository: "stranxik/hitpoint", repository_id: "8801", run_id: "39000000101", run_number: "3", workflow_ref: "stranxik/hitpoint/.github/workflows/other.yml@refs/heads/main" }, { mission: "hitpoint" });
  assert.equal(refused.refusal, "workflow-not-pinned");
  h.clock.advance(5 * DAY - 3_600_000);
  await signIn();
  // an hour ago: dropyour sends again, accepted
  await send(h, { repository: "stranxik/dropyour", run_number: "2", run_id: "39000000002" }, { mission: "dropyour" });
  const route = journalRoutes(h.app)[0][3];
  const ask = async (query = "") => json(await route({ session: await s(), url: new URL(`https://app.runward.dev/api/v0/journal${query}`), lang: "fr" }));
  return { h, f, s, ask, ids: { dropyour: dropyour.id, hitpoint: hitpoint.id } };
}
const T = await tenant();
const whats = (page) => page.entries.map((e) => e.body.what);

test("without a filter, the answer is the one it always was: no field added, the same entries", async () => {
  const plain = await T.ask();
  assert.deepEqual(Object.keys(plain).sort(), ["end", "entries", "head", "next", "note"]);
  assert.equal(plain.entries.length, plain.head.seq, "every entry, newest first");
  assert.deepEqual(plain.entries.map((e) => e.seq), [...plain.entries.map((e) => e.seq)].sort((a, b) => b - a));
  // empty values are no filter
  assert.deepEqual(await T.ask("?mission=&kind=&days="), plain);
});

test("each kind keeps its entries, and only them", async () => {
  const all = await T.ask();
  for (const kind of Object.keys(JOURNAL_KINDS)) {
    const page = await T.ask(`?kind=${kind}`);
    const expected = all.entries.filter((e) => JOURNAL_KINDS[kind].includes(e.body.what)).map((e) => e.seq);
    assert.deepEqual(page.entries.map((e) => e.seq), expected, kind);
    assert.equal(page.total, expected.length, `${kind}: its total`);
    assert.deepEqual(page.filter, { mission: null, kind, days: null });
    assert.deepEqual(page.head, all.head, "the head is the journal's, whatever the filter");
  }
  assert.ok(whats(await T.ask("?kind=sends-accepted")).includes("send-accepted"));
  assert.deepEqual([...new Set(whats(await T.ask("?kind=sends-refused")))], ["send-not-accepted"]);
  assert.deepEqual([...new Set(whats(await T.ask("?kind=confirmations")))], ["repository-confirmed"]);
  assert.ok(whats(await T.ask("?kind=sign-ins")).includes("signed-in"));
  assert.ok(whats(await T.ask("?kind=account")).includes("passkey-added"));
  assert.ok(whats(await T.ask("?kind=declarations")).includes("repository-declared"));
});

test("an application keeps its declaration, its consent, its uploads (refused ones too) and its confirmation, never another's", async () => {
  const hit = await T.ask("?mission=hitpoint");
  assert.deepEqual(whats(hit).sort(), ["consent-given", "repository-declared", "send-not-accepted"]);
  const drop = await T.ask("?mission=dropyour");
  assert.deepEqual([...new Set(whats(drop))].sort(), ["consent-given", "repository-confirmed", "repository-declared", "send-accepted", "send-pending"]);
  assert.equal(drop.entries.some((e) => e.body.object === T.ids.hitpoint), false);
  // an application the tenant does not have: nothing, never a refusal (no other tenant's names are read)
  const none = await T.ask("?mission=not-here");
  assert.deepEqual([none.entries.length, none.total, none.end, none.next], [0, 0, true, null]);
  // planted control: the same filter without its application keeps nothing
  assert.equal(entryMatches(drop.entries[0], { mission: "dropyour", kind: null, days: null }, { app: null }), false);
});

test("a period keeps what the service received in it; filters combine", async () => {
  const week = await T.ask("?days=7");
  const now = T.h.clock.now();
  assert.ok(week.entries.length > 0 && week.entries.every((e) => Date.parse(e.body.dates.received.at) >= now - 7 * DAY));
  assert.ok((await T.ask()).entries.some((e) => Date.parse(e.body.dates.received.at) < now - 7 * DAY), "control: older entries exist");
  const day = await T.ask("?days=1&kind=sends-accepted&mission=dropyour");
  assert.deepEqual(whats(day), ["send-accepted"]);
  assert.equal((await T.ask("?days=1&mission=hitpoint")).entries.length, 0, "hitpoint did nothing in the last day");
});

test("a filtered journal pages by the same cursor", async () => {
  const h = harness();
  const f = await founder(h);
  const s = () => h.app.identity.sessionFrom(f.token);
  await gesture(h, await s(), "declare-with-consent", "stranxik/radar");
  await h.app.repositories.declare(await s(), { name: "stranxik/radar", consent: true, missions: [{ id: "radar", path: "." }] }, {});
  // sixty uploads from a workflow not declared, each refused, between the founder's entries and the declaration's
  for (let i = 0; i < 60; i++) { const r = await send(h, { repository: "stranxik/radar", repository_id: "8901", run_id: String(39000001000 + i), run_number: String(i + 1), workflow_ref: "stranxik/radar/.github/workflows/other.yml@refs/heads/main" }, { mission: "radar" }); assert.ok(r.refusal); h.clock.advance(1000); }
  const route = journalRoutes(h.app)[0][3];
  const ask = async (q) => json(await route({ session: await s(), url: new URL(`https://app.runward.dev/api/v0/journal${q}`), lang: "fr" }));
  const pages = [];
  const q = "?kind=sends-refused&mission=radar";
  let n = 0;
  for (let p = await ask(q); ; p = await ask(`${q}&cursor=${p.next}`)) {
    n++;
    pages.push(...p.entries.map((e) => e.seq));
    assert.equal(p.total, 60);
    if (p.end) { assert.equal(p.next, null); break; }
    assert.equal(p.entries.length, 50, "a full page before the next");
  }
  assert.equal(n, 2);
  const whole = [];
  for (let p = await ask(""); ; p = await ask(`?cursor=${p.next}`)) { whole.push(...p.entries.filter((e) => e.body.what === "send-not-accepted").map((e) => e.seq)); if (p.end) break; }
  assert.deepEqual(pages, whole);
  // a cursor past the head is refused as it always was, filtered or not
  await assert.rejects(ask(`${q}&cursor=99999`), (e) => e instanceof Refusal && e.code === "cursor-invalid");
});

test("a filter the service does not know is refused, never ignored", async () => {
  for (const q of ["?kind=everything", "?days=2", "?mission=Not_A_Mission", "?days=-7", "?kind=__proto__"]) {
    await assert.rejects(T.ask(q), (e) => e instanceof Refusal && e.code === "journal-filter-invalid", q);
  }
  assert.equal(readJournalFilter(new URLSearchParams("")), null);
  assert.deepEqual(readJournalFilter(new URLSearchParams("days=30")), { mission: null, kind: null, days: 30 });
  assert.deepEqual(JOURNAL_DAYS, [1, 7, 30, 90, 365]);
});

test("every act the service writes, and every act the lexicon names, belongs to exactly one kind", () => {
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } };
  walk(SRC);
  const written = new Set();
  for (const p of files) for (const m of readFileSync(p, "utf8").matchAll(/\bwhat: "([a-z-]+)"/g)) written.add(m[1]);
  // the computed ones: what the ingest and the repository gestures choose between
  for (const w of ["send-accepted", "send-historical", "send-pending", "send-not-accepted", "send-quarantined", "protection-lifted", "protection-restored", "reader-authorized", "reader-withdrawn", "reader-read", "export-prepared", "issuer-key-added", "issuer-key-confirmed", "member-founded", "member-recovered", "signed-in"]) written.add(w);
  const lex = readFileSync(new URL("../../web/views/lexique.js", import.meta.url), "utf8");
  const acts = /acts: \{([\s\S]*?)\n {4}\},/.exec(lex)[1];
  for (const m of acts.matchAll(/"([a-z-]+)":/g)) written.add(m[1]);
  // the operator's anchor of a journal head is an event of the security log, not a journal entry (src/application/operator.js)
  written.delete("journal-anchored");
  assert.ok(written.has("consent-given") && written.has("repository-expired"));
  const classed = Object.values(JOURNAL_KINDS).flat();
  assert.equal(classed.length, new Set(classed).size, "no act in two kinds");
  const unclassed = [...written].filter((w) => !classed.includes(w));
  assert.deepEqual(unclassed, []);
  // planted control: an act no kind gathers is seen
  assert.equal(classed.includes("planted-act"), false);
});
