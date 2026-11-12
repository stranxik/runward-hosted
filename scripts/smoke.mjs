#!/usr/bin/env node
// Smoke of a served instance (PADR-0015 point 5): health, version at the expected commit, the page and
// its headers, sign-in options, a host outside the list refused 421, an upload without a token refused
// token-missing, and the reads of the entry screen within the budget.
//   Usage: [RW_SERVICE_HOST=<host>] smoke.mjs <origin> [commit]
// The host outside the list (found at the first deploy, 2026-11-10). The check must reach the app's own
// guard: 421 with the refusal host-not-allowed, answered by the app. Two things stood in the way behind
// the hoster. Node derives the TLS server name from the Host header, so the handshake asked for a
// certificate the service does not hold: the server name now always stays the origin's. And the hoster's
// router picks the container by Host, so an unknown host is answered 404 by the router and never reaches
// the app: RW_SERVICE_HOST names a host the hoster routes to this service and the app does not serve (the
// container's default hostname at the hoster), and it is sent as Host.
//   - RW_SERVICE_HOST set: Host is that name; only the app's 421 host-not-allowed passes.
//   - not set, origin in plain http (the CI image, a local run): Host is elsewhere.example, as before;
//     nothing stands between the smoke and the app.
//   - not set, origin in https: refused, exit 3. Behind TLS a router may answer in the app's place, and a
//     check that cannot reach the app's guard is not run as if it had.
// A 404, any other status, a 421 without that refusal, or a failed handshake is a fault: none of them is
// the app's guard.
// The settling window of /api/health (deploys of 2026-11-11 and 2026-11-12: a 503 with one dependency
// "down", 17 s and 14 s after the new instance started, while production was sound minutes later and the
// rerun passed). At the hoster a new instance can fail to reach the database or the object store in its
// first seconds (runbook §7); the service now asks both before it binds its port (src/main.js#warm), and
// this window covers what is left: an instance that started serving with a dependency still down. Its rules:
//   - only the app's own answer "a dependency is down" is asked again: status 503 with ok false in the
//     body. Any other status, an answer that is not the app's, an error of the call: no second ask;
//   - a version that is not the expected commit is a fault at once: the version is read first, and health
//     is then asked once, without a window (waiting would be waiting for another revision). Health's
//     body says its commit too, and every health answer is held to the expected one: an answer of
//     another revision (the one served before, while the hoster still routes to it) is a fault at once,
//     never a 200 that settles the question;
//   - a first ok after a 503 is not believed alone (a dependency that comes and goes would pass on the
//     one ask that found it up): HEALTH_SETTLE.confirm more answers must be ok in a row, confirmPauseMs
//     apart, inside the same window; a 503 among them starts the count again. Then /api/version is read
//     again and must still say the expected commit. A health that was ok at the first ask is asked once,
//     as before;
//   - bounded: no ask starts later than HEALTH_SETTLE.windowMs after the first, the pause doubling up to
//     pauseMaxMs, each ask cut at HEALTH_ASK_MS: the window plus one ask in flight at the most.
//     RW_SMOKE_SETTLE_MS may shorten the window (a test), never lengthen it;
//   - a dependency down for the whole window, or an ok that the window could not confirm, is a fault,
//     with how long it was asked; a health that settled says so on a line of its own, so that a slow
//     start is seen in the run's log.
// Exit 0 sound, 1 the service is wrong, 3 the smoke itself could not run.
import { request } from "node:http";
import { request as requestS } from "node:https";
import { isIP } from "node:net";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const FOREIGN_HOST = "elsewhere.example";
export const HEALTH_SETTLE = { windowMs: 45_000, pauseMs: 1_000, pauseMaxMs: 8_000, confirm: 2, confirmPauseMs: 1_000 };
export const HEALTH_ASK_MS = 30_000;

/**
 * Asks health (`ask()` answers { r: { status }, b: the JSON body or null }) and returns the answer that
 * decides, with `refused` (how many 503 came before it) and `ms`:
 *   - the app's "a dependency is down" (503, ok false) is asked again until `windowMs` has passed since
 *     the first ask;
 *   - an ok that follows a 503 is asked `confirm` more times: all ok in a row, or the count starts again;
 *     an ok the window ends on before that is returned with `unconfirmed`;
 *   - with `commit`, an answer of the app (ok or down) that names another commit, or none, is returned
 *     at once with `otherCommit`;
 *   - anything else is returned at once. With a window of 0, health is asked once.
 */
export async function settledHealth(ask, { windowMs = HEALTH_SETTLE.windowMs, pauseMs = HEALTH_SETTLE.pauseMs, pauseMaxMs = HEALTH_SETTLE.pauseMaxMs, confirm = HEALTH_SETTLE.confirm, confirmPauseMs = HEALTH_SETTLE.confirmPauseMs, commit = null, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const started = now();
  let pause = pauseMs, refused = 0, okInARow = 0;
  for (;;) {
    const a = await ask();
    const left = windowMs - (now() - started);
    const out = (more = {}) => ({ ...a, refused, ms: now() - started, ...more });
    const down = a.r.status === 503 && a.b?.ok === false;
    const ok = a.r.status === 200 && a.b?.ok === true;
    if (commit && (down || ok) && a.b.commit !== commit) return out({ otherCommit: true });
    if (ok) {
      okInARow++;
      if (refused === 0 || okInARow > confirm) return out();
      if (left <= 0) return out({ unconfirmed: true });
      await sleep(Math.min(confirmPauseMs, left));
      continue;
    }
    if (!down || left <= 0) return out();
    refused++; okInARow = 0;
    await sleep(Math.min(pause, left));
    pause = Math.min(pause * 2, pauseMaxMs);
  }
}

/** The window to use: the default, or a shorter one named by RW_SMOKE_SETTLE_MS; never a longer one. */
export function settleWindow(given) {
  const n = /^\d+$/.test(String(given ?? "").trim()) ? Number(given) : HEALTH_SETTLE.windowMs;
  return Math.min(n, HEALTH_SETTLE.windowMs);
}

/**
 * Asks `origin` for /api/version under a Host the app does not serve, the TLS server name kept on the
 * origin's hostname, and says what is wrong with the answer: null when the app itself refused 421
 * host-not-allowed. `ca` is for a test's own authority.
 */
export function foreignHostFault(origin, { host = FOREIGN_HOST, ca, timeoutMs = 30_000 } = {}) {
  const u = new URL(origin);
  const secure = u.protocol === "https:";
  // as names are compared: without case, without the root's trailing dot (review of 2026-11-10, C31)
  const same = (a, b) => a.toLowerCase().replace(/\.(?=$|:\d+$)/, "") === b.toLowerCase().replace(/\.(?=$|:\d+$)/, "");
  if (same(host, u.host) || same(host, u.hostname)) return Promise.resolve(`the host to refuse, ${host}, is the origin's own`);
  return new Promise((res) => {
    // the server name is the origin's, whatever Host says; an IP address is never a server name (RFC 6066):
    // the empty string sends none and leaves the certificate checked against the address itself
    const servername = isIP(u.hostname.replace(/^\[|\]$/g, "")) ? "" : u.hostname;
    const options = { headers: { host }, ...(secure ? { servername, ...(ca ? { ca } : {}) } : {}) };
    const q = (secure ? requestS : request)(`${u.origin}/api/version`, options, (r) => {
      const chunks = [];
      r.on("data", (d) => { chunks.push(d); });
      r.on("error", (e) => res(`host ${host}: the answer broke off (${e.code ?? e.message})`));
      r.on("end", () => {
        let refusal = null;
        try { refusal = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.refusal ?? null; } catch { /* not the app's JSON */ }
        if (r.statusCode === 421 && refusal === "host-not-allowed") return res(null);
        res(`host ${host} got ${r.statusCode}${refusal ? ` ${refusal}` : ""}, not the app's 421 host-not-allowed${r.statusCode === 404 ? " (a 404 is the router's answer: the request did not reach the app)" : ""}`);
      });
    });
    q.setTimeout(timeoutMs, () => q.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    q.on("error", (e) => res(`host ${host}: no answer (${e.code ?? e.message})`));
    q.end();
  });
}

/** The Host to send, or why the check cannot be run: an https origin needs a host its router routes to the service. */
export function hostToRefuse(origin, serviceHost) {
  const named = (serviceHost ?? "").trim();
  if (named) return /^[a-z0-9.-]+(:\d+)?$/i.test(named) ? { host: named } : { refused: "RW_SERVICE_HOST is not a host name" };
  if (new URL(origin).protocol === "https:") return { refused: "an https origin needs RW_SERVICE_HOST: a host the hoster routes to this service and the app does not serve (without it the router answers, not the app)" };
  return { host: FOREIGN_HOST };
}

async function main([origin, commit], env) {
  if (!origin) { console.error("usage: [RW_SERVICE_HOST=<host>] smoke.mjs <origin> [commit]"); return 3; }
  const faults = [];
  let settled = null;
  const must = (ok, what) => { if (!ok) faults.push(what); };
  const j = async (p, init) => { const r = await fetch(`${origin}${p}`, init); return { r, b: await r.json().catch(() => null) }; };
  try {
    const refuse = hostToRefuse(origin, env.RW_SERVICE_HOST);
    if (refuse.refused) { console.error(`smoke: cannot run: ${refuse.refused}`); return 3; }
    // the version first: a revision that is not the expected one is never waited for
    const v = await j("/api/version"); must(!commit || v.b?.commit === commit, `version serves ${v.b?.commit}, not ${commit}`);
    const windowMs = !commit || v.b?.commit === commit ? settleWindow(env.RW_SMOKE_SETTLE_MS) : 0;
    const h = await settledHealth(() => j("/api/health", { signal: AbortSignal.timeout(HEALTH_ASK_MS) }), { windowMs, commit: commit || null });
    const over = `asked ${h.refused} time(s) down over ${Math.round(h.ms / 1000)} s`;
    if (h.otherCommit) must(false, `health is answered by ${h.b?.commit ? `commit ${h.b.commit}` : "a revision that does not say its commit"}, not ${commit}`);
    else if (h.unconfirmed) must(false, `health answered ok after 503 and the settling window ended before ${HEALTH_SETTLE.confirm} more ok in a row confirmed it (${over})`);
    else must(h.r.status === 200 && h.b?.ok === true, `health ${h.r.status} ${JSON.stringify(h.b)}${h.refused ? ` (${over}: not settled within the window)` : ""}`);
    if (h.refused && h.r.status === 200 && h.b?.ok === true && !h.otherCommit && !h.unconfirmed) {
      // the revision that settled is still the expected one
      const again = await j("/api/version"); must(!commit || again.b?.commit === commit, `after health settled, version serves ${again.b?.commit}, not ${commit}`);
      settled = `smoke: health answered 503 ${h.refused} time(s), then ok ${HEALTH_SETTLE.confirm + 1} times in a row, over ${Math.round(h.ms / 1000)} s: a new instance's dependencies settling (src/main.js#warm says how long in the service's log)`;
    }
    // the app at / and at /app, each with the app's policy; a public page that left this origin answers 308 to the
    // same page of runward.dev, the printed address /stand first (ADR-0028)
    const pages = [];
    for (const p of ["/", "/app"]) {
      const page = await fetch(`${origin}${p}`); const html = await page.text();
      must(page.status === 200 && /runward hébergé/.test(html) && /<script type="module" src="\/assets\/app\.[0-9a-f]{16}\/app\.js">/.test(html), `the page of the app at ${p}`);
      pages.push(page);
    }
    for (const r of pages) must(/frame-ancestors 'none'/.test(r.headers.get("content-security-policy") ?? ""), `CSP frame-ancestors on ${new URL(r.url).pathname}`);
    const stand = await fetch(`${origin}/stand`, { redirect: "manual" });
    must(stand.status === 308 && stand.headers.get("location") === "https://runward.dev/stand", `/stand answers ${stand.status} to ${stand.headers.get("location")}, not 308 to https://runward.dev/stand`);
    const o = await j("/api/v0/auth/options", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
    must(o.r.status === 200 && o.b?.options?.challenge, "sign-in options");
    const x = await j("/api/v0/exports", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    must(x.b?.refusal === "token-missing", `upload without token: ${x.b?.refusal}`);
    const s = await j("/api/v0/session"); must(s.r.status === 401 && s.b?.refusal === "signed-out", "session without cookie");
    const foreign = await foreignHostFault(origin, { host: refuse.host });
    must(foreign === null, foreign);
  } catch (e) { console.error(`smoke: cannot run: ${e.message}`); return 3; }
  if (faults.length) { console.error(`smoke: ${faults.length} fault(s):\n  - ${faults.join("\n  - ")}`); return 1; }
  if (settled) console.log(settled);
  console.log(`smoke: ${origin} sound${commit ? ` at ${commit.slice(0, 12)}` : ""}`);
  return 0;
}

// by its real path, encoded as a URL: a comparison that failed would end the script at once, exit 0, having checked nothing
if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exit(await main(process.argv.slice(2), process.env));
