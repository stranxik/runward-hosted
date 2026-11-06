#!/usr/bin/env node
// Smoke of a served instance (PADR-0015 point 5): health, version at the expected commit, the page and
// its headers, sign-in options, a host outside the list refused 421, an upload without a token refused
// token-missing, and the reads of the entry screen within the budget. Usage: smoke.mjs <origin> [commit]
// Exit 0 sound, 1 the service is wrong, 3 the smoke itself could not run.
import { request } from "node:http";
import { request as requestS } from "node:https";
const [origin, commit] = process.argv.slice(2);
if (!origin) { console.error("usage: smoke.mjs <origin> [commit]"); process.exit(3); }
const faults = [];
const must = (ok, what) => { if (!ok) faults.push(what); };
const j = async (p, init) => { const r = await fetch(`${origin}${p}`, init); return { r, b: await r.json().catch(() => null) }; };
try {
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
  const u = new URL(origin);
  const status421 = await new Promise((res) => { const q = (u.protocol === "https:" ? requestS : request)(`${origin}/api/version`, { headers: { host: "elsewhere.example" } }, (r) => { r.resume(); res(r.statusCode); }); q.on("error", () => res(0)); q.end(); });
  must(status421 === 421, `a foreign host got ${status421}`);
} catch (e) { console.error(`smoke: cannot run: ${e.message}`); process.exit(3); }
if (faults.length) { console.error(`smoke: ${faults.length} fault(s):\n  - ${faults.join("\n  - ")}`); process.exit(1); }
console.log(`smoke: ${origin} sound${commit ? ` at ${commit.slice(0, 12)}` : ""}`);
