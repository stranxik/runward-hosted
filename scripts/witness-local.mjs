#!/usr/bin/env node
// The local witness (temoin-parcours), never shipped in the image. It runs the REAL service (real routes,
// real WebAuthn verification by @simplewebauthn/server, real runward-fleet) on 127.0.0.1 with the
// in-memory store, then drives Chrome through Playwright with a virtual authenticator of Chrome's DevTools
// (PADR-0012, consequences: the witness simulates an authenticator; the author's own passkeys are his
// gesture). CI uploads are signed with a key made here and verified by the real OIDC verifier.
// Path: bootstrap link -> first passkey -> second passkey -> declare with consent -> first upload (pending)
// -> confirm -> fleet -> a mission -> uploads -> access -> a removal then a restore -> sign out -> sign in.
// At each screen: a capture at 1440 px and at 390 px, the data reads at opening, horizontal overflow, axe.
// Usage: node scripts/witness-local.mjs <out dir>   (needs playwright-core and Chrome)
import { generateKeyPairSync, createSign, randomUUID, createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { readConfig, compose } from "../src/main.js";
import { githubVerifier, GITHUB_ISSUER } from "../src/adapters/oidc/github.js";
import { memoryStore } from "../src/adapters/store/memory.js";
import { memoryObjects } from "../src/adapters/objects/objects.js";
import { systemClock } from "../src/adapters/system/clock.js";

const OUT = process.argv[2] ?? "captures";
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.WITNESS_PORT ?? 8787);
const ORIGIN = `http://localhost:${PORT}`;
const SEND_SHA = "5b0c9e2d41aa7f3e9c18d6b2a07e4f51c3d9a8e0";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "witness", alg: "RS256", use: "sig" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (claims) => { const h = b64({ alg: "RS256", kid: "witness" }), b = b64(claims); const s = createSign("RSA-SHA256"); s.update(`${h}.${b}`); return `${h}.${b}.${s.sign(privateKey).toString("base64url")}`; };

const logs = [];
const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: ORIGIN, RW_COMMIT: "witness", RW_IMAGE: "local", RW_SEND_WORKFLOW_SHAS: SEND_SHA, PORT: String(PORT) });
const c = compose(config, {
  log: { info: (e, f) => logs.push({ e, ...f }), warn: (e, f) => logs.push({ e, ...f }), error: (e, f) => logs.push({ e, ...f }) },
  store: memoryStore({ clock: systemClock }), objects: memoryObjects(),
  verifier: githubVerifier({ fetch: async () => new Response(JSON.stringify({ keys: [jwk] })), clock: systemClock }),
});
await new Promise((r) => c.http.server.listen(PORT, "127.0.0.1", r));
console.log(`witness: the service listens on ${ORIGIN} (in-memory store; nothing survives the run)`);

async function upload(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  const repository = over.repository ?? "stranxik/dropyour";
  const claims = { iss: GITHUB_ISSUER, aud: ORIGIN, iat: now, nbf: now, exp: now + 300, jti: randomUUID(), repository, repository_id: "873112450", repository_owner_id: "51234567", workflow_ref: `${repository}/.github/workflows/runward.yml@refs/heads/main`, job_workflow_ref: `stranxik/runward-hosted/.github/workflows/send.yml@refs/tags/v0.1.0`, job_workflow_sha: SEND_SHA, ref: "refs/heads/main", ref_type: "branch", sha: "9a1f3c5e7b2d4f6a8c0e1b3d5f7a9c2e4b6d8f01", event_name: "push", runner_environment: "github-hosted", run_id: String(23849315580 + Math.floor(Math.random() * 1000)), run_number: "1203", run_attempt: "1", ...over };
  const bytes = over.bytes ?? readFileSync(new URL("../test/fixtures/check.json", import.meta.url));
  delete claims.bytes;
  const r = await fetch(`${ORIGIN}/api/v0/exports`, { method: "POST", body: bytes, headers: { authorization: `Bearer ${sign(claims)}`, "runward-mission": over.mission ?? "dropyour", "runward-export-kind": "check", "content-digest": `sha-256=:${createHash("sha256").update(bytes).digest("base64")}:` } });
  return { status: r.status, body: await r.json() };
}

const require = createRequire(join(process.cwd(), "index.js"));
const pw = await import("playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const report = [];
let failed = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const addAuth = async (name) => (await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: name === "key" ? "usb" : "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })).authenticatorId;
  let reads = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/f/") || r.resourceType() === "document") reads.push(`${r.method()} ${u.pathname}`); });
  const consoleErrors = [];
  // a 401 on GET /api/v0/session is the protocol saying "signed out", not an error of the page
  page.on("console", (m) => { if (m.type() === "error" && !/status of 401/.test(m.text())) consoleErrors.push(m.text()); });
  const axeSrc = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

  async function screen(name, { mobile = true } = {}) {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(250);
    const r = [...reads]; reads = [];
    // the budget of architecture §6 counts the page and the data reads; gestures (writes) are listed apart
    const data = r.filter((x) => /^GET \/(?:$|lien$|api\/v0\/(session|fleet\/status|journal|access)|f\/)|^POST \/api\/v0\/links\/inspect/.test(x));
    const gestures = r.filter((x) => !data.includes(x) && !/\/assets\//.test(x));
    const h1 = await page.locator("main h1").first().textContent().catch(() => "");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    await page.screenshot({ path: join(OUT, `${name}-1440.png`), fullPage: true });
    // axe needs its source in the page: added through a Trusted Types default policy is refused by our CSP,
    // so it is evaluated by CDP in an isolated world, where the page's CSP does not apply to it.
    const axe = await (async () => {
      const w = await cdp.send("Page.createIsolatedWorld", { frameId: (await cdp.send("Page.getFrameTree")).frameTree.frame.id, worldName: "axe" });
      await cdp.send("Runtime.evaluate", { expression: axeSrc, contextId: w.executionContextId });
      const res = await cdp.send("Runtime.evaluate", { expression: "axe.run(document, { resultTypes: ['violations'] }).then(r => JSON.stringify(r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => ({ id: v.id, n: v.nodes.length }))))", contextId: w.executionContextId, awaitPromise: true, returnByValue: true });
      return JSON.parse(res.result.value ?? "[]");
    })().catch((e) => [{ id: `axe could not run: ${e.message}`, n: 0 }]);
    let mobileOverflow = null;
    if (mobile) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(150);
      mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      await page.screenshot({ path: join(OUT, `${name}-390.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    const row = { name, h1: (h1 ?? "").trim(), reads: data.length, readList: data, gestures, overflow, mobileOverflow, axe };
    if (data.length > 4 || overflow || mobileOverflow || axe.length) failed++;
    report.push(row);
    console.log(`witness: ${name}: « ${row.h1} » · ${data.length} read(s) · overflow ${overflow}/${mobileOverflow} · axe ${axe.length}`);
  }
  const go = async (hash) => { reads = []; await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(400); };
  const click = async (text) => { await page.getByRole("button", { name: text }).first().click(); await page.waitForTimeout(500); };

  // 1. signed out
  await page.goto(`${ORIGIN}/`); await screen("01-entree");
  await page.goto(`${ORIGIN}/#/entree/sans-compte`); reads = []; await page.reload(); await screen("02-sans-compte", { mobile: false });
  await page.goto(`${ORIGIN}/lien#t=${randomBytes(32).toString("base64url")}`); await screen("03-lien-invalide", { mobile: false });
  await page.goto(`${ORIGIN}/#/nimporte`); await screen("04-404", { mobile: false });

  // 2. bootstrap: the operator opens it with a digest; the token stays here
  const token = randomBytes(32).toString("base64url");
  const { tenant } = await c.app.operator.openBootstrap({ hash: createHash("sha256").update(token).digest("hex"), title: "Flotte du mainteneur" });
  await page.goto(`${ORIGIN}/lien#t=${token}`); await screen("05-lien-amorcage");
  const url = page.url();
  if (url.includes(token)) { console.log("witness: FAULT the token stayed in the address bar"); failed++; }
  const a1 = await addAuth("device");
  await click("Créer ma passkey sur cet appareil");
  await page.waitForURL(/#\/arrivee/, { timeout: 8000 }).catch(() => {});
  await screen("06-arrivee-une-passkey");
  // 3. second passkey on a second authenticator (a security key)
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: a1, enabled: true });
  const a2 = await addAuth("key");
  await click("Ajouter une clé de sécurité");
  await page.waitForTimeout(800);
  await screen("07-arrivee-deux-passkeys");
  // 4. declare with consent (per-gesture verification)
  await page.fill('input[name="repo"]', "stranxik/dropyour");
  await page.fill('input[name="mission"]', "dropyour");
  await page.check('input[name="content"]');
  await page.getByRole("button", { name: "Déclarer ce dépôt" }).click(); await page.waitForTimeout(1200);
  await screen("08-arrivee-declare");
  // 5. the CI's first upload: kept, awaiting confirmation
  const first = await upload();
  console.log(`witness: first upload -> ${first.status} ${first.body.refusal ?? ""}`);
  await click("Vérifier l'arrivée du premier envoi"); await page.waitForTimeout(600);
  await screen("09-arrivee-premier-envoi");
  await page.getByRole("button", { name: "Confirmer le premier envoi" }).click(); await page.waitForTimeout(600);
  await screen("10-confirmer");
  await click("Confirmer ce dépôt"); await page.waitForTimeout(1200);
  await screen("11-flotte");
  // more uploads: a refused one, a newer one
  const refused = await upload({ workflow_ref: "stranxik/dropyour/.github/workflows/release.yml@refs/heads/main", run_number: "1210" });
  const second = await upload({ run_number: "1204" });
  console.log(`witness: refused -> ${refused.body.refusal}; second -> ${second.status} current ${second.body.current}`);
  await page.reload(); await page.waitForTimeout(800); await screen("12-flotte-apres-envois");
  await go("#/mission/dropyour"); await screen("13-mission", { mobile: true });
  await go("#/envois"); await screen("14-envois");
  await go("#/acces"); await screen("15-acces");
  // 6. a gesture that withdraws, then restores: remove the security key, restore it
  const rows = page.locator(".arow", { hasText: "ouvre cette session" });
  const other = page.locator(".arow").filter({ hasNotText: "ouvre cette session" }).filter({ has: page.getByRole("button", { name: "Retirer" }) }).first();
  await other.getByRole("button", { name: "Retirer" }).click(); await page.waitForTimeout(300);
  await screen("16-acces-confirmer-retrait", { mobile: false });
  await page.getByRole("button", { name: "Retirer la passkey" }).click(); await page.waitForTimeout(1200);
  await screen("17-acces-passkey-retiree", { mobile: false });
  await page.getByRole("button", { name: "Remettre" }).first().click(); await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Remettre la passkey" }).click(); await page.waitForTimeout(1200);
  await screen("18-acces-passkey-remise", { mobile: false });
  void rows;
  // 7. export
  await go("#/acces/export"); await click("Préparer l'archive"); await page.waitForTimeout(1500); await screen("19-export", { mobile: false });
  // 8. sign out, sign in again (discoverable credential)
  await go("#/acces"); await page.getByRole("button", { name: "Se déconnecter" }).first().click(); await page.waitForTimeout(800); await screen("20-sortie", { mobile: false });
  await go("#/entree"); await click("Se connecter avec ma passkey"); await page.waitForTimeout(1500); await screen("21-reconnecte", { mobile: false });
  void a2; void tenant;
  report.push({ consoleErrors });
  if (consoleErrors.length) { console.log(`witness: console errors: ${consoleErrors.join(" | ").slice(0, 400)}`); failed++; }
} finally {
  await browser.close();
  await new Promise((r) => c.http.server.close(r));
}
const leaked = logs.filter((l) => /eyJ|#t=/.test(JSON.stringify(l))).length;
report.push({ logLines: logs.length, logLinesWithTokens: leaked });
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(`witness: ${report.filter((r) => r.name).length} screens, ${failed} with a fault; log lines with a token: ${leaked}; captures in ${OUT}`);
process.exit(failed || leaked ? 1 : 0);
