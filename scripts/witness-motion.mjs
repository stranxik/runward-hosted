#!/usr/bin/env node
// The motion witness (ADR-0027), never shipped in the image. It runs the REAL service on 127.0.0.1 with the in-memory
// store (runbook §1), drives Chrome through Playwright with a virtual authenticator of Chrome's DevTools, seeds a
// fleet from runward's real exports (test/fixtures/decision/), and plays each moment of the motion by real gestures.
// For each moment it reports: the frames over 50 ms, split between "an animation of the page runs" and "the screen is
// being laid"; the layout shift without a recent input; the animations left on the way after the sequence; under
// reduced motion, the transform animations seen. Planted control: an animation stuck on purpose must be counted (1).
//
// A measure is taken AT REST: check `uptime` first; above a load average of 3 the frames are contaminated and are
// not a measure (the script prints the load beside every line). The processor is slowed four times by default.
// Usage: node scripts/witness-motion.mjs <out file> [--rate=4] [--widths=1440,390] [--rounds=3] [--only=a,b] [--reduit]
//   (needs playwright-core and Chrome; the moment `controle` waits a real minute, as the app does)
import { generateKeyPairSync, createSign, randomUUID, createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readConfig, compose } from "../src/main.js";
import { githubVerifier, GITHUB_ISSUER } from "../src/adapters/oidc/github.js";
import { memoryStore } from "../src/adapters/store/memory.js";
import { memoryObjects } from "../src/adapters/objects/objects.js";
import { systemClock } from "../src/adapters/system/clock.js";

const repo = new URL("..", import.meta.url).pathname;
const OUT = process.argv[2] ?? "motion.json";

// ------------------------------------------------------------- the service, the browser, the member, the fleet
async function boot({ port = 8850, headless = true, long = false }) {
  const ORIGIN = `http://localhost:${port}`;
  const SEND_SHA = "5b0c9e2d41aa7f3e9c18d6b2a07e4f51c3d9a8e0";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "witness", alg: "RS256", use: "sig" };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sign = (claims) => { const h = b64({ alg: "RS256", kid: "witness" }), b = b64(claims); const s = createSign("RSA-SHA256"); s.update(`${h}.${b}`); return `${h}.${b}.${s.sign(privateKey).toString("base64url")}`; };
  const logs = [];
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: ORIGIN, RW_COMMIT: "witness", RW_IMAGE: "local", RW_SEND_WORKFLOW_SHAS: SEND_SHA, PORT: String(port) });
  const c = compose(config, {
    log: { info: (e, f) => logs.push({ e, ...f }), warn: (e, f) => logs.push({ e, ...f }), error: (e, f) => logs.push({ e, ...f }) },
    store: memoryStore({ clock: systemClock }), objects: memoryObjects(),
    verifier: githubVerifier({ fetch: async () => new Response(JSON.stringify({ keys: [jwk] })), clock: systemClock }),
  });
  await new Promise((r) => c.http.server.listen(port, "127.0.0.1", r));
  const FX = (n) => readFileSync(join(repo, `test/fixtures/decision/${n}.check.json`));

  let run = 10;
  async function upload({ repository, rid, mission, bytes, sha = "9a1f3c5e7b2d4f6a8c0e1b3d5f7a9c2e4b6d8f01", workflow = "runward.yml" }) {
    const now = Math.floor(Date.now() / 1000); run += 1;
    const claims = { iss: GITHUB_ISSUER, aud: ORIGIN, iat: now, nbf: now, exp: now + 300, jti: randomUUID(), repository, repository_id: rid, repository_owner_id: "51234567", repository_owner: repository.split("/")[0],
      workflow_ref: `${repository}/.github/workflows/${workflow}@refs/heads/main`, job_workflow_ref: "stranxik/runward-hosted/.github/workflows/send.yml@refs/tags/v0.1.0", job_workflow_sha: SEND_SHA,
      ref: "refs/heads/main", ref_type: "branch", sha, event_name: "push", runner_environment: "github-hosted", run_id: String(42830000000 + run), run_number: String(run), run_attempt: "1" };
    const r = await fetch(`${ORIGIN}/api/v0/exports`, { method: "POST", body: bytes, headers: { authorization: `Bearer ${sign(claims)}`, "runward-mission": mission, "runward-export-kind": "check", "content-digest": `sha-256=:${createHash("sha256").update(bytes).digest("base64")}:` } });
    return { status: r.status, body: await r.json().catch(() => null) };
  }

  const require = createRequire(join(repo, "index.js"));
  const pw = require("playwright-core");
  const browser = await pw.chromium.launch({ headless, channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR", permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const addAuth = async (kind) => (await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: kind === "key" ? "usb" : "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })).authenticatorId;
  const faults = { console: [], csp: [], offOrigin: [], pageErrors: [] };
  // two answers are the protocol, not errors of the page: 401 on the session (signed out), 404 on the index (none yet)
  page.on("console", (m) => { if (m.type() === "error" && !/status of 401/.test(m.text()) && !(/status of 404/.test(m.text()) && /\/f\/[^/]+\/index\.json/.test(m.location()?.url ?? ""))) faults.console.push(`${m.text()} ${m.location()?.url ?? ""}`); if (/Content Security Policy|Trusted Type/i.test(m.text())) faults.csp.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && !/\/api\/v0\/session$/.test(r.url())) faults.http = [...(faults.http ?? []), `${r.status()} ${r.url().replace(ORIGIN, "")}`]; });
  page.on("pageerror", (e) => faults.pageErrors.push(String(e)));
  page.on("request", (r) => { const u = r.url(); if (!u.startsWith(ORIGIN) && !u.startsWith("data:") && !u.startsWith("about:")) faults.offOrigin.push(u); });

  const settle = async (ms = 350) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
  const go = async (hash) => { await page.evaluate((h) => { if (location.hash === h) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = h; }, hash); await settle(); };

  // ---- the member: the operator opens a bootstrap, the browser makes the first passkey (a virtual authenticator)
  const token = randomBytes(32).toString("base64url");
  await c.app.operator.openBootstrap({ hash: createHash("sha256").update(token).digest("hex"), title: "runward hébergé" });
  const auth = {};
  async function bootstrap() {
    await page.goto(`${ORIGIN}/lien#t=${token}`); await settle();
    await page.evaluate(() => { localStorage.setItem("rw-accueil-lang", "fr"); window.dispatchEvent(new HashChangeEvent("hashchange")); }); await settle();
    auth.a1 = await addAuth("device");
    await page.getByRole("button", { name: "Créer ma passkey sur cet appareil" }).click();
    await page.waitForURL(/#\/arrivee/, { timeout: 10000 }); await settle();
  }
  async function secondPasskey() {
    auth.a2 = await addAuth("key");
    await page.evaluate(() => { localStorage.setItem("rw-accueil-lang", "fr"); window.dispatchEvent(new HashChangeEvent("hashchange")); }); await settle();
    await page.getByRole("button", { name: "Ajouter une clé de sécurité" }).click();
    await page.waitForTimeout(1200); await settle();
  }
  // seeding is the witness's own harness, not a product path: declarations and confirmations are made in process for
  // the member signed in this browser (the same rows the routes write); uploads go through the real HTTP route
  async function session() { const cookie = (await ctx.cookies()).find((k) => k.name === "__Host-rw_session"); return { cookie, s: await c.app.identity.sessionFrom(cookie.value) }; }
  async function grant(gesture, object) { const { cookie, s } = await session(); await c.store.tx(s.tenantId, (tx) => tx.update("session", { id: s.id }, { freshAt: Date.now(), grant: gesture ? { gesture, object, at: Date.now() } : null })); return c.app.identity.sessionFrom(cookie.value); }
  async function declare(name, missions) { return c.app.repositories.declare(await grant("declare-with-consent", name.toLowerCase()), { name, consent: true, missions }, {}); }
  async function confirm(d) { return c.app.repositories.confirm(await grant("repository-confirm", d.id), d.id, {}); }
  async function seed() {
    if (long) {
      const a = "stranxik/observability-and-incident-response-for-the-payments-ledger-in-western-europe-region";
      const d = await declare(a, [{ id: "obs", path: "." }, { id: "long", path: "anapplicationfolderwhosenamehasnobreakinganywherealongitsentirelength" }]);
      await upload({ repository: a, rid: "880001", mission: "obs", bytes: FX("agent-ratified") });
      await confirm(d);
      return;
    }
    let d = await declare("stranxik/runward-hosted", [{ id: "runward-hosted", path: "." }]);
    await upload({ repository: "stranxik/runward-hosted", rid: "873001", mission: "runward-hosted", bytes: FX("hosted-proposed"), sha: "a4ede1485323293609957a700aba13ddf99de27f" });
    await confirm(d);
    d = await declare("stranxik/runward-demo-renaming", [{ id: "runward-demo-renaming", path: "." }]);
    await upload({ repository: "stranxik/runward-demo-renaming", rid: "873002", mission: "runward-demo-renaming", bytes: FX("demo-renamed"), sha: "97fce96d901d0d07cad8a230950d391b223736af" });
    await confirm(d);
    d = await declare("stranxik/runward-examples", [{ id: "agent-ratified", path: "agent-ratified" }, { id: "level-not-met", path: "level-not-met" }, { id: "silent", path: "silent" }]);
    await upload({ repository: "stranxik/runward-examples", rid: "873003", mission: "agent-ratified", bytes: FX("agent-ratified") });
    await confirm(d);
    await upload({ repository: "stranxik/runward-examples", rid: "873003", mission: "level-not-met", bytes: FX("level-not-met") });
    await upload({ repository: "stranxik/runward-hosted", rid: "873001", mission: "runward-hosted", bytes: FX("hosted-proposed"), workflow: "other.yml" });
    await declare("stranxik/dropyour", [{ id: "dropyour", path: "." }]);
  }
  /** A later check of an application (the demo, repaired): the portfolio changes while a reader looks at it. */
  const repaired = () => upload({ repository: "stranxik/runward-demo-renaming", rid: "873002", mission: "runward-demo-renaming", bytes: FX("demo-repaired"), sha: "0b56196b9c821358efcd890f279d00d29a744395" });
  async function close() { await browser.close(); await new Promise((r) => c.http.server.close(r)); c.http.server.closeAllConnections?.(); }
  return { ORIGIN, c, page, ctx, cdp, browser, faults, logs, settle, go, bootstrap, secondPasskey, seed, repaired, upload, addAuth, auth, close };
}

// ------------------------------------------------------------- the measure
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=")[1];
const RATE = Number(arg("rate", 4)), WIDTHS = arg("widths", "1440,390").split(",").map(Number), ROUNDS = Number(arg("rounds", 3));
const ONLY = arg("only", "").split(",").filter(Boolean), REDUIT = process.argv.includes("--reduit");
const load = () => execSync("uptime").toString().trim().replace(/^.*load averages?:\s*/, "");
console.log(`load at start: ${load()} · rate x${RATE} · widths ${WIDTHS} · rounds ${ROUNDS}${REDUIT ? " · reduced motion" : ""}`);

const w = await boot({ port: Number(process.env.WITNESS_PORT ?? 8850) });
const { page, cdp, go, settle } = w;
if (REDUIT) await page.emulateMedia({ reducedMotion: "reduce" });

/** In the page: start measuring. */
const START = () => {
  const M = (window.__m = { t0: performance.now(), pendant: [], pose: [], shifts: [], vues: 0, transformReduit: 0, actif: true, dernier: performance.now(), avant: false });
  const bouge = (a) => (a.effect?.getKeyframes ? a.effect.getKeyframes() : []).some((k) => ["transform", "translate", "scale", "rotate"].some((p) => k[p] !== undefined && k[p] !== "none"));
  const infinie = (a) => a.effect && a.effect.getTiming().iterations === Infinity;
  M.infinie = infinie;
  const tic = (t) => {
    const d = t - M.dernier; M.dernier = t; if (d > 50) (M.avant ? M.pendant : M.pose).push(Math.round(d));
    let court = false;
    for (const a of document.getAnimations()) { if (infinie(a)) continue; M.vues++; if (a.playState === "running") court = true; if (matchMedia("(prefers-reduced-motion: reduce)").matches && bouge(a)) M.transformReduit++; }
    M.avant = court; if (M.actif) requestAnimationFrame(tic);
  };
  requestAnimationFrame(tic);
  try { M.po = new PerformanceObserver((l) => M.shifts.push(...l.getEntries().map((e) => ({ v: e.value, input: e.hadRecentInput })))); M.po.observe({ type: "layout-shift" }); } catch { /* not measurable here */ }
};
const STOP = async (plant) => {
  const M = window.__m;
  if (plant) document.body.animate([{ opacity: 1 }, { opacity: 0.99 }], { duration: 1e7 });
  await new Promise((r) => setTimeout(r, 400));
  M.actif = false; M.po?.takeRecords?.().forEach((e) => M.shifts.push({ v: e.value, input: e.hadRecentInput })); M.po?.disconnect();
  const rest = document.getAnimations().filter((a) => !M.infinie(a) && a.playState !== "finished" && a.playState !== "idle");
  const out = { ms: Math.round(performance.now() - M.t0), pendant: M.pendant, pose: M.pose, shift: +M.shifts.filter((s) => !s.input).reduce((s, x) => s + x.v, 0).toFixed(4), shiftAll: +M.shifts.reduce((s, x) => s + x.v, 0).toFixed(4), restantes: rest.length, vues: M.vues, transformReduit: M.transformReduit, vt: typeof document.startViewTransition === "function" };
  if (plant) rest.forEach((a) => a.cancel());
  return out;
};
const pause = (t) => page.waitForTimeout(t);
const click = async (sel) => { await page.locator(sel).first().click(); };
const signOut = async () => { await page.evaluate(() => fetch("/api/v0/auth/logout", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" })); await page.goto(`${w.ORIGIN}/app#/entree/connexion`); await settle(500); };
const signIn = async () => { await click('[data-do="signin"][data-k="device"]'); await page.waitForURL(/#\/$/, { timeout: 15000 }); };

/** The moments: [name, prepare (not measured), play (measured), { phone }]. */
const MOMENTS = {
  ecrans: { prep: async () => { await go("#/envois"); await go("#/"); }, play: async () => {
    await click('[data-role="application"][data-mission="runward-hosted"] [data-role="state"]'); await pause(1100);
    await page.locator(".top .fil a, .barre-tel .fil a").locator("visible=true").first().click(); await pause(1100);
    await page.evaluate(() => { location.hash = "#/envois"; }); await pause(1100);
    await page.evaluate(() => { location.hash = "#/acces"; }); await pause(1100);
  } },
  arrivee: { prep: async () => { await go("#/envois"); }, play: async () => { await page.evaluate(() => { location.hash = "#/"; }); await pause(1200); } },
  "passkey-ok": { prep: signOut, play: async () => { await page.hover('[data-do="signin"][data-k="device"]'); await pause(300); await signIn(); await pause(1400); } },
  "passkey-echec": { prep: async () => { await signOut(); await cdp.send("WebAuthn.setUserVerified", { authenticatorId: w.auth.a1, isUserVerified: false }); await cdp.send("WebAuthn.setUserVerified", { authenticatorId: w.auth.a2, isUserVerified: false }); },
    play: async () => { await click('[data-do="signin"][data-k="device"]'); await page.waitForURL(/#\/entree\/(echec|inconnue)/, { timeout: 15000 }).catch(() => {}); await pause(900); },
    after: async () => { await cdp.send("WebAuthn.setUserVerified", { authenticatorId: w.auth.a1, isUserVerified: true }); await cdp.send("WebAuthn.setUserVerified", { authenticatorId: w.auth.a2, isUserVerified: true }); await go("#/entree/connexion"); await signIn(); await settle(600); } },
  plis: { prep: async () => { await go("#/decision/runward-hosted"); }, play: async () => { const h = '[data-reading] details[data-role="where"] > summary'; await page.locator(h).first().focus(); await click(h); await pause(900); await click(h); await pause(700); } },
  theme: { prep: async () => { await go("#/"); }, play: async () => { await click(".top [data-theme-btn]"); await pause(800); await click(".top [data-theme-btn]"); await pause(700); } },
  langue: { prep: async () => { await go("#/"); }, play: async () => { const b = (l) => page.locator(`.langue button[lang="${l}"]`).locator("visible=true").first(); await b("en").click(); await pause(900); await b("fr").click(); await pause(800); } },
  survol: { prep: async () => { await go("#/"); }, play: async () => {
    await page.hover('[data-role="application"][data-mission="runward-hosted"] [data-role="reason"]'); await pause(500);
    await page.hover('[data-role="application"][data-mission="runward-hosted"] [data-role="links"] a'); await pause(600);
    await page.locator('.langue button[aria-pressed="false"]').locator("visible=true").first().hover(); await pause(400);
    await page.hover(".lecture-actions .btn"); await pause(400); await page.mouse.down(); await pause(200); await page.mouse.move(2, 2); await page.mouse.up(); await pause(300);
  } },
  copier: { prep: async () => { await go("#/decision/runward-hosted"); }, play: async () => { await page.hover('[data-do="copy"]'); await pause(300); await click('[data-do="copy"]'); await pause(2300); } },
  menu: { phone: true, prep: async () => { await go("#/"); }, play: async () => { await click("#menub"); await pause(900); await page.keyboard.press("Escape"); await pause(700); } },
  chargement: { prep: async () => { await go("#/envois"); await page.route(/\/api\/v0\/fleet\/status/, async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); }); },
    play: async () => { await page.evaluate(() => { location.hash = "#/"; }); await pause(2800); }, after: async () => { await page.unroute(/\/api\/v0\/fleet\/status/); } },
  erreur: { prep: async () => { await go("#/envois"); await page.route(/\/f\/[^/]+\/index\.json/, (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"refusal":"unavailable","message":"x"}' })); },
    play: async () => { await page.evaluate(() => { location.hash = "#/"; }); await pause(1500); }, after: async () => { await page.unroute(/\/f\/[^/]+\/index\.json/); await go("#/envois"); await go("#/"); } },
  // a check arrives while the portfolio is read: the reader comes back to the tab a minute later (the real wait)
  controle: { once: true, prep: async () => { await go("#/envois"); await go("#/"); await pause(61_000); await w.repaired(); }, play: async () => { await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await pause(2600); } },
};

const results = [];
try {
  await w.bootstrap(); await w.secondPasskey(); await w.seed(); await page.reload(); await settle(600);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width > 500 ? 900 : 844 }); await settle(300);
    for (const [name, m] of Object.entries(MOMENTS)) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      if (m.phone && width > 500) continue;
      if (m.once && (width !== WIDTHS[0])) continue;
      const rounds = [];
      for (let r = 0; r < (m.once ? 1 : ROUNDS); r++) {
        await m.prep(); await page.mouse.move(2, 2); await settle(400);
        await page.evaluate(START);
        let err = null;
        try { await m.play(); } catch (e) { err = String(e).slice(0, 160); }
        const res = await page.evaluate(STOP, false);
        if (m.after) await m.after();
        rounds.push({ ...res, err });
      }
      const mm = (k) => `${Math.min(...rounds.map((x) => x[k].length))}-${Math.max(...rounds.map((x) => x[k].length))}`;
      const row = { moment: name, width, pendant: mm("pendant"), pose: mm("pose"), worst: Math.max(0, ...rounds.flatMap((x) => [...x.pendant, ...x.pose])), shift: Math.max(...rounds.map((x) => x.shift)), restantes: Math.max(...rounds.map((x) => x.restantes)), transformReduit: Math.max(...rounds.map((x) => x.transformReduit)), vues: Math.max(...rounds.map((x) => x.vues)), err: rounds.map((x) => x.err).filter(Boolean)[0] ?? null, load: load() };
      results.push(row);
      console.log(`${name.padEnd(14)} ${String(width).padEnd(5)} during ${row.pendant.padEnd(5)} laying ${row.pose.padEnd(5)} worst ${String(row.worst).padEnd(4)}ms shift ${row.shift} left ${row.restantes} transformReduced ${row.transformReduit} animations seen ${row.vues}${row.err ? ` ERR ${row.err}` : ""} · load ${row.load}`);
    }
  }
  // planted control: an animation stuck on purpose is counted
  await go("#/"); await page.evaluate(START); await pause(300);
  const planted = await page.evaluate(STOP, true);
  console.log(`planted control (an animation stuck on purpose): left ${planted.restantes} (must be 1)`);
  results.push({ moment: "planted", restantes: planted.restantes });
} catch (e) { console.log("FAILED", e.stack); process.exitCode = 1; }
const f = w.faults;
console.log(JSON.stringify({ console: f.console.length, pageErrors: f.pageErrors.length, csp: f.csp.length, offOrigin: f.offOrigin.length, loadEnd: load() }));
if (f.console.length || f.pageErrors.length || f.csp.length) console.log(JSON.stringify(f).slice(0, 2000));
writeFileSync(OUT, JSON.stringify({ rate: RATE, reduit: REDUIT, results, faults: f }, null, 1));
await w.close();
