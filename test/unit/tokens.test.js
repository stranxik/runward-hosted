// One file holds every colour value of the shell (web/tokens.css); changing the base is a change of that
// file alone. This guard reads every file the shell serves, the fleet stylesheet as served included, and
// fails on a literal colour anywhere else; a planted colour proves it sees one. It also checks that every
// custom property the stylesheets use is defined by the family structure or the runward layer, and the
// two identity bans of the product (no indigo, no tech black or cold paper).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fleetCss } from "../../src/http/assets.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const PIN = new URL("../../node_modules/runward-fleet/", import.meta.url).pathname;
const COLOUR = /#[0-9A-Fa-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|indigo|violet|gold|gray|grey|silver)\b(?=\s*[;}!])/;

/** Literal colours in a text, CSS or JS, comments and data: URLs set aside. */
export function literalColours(text) {
  const t = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1").replace(/url\("data:[^"]*"\)/g, "url()").replace(/&#\d+;/g, "").replace(/&#x[0-9a-f]+;/gi, "");
  return [...t.matchAll(new RegExp(COLOUR, "g"))].map((m) => m[0]);
}

const served = () => ({
  "web/app.css": readFileSync(`${WEB}app.css`, "utf8"),
  "web/app.js": readFileSync(`${WEB}app.js`, "utf8"),
  "web/index.html": readFileSync(`${WEB}index.html`, "utf8"),
  "web/famille.css": readFileSync(`${WEB}famille.css`, "utf8"),
  "fleet css as served": fleetCss(PIN),
});

test("no literal colour outside web/tokens.css", () => {
  const faults = Object.entries(served()).flatMap(([f, t]) => literalColours(t).map((c) => `${f}: ${c}`));
  assert.deepEqual(faults, []);
});

test("planted control: a literal colour is seen", () => {
  assert.deepEqual(literalColours(".x{ color:#191715; }"), ["#191715"]);
  assert.deepEqual(literalColours(".x{ background: rgb(1 2 3 / .5) }"), ["rgb("]);
  assert.deepEqual(literalColours('el.style.color = "red";'), []);
  assert.ok(literalColours(".x{ color:red; }").length === 1);
});

test("every custom property used is defined by the family structure or the runward layer", () => {
  const defs = new Set([...readFileSync(`${WEB}tokens.css`, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g), ...readFileSync(`${WEB}famille.css`, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set(Object.values(served()).flatMap((t) => [...t.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])));
  assert.deepEqual([...used].filter((v) => !defs.has(v)), []);
  for (const role of ["--bg", "--bg-2", "--line", "--line-2", "--text", "--text-2", "--text-3", "--bar", "--beat", "--hit", "--sans", "--mono", "--ls-h1", "--ls-h2", "--ls-h3", "--r-pill", "--r-panel", "--r-thumb", "--r-notice", "--r-win"]) assert.ok(defs.has(role), `the family contract's role ${role}`);
});

test("the tokens keep the identity: no indigo, no #0A0A0A or #FAFAFA, near-square corners", () => {
  const t = readFileSync(`${WEB}tokens.css`, "utf8");
  assert.equal(/241CC4|indigo/i.test(t), false);
  assert.equal(/#0A0A0A|#FAFAFA|#7B74FF/i.test(t), false);
  assert.match(t, /--radius:2px/);
  const all = Object.values(served()).join("\n") + t;
  assert.equal(/241CC4/i.test(all), false);
});

test("no entrance animation in the app (family rule); only the loading line loops", () => {
  const css = readFileSync(`${WEB}app.css`, "utf8");
  const anims = [...css.matchAll(/animation\s*:\s*([a-z-]+)/g)].map((m) => m[1]);
  assert.deepEqual(anims.filter((a) => a !== "none"), ["charge"]);
  assert.equal(/\.anim\b|IntersectionObserver/.test(css + readFileSync(`${WEB}app.js`, "utf8")), false);
});

test("the relevés in Departure Mono read at 12 px, the fleet views' included (author's rule)", () => {
  assert.match(readFileSync(`${WEB}tokens.css`, "utf8"), /--fs-releve:12px/);
  const css = readFileSync(`${WEB}app.css`, "utf8");
  assert.match(css, /\.rv, \.chart text\{ font-size:var\(--fs-releve\); \}/);
  const monoRules = [...css.matchAll(/\{[^}]*var\(--mono\)[^}]*\}/g)].map((m) => m[0]);
  assert.deepEqual(monoRules.filter((r) => /font-size:\s*\d/.test(r)), [], "no literal size on a mono rule");
});
