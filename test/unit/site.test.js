// The public site (ADR-0022): the landing at / and its eight pages, served by the app itself on a real socket. Each
// page answers 200 with the app's own headers (the content security policy unchanged, no-store, text/html); every
// file a page names is a file of the closed list, served with its media type and named by its digest; no page holds
// an inline script, an inline style element, an event handler or a javascript: address; the site's scripts write no
// HTML (no innerHTML, no other sink) and call no network; the contact is a mailto: to one address and posts nothing;
// the texts served are the 324 validated ones, text for text; the data comes from one file; the shell keeps its
// addresses (/app, /lien, /#/...). Each guard has a planted control.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { githubVerifier } from "../../src/adapters/oidc/github.js";
import { FONTS, SITE_FILES } from "../../src/http/assets.js";
import { SITE_PAGES, renderSite, siteData, textsOf, textsTable } from "../../src/http/site.js";
import { fakeAuthn, testJwk, sha, SEND_SHA } from "../helpers.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const PATHS = ["/", "/pourquoi", "/comment", "/pour-qui", "/formats", "/donnees", "/stand", "/releve", "/mentions"];
const CONTACT = "thibaultsouris@runward.dev";
let c, base;
before(async () => {
  const clock = manualClock(Date.now());
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: "https://app.runward.dev", RW_EXTRA_HOSTS: "127.0.0.1", RW_COMMIT: "c0ffee", RW_IMAGE: "sha256:abc", RW_SEND_WORKFLOW_SHAS: SEND_SHA });
  const jwksFetch = async () => new Response(JSON.stringify({ keys: [testJwk()] }));
  c = compose(config, { clock, log: silentLog, store: memoryStore({ clock }), objects: memoryObjects(), authn: fakeAuthn(), verifier: githubVerifier({ fetch: jwksFetch, clock }) });
  await new Promise((r) => c.http.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${c.http.server.address().port}`;
});
after(() => new Promise((r) => c.http.server.close(r)));
const get = (path, init) => fetch(`${base}${path}`, init);
const pages = async () => Object.fromEntries(await Promise.all(PATHS.map(async (p) => [p, await (await get(p)).text()])));

// ---- what a page may hold, written once and run on the served pages and on planted ones

/** Every way a page could run a script or a style of its own, rather than a file of the closed list. */
export function inlineFaults(html) {
  const faults = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\ssrc="\/assets\/[^"]+"/.test(m[1])) faults.push(`a script that is not a file of the list: ${m[0].slice(0, 80)}`);
    if (m[2].trim()) faults.push("a script with inline content");
  }
  if (/<style\b/i.test(html)) faults.push("an inline style element");
  for (const m of html.matchAll(/<[a-z][^>]*\son[a-z]+\s*=/gi)) faults.push(`an event handler attribute: ${m[0].slice(0, 80)}`);
  if (/(?:href|src|action|formaction)\s*=\s*"\s*javascript:/i.test(html)) faults.push("a javascript: address");
  for (const m of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)) if (!/\shref="\/assets\/[^"]+"/.test(m[0])) faults.push(`a stylesheet that is not a file of the list: ${m[0]}`);
  // style attributes are allowed by the policy (style-src-attr 'unsafe-inline'); the site sets only these
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) if (!/^(--i:\d+|margin-(top|bottom):0)$/.test(m[1])) faults.push(`a style attribute off the known set: ${m[1]}`);
  return faults;
}

/** What the site's scripts may not do: write HTML from a string, evaluate a string, call the network, set a cookie. */
export function scriptFaults(js) {
  const t = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
  const sinks = [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /DOMParser/, /createContextualFragment/, /\bsrcdoc\b/, /\beval\s*\(/, /new\s+Function\b/, /setTimeout\(\s*["'`]/, /setInterval\(\s*["'`]/,
    /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /document\.cookie/, /trustedTypes/];
  return sinks.filter((re) => re.test(t)).map((re) => `a forbidden use: ${re.source}`);
}

test("planted controls: an inline script, a style element, a handler, a javascript: address, a foreign stylesheet, an odd style attribute", () => {
  assert.deepEqual(inlineFaults('<script src="/assets/site.0123456789abcdef.js"></script><link rel="stylesheet" href="/assets/x.css"><i style="--i:3"></i>'), []);
  assert.equal(inlineFaults("<script>alert(1)</script>").length, 2);
  assert.match(inlineFaults('<script src="https://cdn.example/x.js"></script>')[0], /not a file of the list/);
  assert.match(inlineFaults("<style>p{}</style>")[0], /inline style element/);
  assert.match(inlineFaults('<button onclick="x()">x</button>')[0], /event handler/);
  assert.match(inlineFaults('<a href="javascript:x()">x</a>')[0], /javascript:/);
  assert.match(inlineFaults('<link rel="stylesheet" href="https://fonts.example/x.css">')[0], /stylesheet that is not/);
  assert.match(inlineFaults('<p style="color:red">x</p>')[0], /style attribute off/);
});

test("planted controls: each forbidden use in a script is seen, and a comment that names one is not", () => {
  for (const bad of ["el.innerHTML = s;", "el.outerHTML = s;", "el.insertAdjacentHTML('beforeend', s);", "document.write(s);", "new DOMParser().parseFromString(s, 'text/html');",
    "range.createContextualFragment(s);", "frame.srcdoc = s;", "eval(s);", "new Function(s);", "setTimeout('x()', 1);", "fetch('/x');", "new XMLHttpRequest();", "navigator.sendBeacon('/x');", "document.cookie = 'a=b';", "trustedTypes.createPolicy('x', {});"]) {
    assert.equal(scriptFaults(bad).length, 1, bad);
  }
  assert.deepEqual(scriptFaults("/* never innerHTML, never fetch() */\nel.replaceChildren(document.importNode(t.content, true)); // no innerHTML\n"), []);
});

test("every page answers 200 with the app's headers: the same content security policy, no-store, text/html; HEAD has no body", async () => {
  const csp = (await get("/app")).headers.get("content-security-policy");
  assert.ok(csp.includes("script-src 'self'") && csp.includes("style-src-elem 'self'") && csp.includes("require-trusted-types-for 'script'") && csp.includes("trusted-types runward"));
  for (const p of [...PATHS, "/index.html"]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8", p);
    assert.equal(r.headers.get("cache-control"), "no-store", p);
    assert.equal(r.headers.get("content-security-policy"), csp, `${p}: the policy is the app's, unchanged`);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", p);
    assert.equal(r.headers.get("referrer-policy"), "no-referrer", p);
    assert.match(r.headers.get("runward-request-id"), /^r-[0-9a-f]{12}$/, p);
    const h = await get(p, { method: "HEAD" });
    assert.equal(h.status, 200, p);
    assert.equal((await h.arrayBuffer()).byteLength, 0, `${p}: HEAD has no body`);
  }
  assert.equal(await (await get("/index.html")).text(), await (await get("/")).text(), "/index.html is the landing");
  assert.deepEqual(SITE_PAGES.map(([p]) => p).sort(), [...PATHS].sort(), "the nine pages, and only these");
});

test("no page holds an inline script, an inline style element, an event handler or a javascript: address", async () => {
  for (const [p, html] of Object.entries(await pages())) assert.deepEqual(inlineFaults(html), [], p);
});

test("every file a page names is a file of the closed list, served with its media type and named by its digest; the shell's own files for the structure and the layer, the same fonts", async () => {
  const shell = await (await get("/app")).text();
  const shellCss = [...shell.matchAll(/href="(\/assets\/(?:famille|couche-runward-app)\.[0-9a-f]{16}\.css)"/g)].map((m) => m[1]);
  assert.equal(shellCss.length, 2);
  const named = new Set();
  for (const [p, html] of Object.entries(await pages())) {
    const refs = [...html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)].map((m) => m[1]).filter((u) => u.startsWith("/assets/"));
    assert.deepEqual(refs.slice(0, 2).length ? refs.filter((u) => u.endsWith(".css")).slice(0, 2) : [], shellCss, `${p}: the structure then the layer, the shell's very files`);
    for (const u of refs) named.add(u);
    // nothing loaded from another origin: no script, stylesheet or image of a third party
    assert.equal(/<(?:script|link|img|iframe)\b[^>]*(?:src|href)="(?:https?:)?\/\//i.test(html), false, p);
  }
  const expected = ["famille", "couche-runward-app", ...SITE_FILES.map(([f]) => f.split(".")[0])];
  assert.deepEqual([...named].map((u) => u.replace(/^\/assets\/([a-z-]+)\.[0-9a-f]{16}\.(css|js)$/, "$1")).sort(), [...expected].sort(), "five files: the structure, the layer and the site's three");
  for (const u of named) {
    const r = await get(u);
    assert.equal(r.status, 200, u);
    assert.match(r.headers.get("content-type"), u.endsWith(".css") ? /^text\/css; charset=utf-8$/ : /^text\/javascript; charset=utf-8$/, u);
    assert.match(r.headers.get("cache-control"), /immutable/, u);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.equal(u.slice(u.lastIndexOf(".", u.lastIndexOf(".") - 1) + 1, u.lastIndexOf(".")), sha(bytes).slice(0, 16), `${u}: named by its digest`);
  }
  for (const [f] of SITE_FILES) {
    const u = [...named].find((x) => x.startsWith(`/assets/${f.split(".")[0]}.`) && x.endsWith(`.${f.split(".")[1]}`));
    assert.equal(sha(Buffer.from(await (await get(u)).arrayBuffer())), sha(readFileSync(`${WEB}site/${f}`)), `${f} byte for byte`);
  }
  // the fonts are the app's: the layer's faces, no other font file anywhere in the site
  const css = readFileSync(`${WEB}site/site.css`, "utf8");
  assert.equal(/@font-face|url\([^)]*\.woff2?\)/.test(css), false, "the site declares no font of its own");
  assert.ok(FONTS.some(([f]) => f === "Geist-Regular.woff2"));
});

test("the closed list of the site is its scripts and stylesheets on disk: none off the list, none missing", () => {
  const onDisk = readdirSync(`${WEB}site`).filter((f) => /\.(js|css)$/.test(f)).sort();
  assert.deepEqual(SITE_FILES.map(([f]) => f).sort(), onDisk);
});

test("a source of the site is never served: the template, the fragments, the data, the stylesheet by its plain name", async () => {
  for (const p of ["/pourquoi.html", "/index", "/stand/", "/gabarit.html", "/pages/_hero.html", "/web/site/pages/_hero.html", "/donnees.json", "/web/site/donnees.json", "/site/donnees.json",
    "/textes_fr_en.tsv", "/web/site/site.js", "/site.js", "/assets/site.css", "/assets/site.js", "/assets/aiguillage.js", "/assets/site.0000000000000000.css", "/qr_stand.svg", "/pages/_qr.svg"]) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.match(r.headers.get("content-type"), /^text\/html/, p);
  }
});

test("the site's scripts write no HTML from a string, evaluate nothing, call no network and set no cookie", () => {
  for (const [f] of SITE_FILES.filter(([f]) => f.endsWith(".js"))) assert.deepEqual(scriptFaults(readFileSync(`${WEB}site/${f}`, "utf8")), [], f);
});

test("the texts served are the 324 validated ones, text for text, in French and in English (web/site/textes_fr_en.tsv)", async () => {
  const tsv = readFileSync(`${WEB}site/textes_fr_en.tsv`, "utf8");
  const rows = tsv.split("\n").filter(Boolean);
  assert.equal(rows.length, 324);
  // the renderer collects them in build.py's order: the table it gives is the file, byte for byte
  assert.equal(textsTable(renderSite({ links: LINKS, data: siteData() }).texts), tsv);
  // and the served pages carry each of them, read back from their HTML: the French in the element, the English in its template
  const served = textsTable(Object.values(await pages()).flatMap((h) => textsOf(h))).split("\n").filter(Boolean);
  assert.deepEqual([...new Set(served)].sort(), [...rows].sort());
});

const LINKS = { famille: "/assets/famille.x.css", couche: "/assets/couche.x.css", css: "/assets/site.x.css", aiguillage: "/assets/aiguillage.x.js", js: "/assets/site.x.js" };
const readSite = (f) => readFileSync(`${WEB}site/${f}`, "utf8");

test("planted controls: one character changed in a fragment changes the texts; a pair left untreated and a slot left empty are refused", () => {
  const tsv = readFileSync(`${WEB}site/textes_fr_en.tsv`, "utf8");
  const changed = (f, from, to) => (name) => { const t = readSite(name); if (name !== f) return t; assert.ok(t.includes(from), `the control needs ${from} in ${f}`); return t.replace(from, to); };
  assert.notEqual(textsTable(renderSite({ links: LINKS, data: siteData(), read: changed("pages/mentions.html", "<h2 t>Éditeur ||| Publisher</h2>", "<h2 t>Editeur ||| Publisher</h2>") }).texts), tsv);
  assert.throws(() => renderSite({ links: LINKS, data: siteData(), read: changed("pages/mentions.html", "<h2 t>Éditeur ||| Publisher</h2>", "<h2 t>Éditeur ||| Publisher ||| Editor</h2>") }), /was not treated/);
  assert.throws(() => renderSite({ links: LINKS, data: siteData(), read: changed("pages/mentions.html", "<h2 t>Éditeur ||| Publisher</h2>", "<h2 t>Éditeur, Publisher</h2>") }), /was not treated|t marker is left/);
  assert.throws(() => renderSite({ links: { ...LINKS, js: undefined }, data: siteData(), read: readSite }), /the link js is not a served file/);
  assert.throws(() => renderSite({ links: { ...LINKS, css: "https://cdn.example/site.css" }, data: siteData(), read: readSite }), /the link css is not a served file/);
  assert.throws(() => renderSite({ links: LINKS, data: siteData(), read: changed("gabarit.html", "{{SITE_JS}}", "{{SITE_JS_MISSING}}") }), /slot is left unfilled/);
});

test("the data of the public view and the summary comes from one file, web/site/donnees.json, escaped as text; a state off the lexicon is refused", () => {
  const data = siteData();
  const html = (d) => Object.fromEntries(renderSite({ links: LINKS, data: d }).pages);
  const now = html(data);
  for (const a of data.applications) for (const p of ["/", "/releve"]) { assert.ok(now[p].includes(`commit ${a.commit.slice(0, 7)}`), `${p}: ${a.nom}`); assert.ok(now[p].includes(a.nom), p); }
  // a state changed in the data shows on both pages, with its word of the lexicon; a value is text, never markup
  const refused = structuredClone(data);
  refused.applications[0] = { ...refused.applications[0], nom: "<b>x</b>", etat: "gaps", refus: [{ piece_fr: "Le dossier", piece_en: "The record", genre: "missing-row", ou: "runward/floor.md", ligne: "22" }] };
  const then = html(refused);
  for (const p of ["/", "/releve"]) {
    assert.ok(then[p].includes("Refusée par le contrôle") && then[p].includes("une exigence de l’équipe n’a pas de réponse dans le dossier."), p);
    assert.ok(then[p].includes("&lt;b&gt;x&lt;/b&gt;") && !then[p].includes("<b>x</b>"), `${p}: the name is escaped`);
  }
  assert.throws(() => html({ ...data, applications: [{ ...data.applications[0], etat: "green" }] }), /not of the lexicon/);
  // the file is read in one place only: the renderer's siteData
  const readers = ["src/http/site.js", "src/http/assets.js", "src/http/server.js", "src/main.js"].filter((f) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8").includes("donnees.json"));
  assert.deepEqual(readers, ["src/http/site.js"]);
});

test("the contact is a mailto: to one address, and nothing is posted: no form action, no network call, the policy forbids a form's action", async () => {
  const csp = (await get("/")).headers.get("content-security-policy");
  assert.match(csp, /(^|; )form-action 'none'(;|$)/);
  for (const [p, html] of Object.entries(await pages())) {
    const mails = [...html.matchAll(/href="mailto:([^"?]*)/g)].map((m) => m[1]);
    assert.ok(mails.length >= 1, p);
    assert.deepEqual([...new Set(mails)], [CONTACT], p);
    assert.equal(/<form\b[^>]*\s(?:action|method)=/i.test(html), false, `${p}: the contact form has no action and no method`);
  }
  const js = readSite("site.js");
  assert.ok(js.includes(`var ADRESSE = "${CONTACT}";`));
  assert.deepEqual([...new Set([...js.matchAll(/"mailto:"\s*\+\s*([A-Z]+)/g)].map((m) => m[1]))], ["ADRESSE"], "every mailto the script writes is to the one address");
  assert.deepEqual(scriptFaults(js), []);
});

test("the stand page carries the QR code of web/site/pages/_qr.svg, its matrix unchanged since it was decoded to https://app.runward.dev/stand", async () => {
  const qr = readSite("pages/_qr.svg");
  const path = /<path d="([^"]+)" fill="currentColor"\/>/.exec(qr)[1];
  // decoded on 2026-11-11 with jsQR 1.4.0 (error correction included): https://app.runward.dev/stand, version 3, 29 modules
  // a matrix changed (a QR code generated again) changes this digest: decode the new one before changing it here
  assert.equal(sha(Buffer.from(path)), "2a7b4e50f0ca0417cec2ce61a939c7e01ffd832d48d7a593943e25ebfb9fde06");
  assert.equal([...path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].length, 423, "423 dark modules");
  const stand = await (await get("/stand")).text();
  assert.ok(stand.includes(path), "the matrix is in the page");
  assert.match(stand, /aria-label="Code QR vers app\.runward\.dev\/stand" data-en-aria="QR code to app\.runward\.dev\/stand"/);
});

test("the shell keeps its addresses: /app and /lien serve it, and an address of the app (#/...) is sent from the site to /app", async () => {
  for (const p of ["/app", "/lien"]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /<script type="module" src="\/assets\/app\.[0-9a-f]{16}\/app\.js"><\/script>/, `${p} is the shell`);
  }
  assert.doesNotMatch(await (await get("/")).text(), /\/assets\/app\.[0-9a-f]{16}\/app\.js/, "/ is the landing, not the shell");
  // the landing's first script, run on the addresses a visitor may type
  const run = (hash, search = "", stored = null) => {
    const seen = { replaced: null, listeners: [], theme: null };
    const context = {
      location: { hash, search, replace: (u) => { seen.replaced = u; } },
      window: { addEventListener: (e, f) => seen.listeners.push(e) },
      document: { documentElement: { setAttribute: (k, v) => { if (k === "data-theme") seen.theme = v; } } },
      localStorage: { getItem: (k) => (k === "runward-hosted-theme" ? stored : null) },
      URLSearchParams,
    };
    runInNewContext(readSite("aiguillage.js"), context);
    return seen;
  };
  assert.equal(run("#/entree").replaced, "/app#/entree");
  assert.equal(run("#/entree/connexion").replaced, "/app#/entree/connexion");
  assert.equal(run("#/acces").replaced, "/app#/acces");
  assert.equal(run("#/").replaced, "/app#/");
  for (const anchor of ["", "#", "#contenu", "#scene", "#verifier"]) { const s = run(anchor); assert.equal(s.replaced, null, anchor); assert.deepEqual(s.listeners, ["hashchange"], anchor); }
  assert.equal(run("", "", "dark").theme, "dark", "the theme kept by the app is set before the first paint");
  assert.equal(run("", "?theme=dark").theme, "dark");
  assert.equal(run("", "", "light").theme, null);
  // the shell writes the address back to /#/..., and its signed-out root opens the site
  const app = readFileSync(`${WEB}app.js`, "utf8");
  assert.ok(app.includes('if (location.pathname === "/app") history.replaceState(null, "", `/${location.hash || "#/"}`);'));
  const router = readFileSync(`${WEB}views/router.js`, "utf8");
  assert.ok(router.includes('else if (route === "") location.replace("/");'));
  assert.ok(readFileSync(`${WEB}views/entree.js`, "utf8").includes('const v = V[sub || "connexion"];'), "#/entree alone opens the sign-in");
});
