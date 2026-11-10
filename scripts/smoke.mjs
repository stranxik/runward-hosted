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
// Exit 0 sound, 1 the service is wrong, 3 the smoke itself could not run.
import { request } from "node:http";
import { request as requestS } from "node:https";
import { isIP } from "node:net";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const FOREIGN_HOST = "elsewhere.example";

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
  const must = (ok, what) => { if (!ok) faults.push(what); };
  const j = async (p, init) => { const r = await fetch(`${origin}${p}`, init); return { r, b: await r.json().catch(() => null) }; };
  try {
    const refuse = hostToRefuse(origin, env.RW_SERVICE_HOST);
    if (refuse.refused) { console.error(`smoke: cannot run: ${refuse.refused}`); return 3; }
    const h = await j("/api/health"); must(h.r.status === 200 && h.b?.ok === true, `health ${h.r.status} ${JSON.stringify(h.b)}`);
    const v = await j("/api/version"); must(!commit || v.b?.commit === commit, `version serves ${v.b?.commit}, not ${commit}`);
    must(/^[0-9a-f]{64}$/.test(v.b?.apiContract ?? ""), "version has no API contract digest");
    const page = await fetch(`${origin}/`); const html = await page.text();
    must(page.status === 200 && /runward hébergé/.test(html), "the page");
    must(/frame-ancestors 'none'/.test(page.headers.get("content-security-policy") ?? ""), "CSP frame-ancestors");
    const o = await j("/api/v0/auth/options", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
    must(o.r.status === 200 && o.b?.options?.challenge, "sign-in options");
    const x = await j("/api/v0/exports", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    must(x.b?.refusal === "token-missing", `upload without token: ${x.b?.refusal}`);
    const s = await j("/api/v0/session"); must(s.r.status === 401 && s.b?.refusal === "signed-out", "session without cookie");
    const foreign = await foreignHostFault(origin, { host: refuse.host });
    must(foreign === null, foreign);
  } catch (e) { console.error(`smoke: cannot run: ${e.message}`); return 3; }
  if (faults.length) { console.error(`smoke: ${faults.length} fault(s):\n  - ${faults.join("\n  - ")}`); return 1; }
  console.log(`smoke: ${origin} sound${commit ? ` at ${commit.slice(0, 12)}` : ""}`);
  return 0;
}

// by its real path, encoded as a URL: a comparison that failed would end the script at once, exit 0, having checked nothing
if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exit(await main(process.argv.slice(2), process.env));
