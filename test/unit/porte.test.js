// A gate, said in the reader's language. runward writes « 3 · Floor » for one gate and
// « deliverables filled, gate red at Floor, Govern » when the pieces are there but the control refuses at one or more
// steps (test/fixtures/decision/demo-renamed.check.json carries the second form). The app said the second one as
// written, in English, inside a French sentence (« Refusée à la deliverables filled, gate red at Floor, Govern »,
// found on 2026-11-12). Held here: both forms are said with the phases' names, in French and in English, and the
// refusal's sentence carries no English and none of the words the app does not say. Planted control: a gate that
// matches neither form is returned as written, so the guard sees the difference.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULES } from "../../src/http/assets.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const VIEWS = new URL("../../node_modules/runward-fleet/ui/views.js", import.meta.url);

const kept = new Map();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => ({}) };
globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
globalThis.location = { host: "app.runward.dev", hash: "#/" };
globalThis.matchMedia = () => ({ matches: true });

const served = mkdtempSync(join(tmpdir(), "rw-porte-"));
after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) {
  const p = join(served, f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href)));
}
const mod = (f) => import(pathToFileURL(join(served, `views/${f}.js`)).href);
const Lx = await mod("lexique");
const { porte } = await mod("lignes");

const RED = JSON.parse(readFileSync(new URL("../fixtures/decision/demo-renamed.check.json", import.meta.url), "utf8")).currentGate;

test("a gate refused at several steps is said with the phases' names, in French and in English", () => {
  assert.match(RED, /gate red at/, "the fixture still carries the form runward writes");
  Lx.setLang("fr");
  assert.equal(porte(RED), "étapes Plancher et Gouverner");
  assert.equal(porte("deliverables filled, gate red at Govern"), "étape Gouverner");
  assert.equal(porte("3 · Floor"), "étape 3, Plancher");
  Lx.setLang("en");
  assert.equal(porte(RED), "steps Floor and Govern");
  assert.equal(porte("3 · Floor"), "step 3, Floor");
});

test("the refusal's sentence carries no English and none of the app's banned words", () => {
  Lx.setLang("fr");
  const fr = Lx.mots().lines.refusedAt(porte(RED));
  assert.equal(fr, "Refusée par le contrôle (étapes Plancher et Gouverner) : des exigences de l'équipe ne sont pas encore prouvées.");
  assert.doesNotMatch(fr, /gate|deliverables|conformit|porte/i);
  Lx.setLang("en");
  assert.doesNotMatch(Lx.mots().lines.refusedAt(porte(RED)), /conformance|gate red|deliverables filled/i);
});

test("planted: a gate in neither form is returned as written", () => {
  Lx.setLang("fr");
  assert.equal(porte("something else"), "something else");
});
