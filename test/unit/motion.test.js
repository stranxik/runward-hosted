// The motion of the shell (ADR-0027). Its values are tokens of the app's layer (web/couche-runward-app.css), not of
// the family's structure (web/famille.css, which stays at 150 to 240 ms); its rules are web/mouvement.css; its
// sequences are web/views/mouvement.js. What is held here: the tokens and their bounds; no duration written in a
// stylesheet; no property of layout animated; every animation that starts ends (its guard forces it); under reduced
// motion no transform is animated; the blocks of a screen arrive once, on a navigation forward only. Each guard has
// its planted control.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULES } from "../../src/http/assets.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const VIEWS = new URL("../../node_modules/runward-fleet/ui/views.js", import.meta.url);
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");
const layer = () => strip(readFileSync(`${WEB}couche-runward-app.css`, "utf8"));
const famille = () => strip(readFileSync(`${WEB}famille.css`, "utf8"));
const sheets = () => ({ "web/app.css": strip(readFileSync(`${WEB}app.css`, "utf8")), "web/mouvement.css": strip(readFileSync(`${WEB}mouvement.css`, "utf8")) });

// ---- the engine, run as the app serves it, over a page reduced to what it touches. It is set up before the first
// case is declared: a case declared earlier would run, and the file's after hook with it, while these imports wait
const reduced = { matches: false };
const tokensOf = Object.fromEntries([...strip(readFileSync(`${WEB}couche-runward-app.css`, "utf8")).matchAll(/(--mv-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
globalThis.window = globalThis;
globalThis.document = { documentElement: { classList: { add() {}, remove() {}, toggle() {} }, style: {} }, querySelector: () => null, querySelectorAll: () => [], getElementById: () => ({ style: {} }) };
globalThis.matchMedia = () => reduced;
globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => tokensOf[n] ?? "" });
const served = mkdtempSync(join(tmpdir(), "rw-motion-"));
test.after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) { const p = join(served, f); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href))); }
const M = await import(pathToFileURL(join(served, "views/mouvement.js")).href);
const { motionOf } = await import(pathToFileURL(join(served, "views/router.js")).href);


// ---- the tokens
const token = (css, name) => (new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css) ?? [])[1]?.trim();
const ms = (v) => (/^([\d.]+)ms$/.exec(v ?? "") ? parseFloat(v) : /^([\d.]+)s$/.exec(v ?? "") ? parseFloat(v) * 1000 : NaN);
/** What is wrong with the motion tokens of a layer and a family structure; [] when they hold. */
export function tokenFaults(layerCss, familleCss) {
  const f = [];
  const d = Object.fromEntries(["--mv-d1", "--mv-d2", "--mv-d3", "--mv-ecran", "--mv-pas", "--mv-seuil"].map((n) => [n, ms(token(layerCss, n))]));
  for (const [n, v] of Object.entries(d)) if (!Number.isFinite(v)) f.push(`the layer does not define ${n} as a duration`);
  if (f.length) return f;
  if (!(d["--mv-d1"] < d["--mv-d2"] && d["--mv-d2"] < d["--mv-d3"])) f.push("the three durations are not in order");
  if (d["--mv-d1"] < 150) f.push("an answer under 150 ms");
  if (d["--mv-d3"] > 320) f.push(`a block moves for ${d["--mv-d3"]} ms: over 320 ms`);
  if (d["--mv-ecran"] > 420) f.push(`a change of screen takes ${d["--mv-ecran"]} ms: over 420 ms`);
  if (d["--mv-ecran"] <= d["--mv-d3"]) f.push("the change of screen is not the longest");
  if (d["--mv-seuil"] !== 300) f.push("a loading shows something before, or after, 300 ms");
  const curves = [...layerCss.matchAll(/--mv-[a-z0-9-]+\s*:\s*(cubic-bezier\([^)]*\))/g)].map((m) => m[1]);
  if (curves.length !== 1) f.push(`${curves.length} curves for the motion: one is the rule`);
  else { const p = curves[0].slice(curves[0].indexOf("(") + 1).match(/-?[\d.]+/g).map(Number); if (p[1] > 1 || p[3] > 1 || p[1] < 0 || p[3] < 0) f.push("the curve overshoots"); }
  for (const n of ["--mv-monte", "--mv-pose", "--mv-leve", "--mv-feuille"]) { const v = parseFloat(token(layerCss, n)); if (!(v > 0 && v <= 10)) f.push(`${n} is not a distance of 10 px at most`); }
  // the family's structure is not changed for all its products: it holds no token of this motion, and stays at 150 to 240 ms
  if (/--mv-/.test(familleCss)) f.push("a motion token of runward's in the family's structure");
  if (ms(token(familleCss, "--dur-ui")) !== 150 || ms(token(familleCss, "--dur-max")) !== 240) f.push("the family's durations changed");
  return f;
}
test("the motion tokens live in the app's layer: 160, 240 and 320 ms, 420 ms for a change of screen, one curve without overshoot, 10 px at most; the family's structure keeps its 150 to 240 ms", () => {
  assert.deepEqual(tokenFaults(layer(), famille()), []);
  assert.equal(token(layer(), "--mv-d1"), "160ms"); assert.equal(token(layer(), "--mv-d2"), "240ms"); assert.equal(token(layer(), "--mv-d3"), "320ms"); assert.equal(token(layer(), "--mv-ecran"), "420ms");
  // planted controls
  const L = layer(), F = famille();
  assert.deepEqual(tokenFaults(L.replace("--mv-d3:320ms", "--mv-d3:480ms"), F), ["a block moves for 480 ms: over 320 ms", "the change of screen is not the longest"]);
  assert.deepEqual(tokenFaults(L.replace("--mv-ecran:420ms", "--mv-ecran:600ms"), F), ["a change of screen takes 600 ms: over 420 ms"]);
  assert.deepEqual(tokenFaults(L.replace("--mv-doux:cubic-bezier(.22,.61,.36,1)", "--mv-doux:cubic-bezier(.34,1.56,.64,1)"), F), ["the curve overshoots"]);
  assert.deepEqual(tokenFaults(L.replace("--mv-seuil:300ms", "--mv-seuil:100ms"), F), ["a loading shows something before, or after, 300 ms"]);
  assert.deepEqual(tokenFaults(L, `${F}\n:root{ --mv-d1:160ms; }`), ["a motion token of runward's in the family's structure"]);
  assert.deepEqual(tokenFaults(L.replace("--mv-pas:35ms;", ""), F), ["the layer does not define --mv-pas as a duration"]);
});

// ---- the stylesheets: no duration written in them, no property of layout animated
const PAINT_ONLY = new Set(["transform", "opacity", "background-color", "color", "box-shadow", "background-size", "visibility"]);
/** What a stylesheet animates against the rules: a duration that is not a token, a property that is not paint only. */
export function sheetFaults(name, css) {
  const f = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    for (const d of m[2].matchAll(/(?:^|;)\s*(transition|animation|animation-duration|transition-duration|transition-delay)\s*:\s*([^;]+)/g)) {
      const [prop, value] = [d[1], d[2].trim()];
      if (value === "none" || value.startsWith("none ")) continue;
      // a time written as a number (but 0s, which is no time) is a value outside the layer
      for (const t of value.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)) if (parseFloat(t[1]) !== 0) f.push(`${name}: ${sel}: ${prop} holds ${t[0]}, not a token`);
      if (prop === "transition") for (const part of value.split(/,(?![^(]*\))/)) { const p = part.trim().split(/\s+/)[0]; if (!PAINT_ONLY.has(p)) f.push(`${name}: ${sel}: transition of ${p}, not a paint-only property`); }
    }
  }
  for (const k of css.matchAll(/@keyframes\s+([a-z-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) for (const d of k[2].matchAll(/(?:\{|;)\s*([a-z-]+)\s*:/g)) if (!["transform", "opacity", "background-position"].includes(d[1])) f.push(`${name}: @keyframes ${k[1]} animates ${d[1]}`);
  return f;
}
test("no stylesheet of the shell writes a duration (each is a token of the layer) or animates a property of layout: transform and opacity, and the paint of a hover", () => {
  const S = sheets();
  assert.ok((S["web/mouvement.css"].match(/var\(--mv-/g) ?? []).length >= 20, "the guard must see the rules of the motion");
  for (const [name, css] of Object.entries(S)) assert.deepEqual(sheetFaults(name, css), [], name);
  // planted controls: a duration written, a layout property in a transition, a layout property in keyframes
  assert.deepEqual(sheetFaults("x", ".a{ transition:opacity 200ms ease; }"), ["x: .a: transition holds 200ms, not a token"]);
  assert.deepEqual(sheetFaults("x", ".a{ transition:height var(--mv-d2) var(--mv-doux), opacity var(--mv-d1); }"), ["x: .a: transition of height, not a paint-only property"]);
  assert.deepEqual(sheetFaults("x", ".a{ animation:x 2s infinite; }"), ["x: .a: animation holds 2s, not a token"]);
  assert.deepEqual(sheetFaults("x", "@keyframes x{ from{ width:0; } to{ width:10px; } }"), ["x: @keyframes x animates width", "x: @keyframes x animates width"]);
  assert.deepEqual(sheetFaults("x", ".a{ transition:visibility 0s linear var(--mv-d2); }"), []);
});

/** An element whose animations never end by themselves: only finish() or cancel() ends them. */
function stuckElement() {
  const calls = [];
  return { calls, animate(frames, opts) { let done; const a = { frames, opts, playState: "running", finished: new Promise((r) => { done = r; }), finish() { a.playState = "finished"; done(); }, cancel() { a.playState = "idle"; done(); } }; calls.push(a); return a; } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test("the engine reads its values from the layer and writes none: the tokens as the layer says them", () => {
  const t = M.jetons();
  assert.deepEqual([t.d1, t.d2, t.d3, t.ecran, t.pas, t.seuil, t.monte, t.pose, t.tenue, t.eclat], [160, 240, 320, 420, 35, 300, 8, 6, 1600, 1800]);
  assert.equal(t.doux, "cubic-bezier(.22,.61,.36,1)");
});

test("every animation that starts ends: one that never finishes by itself is forced to its end by its guard, its duration and its delay and 300 ms after it started", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    reduced.matches = false;
    const el = stuckElement();
    let ended = false;
    M.anim(el, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 320, delay: 100 }).then(() => { ended = true; });
    assert.equal(el.calls.length, 1); assert.equal(el.calls[0].opts.fill, "backwards", "the state at rest is the final state");
    assert.equal(M.enCours(), 1);
    mock.timers.tick(320 + 100 + M.GARDE - 1); await flush();
    assert.equal(ended, false); assert.equal(el.calls[0].playState, "running", "not before its guard");
    mock.timers.tick(1); await flush();
    assert.equal(el.calls[0].playState, "finished", "the guard took it to its end");
    assert.equal(ended, true); assert.equal(M.enCours(), 0, "nothing is left on the way");
    // planted control: the same animation with a guard that never comes stays on the way, and the count sees it
    const stuck = stuckElement();
    M.anim(stuck, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, garde: 1e9 });
    mock.timers.tick(320 + M.GARDE + 10_000); await flush();
    assert.equal(stuck.calls[0].playState, "running"); assert.equal(M.enCours(), 1, "the check that fails if one is stuck sees it");
    // a new gesture takes everything that runs to its end, at once
    M.finirTout(); await flush();
    assert.equal(stuck.calls[0].playState, "finished"); assert.equal(M.enCours(), 0);
  } finally { mock.timers.reset(); }
});

test("reduced motion: no transform is animated; what only moved does not play, what also faded keeps its fade, 160 ms at most and without delay", async () => {
  reduced.matches = true;
  try {
    assert.equal(M.reduit(), true);
    const el = stuckElement();
    await M.anim(el, [{ transform: "translateY(-40px)" }, { transform: "none" }], { duration: 320 });
    assert.equal(el.calls.length, 0, "a move alone does not play");
    M.anim(el, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 320, delay: 200 });
    assert.equal(el.calls.length, 1);
    assert.deepEqual(el.calls[0].frames, [{ opacity: 0 }, { opacity: 1 }], "the fade without its transform");
    assert.equal(el.calls[0].opts.duration, 160); assert.equal(el.calls[0].opts.delay, 0);
    M.finirTout();
    // planted control: the same frames with motion allowed keep their transform
    reduced.matches = false;
    const moving = stuckElement();
    M.anim(moving, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 320 });
    assert.equal(moving.calls[0].frames[0].transform, "translateY(8px)"); assert.equal(moving.calls[0].opts.duration, 320);
    M.finirTout();
    assert.equal(M.sansTransform([{ clipPath: "inset(0)" }, { clipPath: "inset(1px)" }]), null, "the one exception, the clip-path of the fold, does not play either");
  } finally { reduced.matches = false; }
});

test("the blocks of a screen arrive once, on a navigation forward: never on the same address painted again (a refresh, a re-render, a check that arrives), never on a way back", () => {
  assert.deepEqual(motionOf(null, "#/", []), { transition: true, arrival: true, back: false }, "the first screen");
  assert.deepEqual(motionOf({ h: "#/" }, "#/decision/a", ["#/"]), { transition: true, arrival: true, back: false }, "forward");
  assert.deepEqual(motionOf({ h: "#/decision/a" }, "#/decision/a", ["#/", "#/decision/a"]), { transition: false, arrival: false, back: false }, "the same address: nothing moves");
  assert.deepEqual(motionOf({ h: "#/decision/a" }, "#/", ["#/", "#/decision/a"]), { transition: true, arrival: false, back: true }, "a way back: carried, no arrival");
  assert.deepEqual(motionOf({ h: "#/decision/a" }, "#/envois", ["#/", "#/decision/a"]), { transition: true, arrival: true, back: false });
  // the language is switched by relang, which asks for no arrival; the source says so
  const router = readFileSync(`${WEB}views/router.js`, "utf8");
  assert.match(router, /export const relang = \(\) => ecran\(\(\) => rerender\(\), \{ arrivee: false, vite: true/);
  assert.match(router, /await ecran\(\(\) => paint\(view\), \{ arrivee: m\.arrival, vite: waited, app \}\);/);
});
