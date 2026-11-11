// One file holds every colour value of the shell: web/couche-runward-app.css, the app's layer (ADR "app
// layer"), loaded after web/famille.css (the family's structure). This guard reads every file the shell
// serves, the fleet stylesheet as served included, and fails on a literal colour anywhere else. It audits
// the layer itself against the family's contract (jetons-famille) in both themes, light by default and dark
// as an option: every role defined, the banned values absent (indigo, #241CC4, the tech black #0A0A0A, the
// cold paper #FAFAFA, the violet #7B74FF), no green at all, the secondary inks at 4.5:1 at least and the
// strokes at 3:1 at least on both surfaces. Each audit is proven by a planted control: a layer broken on
// purpose must be refused, for the reason planted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fleetCss, FONTS, MODULES, SITE_FILES } from "../../src/http/assets.js";
import { renderSite, siteData } from "../../src/http/site.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const PIN = new URL("../../node_modules/runward-fleet/", import.meta.url).pathname;
const LAYER = "couche-runward-app.css";
const COLOUR = /#[0-9A-Fa-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|indigo|violet|gold|gray|grey|silver)\b(?=\s*[;}!])/;

/** Literal colours in a text, CSS or JS, comments and data: URLs set aside. */
export function literalColours(text) {
  const t = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1").replace(/url\("data:[^"]*"\)/g, "url()").replace(/&#\d+;/g, "").replace(/&#x[0-9a-f]+;/gi, "");
  return [...t.matchAll(new RegExp(COLOUR, "g"))].map((m) => m[0]);
}

const layer = () => readFileSync(`${WEB}${LAYER}`, "utf8");
/** The shell's scripts, every module of the served list (web/app.js and web/views/), by their path. */
const scripts = () => Object.fromEntries(MODULES.map((f) => [`web/${f}`, readFileSync(`${WEB}${f}`, "utf8")]));
const served = () => ({
  "web/app.css": readFileSync(`${WEB}app.css`, "utf8"),
  ...scripts(),
  "web/index.html": readFileSync(`${WEB}index.html`, "utf8"),
  "web/famille.css": readFileSync(`${WEB}famille.css`, "utf8"),
  "fleet css as served": fleetCss(PIN),
});
/** The public site's files as served (ADR-0022): its stylesheet and scripts, and each page as the server renders it. */
const siteServed = () => {
  const links = { famille: "/assets/famille.x.css", couche: "/assets/couche-runward-app.x.css", css: "/assets/site.x.css", aiguillage: "/assets/aiguillage.x.js", js: "/assets/site.x.js" };
  return {
    ...Object.fromEntries(SITE_FILES.map(([f]) => [`web/site/${f}`, readFileSync(`${WEB}site/${f}`, "utf8")])),
    ...Object.fromEntries(renderSite({ links, data: siteData() }).pages.map(([p, html]) => [`the page ${p}`, html])),
  };
};

// ---- the audit of a layer, written once and run on the real layer and on planted ones

/** The custom properties of the first rule whose selector is exactly `selector` (comments set aside). */
function block(css, selector) {
  const t = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(t);
  return m ? Object.fromEntries([...m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()])) : null;
}
/** A value with its var() references resolved in `vars` (a few levels are enough for a layer). */
function resolve(value, vars, depth = 0) {
  if (depth > 8 || value === undefined) return value;
  return value.replace(/var\((--[a-z0-9-]+)\)/g, (_, n) => resolve(vars[n], vars, depth + 1) ?? "");
}
const hex = (v) => (/^#([0-9a-f]{6})$/i.exec(String(v).trim()) ?? [])[1];
function luminance(h) {
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [luminance(hex(a)), luminance(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Hue in degrees and saturation (HSL) of a #rrggbb colour. */
function hueSat(h) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return { hue: 0, sat: 0 };
  const sat = d / (1 - Math.abs(2 * l - 1));
  const hue = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { hue: (hue + 360) % 360, sat };
}

// the contract of a product's layer (jetons-famille, SKILL.md), and what this app adds
const COLOUR_ROLES = ["--bg", "--bg-2", "--line", "--line-2", "--text", "--text-2", "--text-3", "--bar", "--beat", "--hit"];
const OTHER_ROLES = ["--sans", "--mono", "--ls-h1", "--ls-h2", "--ls-h3", "--r-pill", "--r-panel", "--r-thumb", "--r-notice", "--r-win"];
const STATES = ["--refus", "--niveau", "--direct"]; // refused by the check, required level not met, the live state
const THEMES = { light: ":root", dark: ':root[data-theme="dark"]' };
const BANNED = /241CC4|indigo|#0A0A0A|#FAFAFA|#7B74FF/i;

/** Every fault of a layer, as short sentences; [] when it holds. */
export function auditLayer(css) {
  const faults = [];
  const base = block(css, THEMES.light);
  const dark = block(css, THEMES.dark);
  if (!base) return ["no :root block (the light theme, the default)"];
  if (!dark) return ['no :root[data-theme="dark"] block (the dark option)'];
  const themes = { light: base, dark: { ...base, ...dark } };
  for (const r of [...COLOUR_ROLES, ...STATES]) if (!(r in dark)) faults.push(`dark: ${r} is not set, the dark theme would show the light value`);
  for (const [name, vars] of Object.entries(themes)) {
    const v = (r) => resolve(vars[r], vars);
    for (const r of [...COLOUR_ROLES, ...OTHER_ROLES, ...STATES]) if (!vars[r]) faults.push(`${name}: the role ${r} is missing`);
    for (const r of [...COLOUR_ROLES, ...STATES]) if (vars[r] && !hex(v(r))) faults.push(`${name}: ${r} is not a #rrggbb value (${v(r)})`);
    if (faults.length) continue;
    for (const surface of ["--bg", "--bg-2"]) {
      const need = (r, min) => { const c = contrast(v(r), v(surface)); if (c < min) faults.push(`${name}: ${r} on ${surface} is ${c.toFixed(2)}:1, under ${min}:1`); };
      need("--text", 7);
      need("--text-2", 4.5); need("--text-3", 4.5);
      need("--bar", 3); need("--hit", 3);
      for (const s of STATES) need(s, 3);
    }
  }
  for (const m of css.matchAll(new RegExp(BANNED, "gi"))) faults.push(`a banned value: ${m[0]}`); // comments included, as the grep of the identity rule
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/#([0-9a-f]{6})\b/gi)) {
    const { hue, sat } = hueSat(m[1]);
    if (sat > 0.2 && hue >= 75 && hue <= 165) faults.push(`a green: #${m[1]} (hue ${Math.round(hue)})`);
  }
  if (/\bgreen\b|\blime\b|\bolive\b|\bteal\b/i.test(css.replace(/\/\*[\s\S]*?\*\//g, ""))) faults.push("a green keyword");
  return faults;
}

test("no literal colour outside web/couche-runward-app.css", () => {
  const faults = Object.entries(served()).flatMap(([f, t]) => literalColours(t).map((c) => `${f}: ${c}`));
  assert.deepEqual(faults, []);
});

test("no literal colour in the public site either: its stylesheet, its scripts and its pages take every colour from the layer (ADR-0022)", () => {
  const site = siteServed();
  assert.equal(Object.keys(site).length, SITE_FILES.length + 9, "the guard must see the site's three files and its nine pages");
  const faults = Object.entries(site).flatMap(([f, t]) => literalColours(t).map((c) => `${f}: ${c}`));
  assert.deepEqual(faults, []);
});

test("every custom property the public site uses is defined by the family's structure, the layer, the site's stylesheet, or set by its pages and its script", () => {
  const site = siteServed();
  const css = site["web/site/site.css"];
  const defs = new Set([layer(), readFileSync(`${WEB}famille.css`, "utf8"), css, ...Object.values(site)].flatMap((t) => [...t.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])));
  for (const t of Object.values(site)) for (const m of t.matchAll(/setProperty\("(--[a-z0-9-]+)"/g)) defs.add(m[1]);
  const used = new Set(Object.values(site).flatMap((t) => [...t.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])));
  assert.ok(used.size >= 40, "the guard must see the site's real uses");
  assert.deepEqual([...used].filter((v) => !defs.has(v)), []);
  // the site's stylesheet holds no theme of its own: every value that changes with the theme is the layer's
  assert.equal(/:root\[data-theme="dark"\]\s*\{/.test(css.replace(/@media print\{[\s\S]*?\n\}/, "")), false, "no dark block in site.css outside its print rules");
});

test("planted control: a literal colour is seen", () => {
  assert.deepEqual(literalColours(".x{ color:#191715; }"), ["#191715"]);
  assert.deepEqual(literalColours(".x{ background: rgb(1 2 3 / .5) }"), ["rgb("]);
  assert.deepEqual(literalColours('el.style.color = "red";'), []);
  assert.ok(literalColours(".x{ color:red; }").length === 1);
});

test("every custom property used is defined by the family structure or the app's layer", () => {
  const defs = new Set([...layer().matchAll(/(--[a-z0-9-]+)\s*:/g), ...readFileSync(`${WEB}famille.css`, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set(Object.values(served()).flatMap((t) => [...t.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])));
  assert.deepEqual([...used].filter((v) => !defs.has(v)), []);
});

test("the layer fills the family's contract in both themes, with the contrasts measured, no banned value and no green", () => {
  assert.deepEqual(auditLayer(layer()), []);
});

test("light is the default theme: the page starts light and the layer does not follow the system's dark preference", () => {
  assert.match(readFileSync(`${WEB}index.html`, "utf8"), /<html lang="fr" data-theme="light">/);
  assert.equal(/prefers-color-scheme/.test(layer()), false);
  const flat = layer().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
  assert.match(flat, /(^|\})(@font-face\{[^}]*\})*:root\{[^}]*color-scheme:light;/, "the :root block is the light theme");
  assert.match(flat, /:root\[data-theme="dark"\]\{[^}]*color-scheme:dark;/, "dark is an option set by data-theme");
});

test("planted controls: the audit refuses a layer broken on purpose, for the reason planted", () => {
  const good = layer();
  const swap = (from, to) => { assert.ok(good.includes(from), `the planted control needs ${from} in the layer`); return good.replace(from, to); };
  const has = (css, re) => auditLayer(css).some((f) => re.test(f));
  // a secondary ink too pale, in light then in dark
  assert.ok(has(swap("--text-3:#62626c", "--text-3:#9a9aa3"), /^light: --text-3 on --bg is .* under 4\.5:1/));
  assert.ok(has(swap("--text-2:#a1a1a1", "--text-2:#55555c"), /^dark: --text-2 on --bg is .* under 4\.5:1/));
  // a stroke under 3:1, and a state colour under 3:1 on the second surface
  assert.ok(has(swap("--bar:#7e7e88", "--bar:#c4c4ca"), /^light: --bar on --bg-2 is .* under 3:1/));
  assert.ok(has(swap("--niveau:#c18505", "--niveau:#3a2800"), /^dark: --niveau on --bg is .* under 3:1/));
  // a role missing in dark, a contract role missing altogether
  assert.ok(has(swap("--beat:#2a2a2e;", ""), /^dark: --beat is not set/));
  assert.ok(has(swap("--r-notice:12px; ", ""), /^light: the role --r-notice is missing/));
  // each banned value, and a green
  assert.ok(has(swap("--bg-2:#0c0c0e", "--bg-2:#0a0a0a"), /banned value: #0a0a0a/i));
  assert.ok(has(swap("--bg-2:#f7f7f8", "--bg-2:#FAFAFA"), /banned value: #FAFAFA/));
  assert.ok(has(swap("--direct:#1a84b6", "--direct:#241CC4"), /banned value: 241CC4/));
  assert.ok(has(`${good}\n.x{ --x:indigo; }`, /banned value: indigo/));
  assert.ok(has(`${good}\n.x{ --x:#7B74FF; }`, /banned value: #7B74FF/));
  assert.ok(has(swap("--direct:#3c9cd0", "--direct:#2f9e44"), /a green: #2f9e44/));
  assert.ok(has(`${good}\n.x{ --ok:green; }`, /a green keyword/));
  // and the real layer is not refused by any of these audits
  assert.deepEqual(auditLayer(good), []);
});

test("planted control: the contrast measure is the WCAG one", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#767676", "#ffffff").toFixed(2), "4.54");
});

test("every font the layer declares is in the served list and in web/fonts, with its licence", () => {
  const urls = [...layer().matchAll(/url\(\/assets\/fonts\/([^)]+)\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 5);
  const listed = new Set(FONTS.map(([f]) => f));
  for (const u of urls) { assert.ok(listed.has(u), `${u} in the served list`); assert.ok(existsSync(`${WEB}fonts/${u}`), `${u} in web/fonts`); }
  assert.ok(listed.has("OFL.txt"));
  assert.match(readFileSync(`${WEB}fonts/OFL.txt`, "utf8"), /SIL Open Font License, Version 1\.1/);
});

test("no entrance animation in the app's stylesheet; two loops only, the loading line and the drift of the haze behind the sign-in (ADR-0025), both stopped under reduced motion", () => {
  const css = readFileSync(`${WEB}app.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const anims = [...css.matchAll(/animation\s*:\s*([a-z-]+)/g)].map((m) => m[1]).filter((a) => a !== "none");
  assert.deepEqual([...new Set(anims)].sort(), ["charge", "nue-a", "nue-b", "nue-c", "pts"]);
  // every one of them loops (an entrance plays once), and each is a rule of the scene or of the loading line
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*animation\s*:\s*(?!none)[^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  assert.ok(rules.length >= 6, "the guard must see the rules that animate");
  assert.deepEqual(rules.filter((r) => !/\binfinite\b/.test(r.body)).map((r) => r.sel), [], "no animation that plays once");
  assert.deepEqual(rules.filter((r) => !/^\.hero-e \.nue i|^body\[data-scene="pleine"\] \.scn \.points$|^\.charge::after$/.test(r.sel)).map((r) => r.sel), [], "the haze of the sign-in and the loading line only");
  // the drift lives on the sign-in alone: behind a screen of data the haze does not move
  assert.equal(/\.scn \.nue i\{[^}]*animation/.test(css), false);
  // reduced motion stops both loops
  const reduced = /@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  assert.match(reduced, /\.nue i, \.points\{ animation:none !important; \}/);
  assert.match(reduced, /\.charge::after\{ animation:none;/);
  // planted controls: an entrance (it plays once) and a drift behind a screen of data are both seen
  const once = [...`${css}\n.tete{ animation:monte 320ms 1; }`.matchAll(/([^{}]+)\{([^{}]*animation\s*:\s*(?!none)[^{}]*)\}/g)].filter((m) => !/\binfinite\b/.test(m[2])).map((m) => m[1].trim());
  assert.deepEqual(once, [".tete"]);
  assert.equal(/\.scn \.nue i\{[^}]*animation/.test(`${css}\n.scn .nue i{ animation:nue-a 24s infinite; }`), true);
  assert.equal(/\.anim\b/.test(css + Object.values(scripts()).join("\n")), false);
});

test("the relevés in the mono read at 12 px, the fleet views' included (author's rule)", () => {
  assert.match(layer(), /--fs-releve:12px/);
  const css = readFileSync(`${WEB}app.css`, "utf8");
  assert.match(css, /\.rv, \.chart text\{ font-size:var\(--fs-releve\); \}/);
  const monoRules = [...css.matchAll(/\{[^}]*var\(--mono\)[^}]*\}/g)].map((m) => m[0]);
  assert.deepEqual(monoRules.filter((r) => /font-size:\s*\d/.test(r)), [], "no literal size on a mono rule");
});
