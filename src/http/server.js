// The HTTP entry (architecture §3): node:http, a table router, no framework (PADR-0016 and its note).
// Before anything: the host list (421, before the body is read), a request id, the headers of every
// response. Every write is a POST, PATCH or DELETE checked same-origin (Origin, then Sec-Fetch-Site);
// no GET writes (PADR-0012 note). The two machine routes (uploads, the witness reader) carry a bearer
// token instead of a session and are exempt from the same-origin check, never from their own.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { Refusal, REFUSALS, refusal as refusalBody, statusOf } from "../domain/refusals.js";
import { MAX_EXPORT_BYTES } from "../domain/workload.js";
import { rateLimiter, failureLimiter, recentlyValid, clientAddress, errorWindow, RATE_LIMITS } from "./limits.js";

export const COOKIE = "__Host-rw_session";
const JSON_LIMIT = 64 * 1024;
const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src-elem 'self'", "style-src-attr 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "require-trusted-types-for 'script'", "trusted-types runward",
].join("; ");

/** The route table: [method, pattern, who, handler]. `who`: public | session | workload | reader. */
export function routes(app) {
  const id = "([0-9a-f-]{36})";
  const I = app.identity, R = app.repositories, G = app.reading;
  return [
    ["POST", "/api/v0/exports", "workload", (q) => app.ingest.upload({ headers: q.headers, readBody: q.readRaw, requestId: q.requestId })],
    ["GET", `/f/${id}/index.json`, "session", async (q, [t]) => {
      if (t !== q.session.tenantId) throw new Refusal("not-found");
      const idx = await G.index(t);
      if (!idx) throw new Refusal("not-found");
      return { status: 200, raw: idx.bytes, type: "application/json; charset=utf-8", headers: { etag: `"${idx.sha256}"` } };
    }],
    ["GET", "/api/v0/fleet/status", "session", (q) => G.status(q.session)],
    ["GET", "/api/v0/session", "session", async (q) => ({ ...(await I.sessionView(q.session)), sendWorkflow: q.config.sendWorkflow.published })],
    ["POST", "/api/v0/auth/options", "public", () => I.signInOptions()],
    ["POST", "/api/v0/auth/verify", "public", async (q) => {
      const r = await I.signIn({ challengeId: q.body.challengeId, response: q.body.response, ua: q.headers["user-agent"], requestId: q.requestId });
      return { status: 200, body: { signedIn: true }, cookie: r.token };
    }],
    ["POST", "/api/v0/auth/fresh/options", "session", (q) => I.freshOptions(q.session, { gesture: q.body.gesture ?? null, object: q.body.object ?? null })],
    ["POST", "/api/v0/auth/fresh", "session", (q) => I.fresh(q.session, { challengeId: q.body.challengeId, response: q.body.response, requestId: q.requestId })],
    ["POST", "/api/v0/auth/logout", "session", async (q) => { await I.signOut(q.session, { requestId: q.requestId }); return { status: 200, body: { signedOut: true }, cookie: "" }; }],
    ["POST", "/api/v0/links/inspect", "public", (q) => I.inspectLink({ token: q.body.token, session: q.session })],
    ["POST", "/api/v0/links/options", "public", (q) => I.linkOptions({ token: q.body.token, session: q.session })],
    ["POST", "/api/v0/links/redeem", "public", async (q) => {
      const r = await I.redeemLink({ token: q.body.token, challengeId: q.body.challengeId, response: q.body.response, ua: q.headers["user-agent"], requestId: q.requestId });
      return { status: 200, body: { redeemed: true, seq: r.entry.seq }, cookie: r.token };
    }],
    ["GET", "/api/v0/access", "session", (q) => I.accessView(q.session)],
    ["POST", "/api/v0/passkeys/options", "session", (q) => I.passkeyAddOptions(q.session)],
    ["POST", "/api/v0/passkeys", "session", (q) => I.passkeyAdd(q.session, { challengeId: q.body.challengeId, response: q.body.response, ua: q.headers["user-agent"], requestId: q.requestId })],
    ["POST", "/api/v0/passkeys/single", "session", (q) => I.passkeySingle(q.session, { requestId: q.requestId })],
    ["DELETE", `/api/v0/passkeys/${id}`, "session", async (q, [p]) => { const r = await I.passkeyRemove(q.session, p, { requestId: q.requestId }); return r.closedCurrent ? { status: 200, body: r, cookie: "" } : r; }],
    ["POST", `/api/v0/passkeys/${id}/restore`, "session", (q, [p]) => I.passkeyRestore(q.session, p, { requestId: q.requestId })],
    ["DELETE", `/api/v0/sessions/${id}`, "session", async (q, [s]) => { const r = await I.sessionClose(q.session, s, { requestId: q.requestId }); return r.closedCurrent ? { status: 200, body: r, cookie: "" } : r; }],
    ["POST", "/api/v0/sessions/close-others", "session", (q) => I.sessionsCloseOthers(q.session, { requestId: q.requestId })],
    ["POST", "/api/v0/repositories", "session", async (q) => ({ status: 201, body: await R.declare(q.session, q.body, { requestId: q.requestId }) })],
    ["PATCH", `/api/v0/repositories/${id}`, "session", (q, [r]) => R.patch(q.session, r, q.body, { requestId: q.requestId })],
    ["POST", `/api/v0/repositories/${id}/confirm`, "session", (q, [r]) => R.confirm(q.session, r, { requestId: q.requestId })],
    ["DELETE", `/api/v0/repositories/${id}`, "session", (q, [r]) => R.remove(q.session, r, { requestId: q.requestId })],
    ["POST", `/api/v0/repositories/${id}/restore`, "session", (q, [r]) => R.restore(q.session, r, { requestId: q.requestId })],
    ["POST", `/api/v0/repositories/${id}/consent`, "session", (q, [r]) => R.consent(q.session, r, { requestId: q.requestId })],
    ["DELETE", `/api/v0/repositories/${id}/consent`, "session", (q, [r]) => R.withdrawConsent(q.session, r, { erase: q.body.erase === true, requestId: q.requestId })],
    ["DELETE", `/api/v0/repositories/${id}/content`, "session", (q, [r]) => R.eraseContent(q.session, r, { requestId: q.requestId })],
    ["POST", "/api/v0/recovery/cancel", "session", (q) => I.recoveryCancel(q.session, { requestId: q.requestId })],
    ["POST", "/api/v0/tenant/settings", "session", (q) => R.settings(q.session, q.body, { requestId: q.requestId })],
    ["POST", "/api/v0/reader", "session", (q) => R.reader(q.session, true, { requestId: q.requestId })],
    ["DELETE", "/api/v0/reader", "session", (q) => R.reader(q.session, false, { requestId: q.requestId })],
    ["GET", "/api/v0/reader/index", "reader", async (q) => {
      const r = await app.reader.readIndex({ authorization: q.headers.authorization, fleet: q.headers["runward-fleet"], requestId: q.requestId });
      return { index: r.index ? { sha256: r.index.sha256, version: r.index.version, json: JSON.parse(r.index.bytes.toString("utf8")) } : null, status: r.status };
    }],
    ["POST", "/api/v0/reader/export", "reader", async (q) => {
      const r = await app.reader.readExport({ authorization: q.headers.authorization, fleet: q.headers["runward-fleet"], requestId: q.requestId });
      return { status: 200, raw: r.bytes, type: "application/x-tar", headers: { "runward-archive-sha256": r.sha256 } };
    }],
    ["GET", "/api/v0/journal", "session", async (q) => {
      const page = await G.journal(q.session, q.url.searchParams.get("cursor"));
      for (const e of page.entries) {
        const code = e.body.detail?.refusal;
        if (code && REFUSALS[code]) { const t = refusalBody(code, q.lang); e.text = { message: t.message, action: t.action }; }
      }
      return page;
    }],
    ["POST", "/api/v0/export", "session", async (q) => { const r = await G.prepareExport(q.session, { requestId: q.requestId }); return { id: r.id, size: r.size, sha256: r.sha256, expiresAt: r.expiresAt }; }],
    ["GET", `/api/v0/export/${id}`, "session", async (q, [a]) => {
      const r = await G.downloadExport(q.session, a);
      return { status: 200, raw: r.bytes, type: "application/x-tar", headers: { "content-disposition": 'attachment; filename="runward-hosted-export.tar"', "runward-archive-sha256": r.sha256 } };
    }],
    ["GET", "/api/version", "public", (q) => q.version],
    ["GET", "/api/health", "public", async (q) => q.health()],
    ["GET", "/.well-known/security.txt", "public", (q) => ({ status: 200, raw: Buffer.from(q.config.securityTxt), type: "text/plain; charset=utf-8" })],
  ];
}

/** The API contract's digest: the route table and the refusal codes, in a stable text. */
export function apiContract(table) {
  const text = [...table.map(([m, p, w]) => `${m} ${p} ${w}`), ...Object.keys(REFUSALS).sort().map((c) => `refusal ${c} ${statusOf(c)}`)].join("\n");
  return createHash("sha256").update(text).digest("hex");
}

function cookieOf(header) {
  for (const part of String(header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}
// Always Secure: the __Host- prefix requires it, and a browser drops a __Host- cookie without it, even on
// http://localhost (which browsers treat as a secure context and accept Secure cookies from). A defect the
// local witness found: the session never set on the local origin.
const setCookie = (token) => token
  ? `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`
  : `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;

/**
 * Build the server. `config`: origin, hosts (allowed Host headers), commit, image, securityTxt,
 * sendWorkflow. `assets`: from buildAssets. `version`: the /api/version body. `health()`: the /api/health body.
 */
export function createHttp({ app, config, assets, version, health, log, clock }) {
  const table = routes(app).map(([m, p, w, h]) => ({ m, re: new RegExp(`^${p}$`), w, h }));
  const allowed = new Set(config.hosts.map((h) => h.toLowerCase()));
  const secure = config.origin.startsWith("https://");
  const origin = config.origin;
  const limits = { ...RATE_LIMITS, ...(config.rateLimits ?? {}) };
  const errors = errorWindow({ now: () => clock.now() });
  const at = { now: () => clock.now() };
  const limiters = {
    writes: rateLimiter({ ...limits.writes, ...at }), reads: rateLimiter({ ...limits.reads, ...at }),
    machine: failureLimiter({ ...limits.machine, everyCall: true, ...at }), signedOut: failureLimiter({ ...limits.signedOut, ...at }),
  };
  const validCookies = recentlyValid(at);

  const baseHeaders = (requestId) => ({
    "runward-request-id": requestId, "runward-version": config.commit, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    "content-security-policy": CSP, "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
    "x-robots-tag": "noindex, nofollow", ...(secure ? { "strict-transport-security": "max-age=31536000" } : {}),
  });

  function send(res, status, headers, body) {
    errors.record(status);
    res.writeHead(status, headers);
    res.end(body);
  }

  async function readLimited(req, limit) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > limit) throw new Refusal(limit === JSON_LIMIT ? "body-invalid" : "too-large"); chunks.push(c); }
    return Buffer.concat(chunks);
  }

  async function handle(req, res) {
    const started = clock.now();
    const requestId = `r-${randomBytes(6).toString("hex")}`;
    const headers = baseHeaders(requestId);
    const host = String(req.headers.host ?? "").toLowerCase();
    let route = "-";
    let machine = null; // the machine route's entry in its limiter, settled with the answer's status
    const lang = /^\s*en\b/i.test(String(req.headers["accept-language"] ?? "")) ? "en" : "fr";
    const fail = (code, extra = {}) => {
      const status = statusOf(code);
      machine?.settle(status === 401); machine = null;
      const h = { ...headers, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
      if (extra.retryAfter) h["retry-after"] = String(extra.retryAfter);
      const { retryAfter, ...rest } = extra;
      send(res, status, h, JSON.stringify({ ...refusalBody(code, lang, rest), requestId }));
      log.info("http", { requestId, method: req.method, route, status, ms: clock.now() - started, refusal: code });
    };
    try {
      if (!allowed.has(host) && !allowed.has(host.replace(/:\d+$/, ""))) return fail("host-not-allowed");
      // the request target is a path of this origin. One that does not parse (`//`, `/\`), or that names an
      // authority of its own (`//host/...`), is the caller's fault: 404, never a server error (review
      // finding of 2026-11-10: `GET //` threw "Invalid URL" here, was answered 503 and counted as one)
      let url = null;
      if (!String(req.url).startsWith("//")) { try { url = new URL(req.url, origin); } catch { /* not a path */ } }
      if (!url || url.origin !== origin) { route = "unparsable"; return fail("not-found"); }
      const path = url.pathname;

      // ---- static files and the shell
      if (req.method === "GET" || req.method === "HEAD") {
        const a = assets.files.get(path);
        if (a) {
          route = "asset";
          send(res, 200, { ...headers, "content-type": a.type, "cache-control": a.immutable ? "public, max-age=31536000, immutable" : "public, max-age=86400" }, req.method === "HEAD" ? undefined : a.bytes);
          return;
        }
        if (path === "/" || path === "/lien" || path === "/index.html") {
          route = "page";
          send(res, 200, { ...headers, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, req.method === "HEAD" ? undefined : assets.page);
          log.info("http", { requestId, method: req.method, route, status: 200, ms: clock.now() - started });
          return;
        }
      }

      const r = table.find((x) => x.re.test(path) && x.m === req.method);
      if (!r) {
        if (table.some((x) => x.re.test(path))) return fail("method-not-allowed");
        if (path.startsWith("/api/") || path.startsWith("/f/") || req.method !== "GET") return fail("not-found");
        route = "page-404";
        send(res, 404, { ...headers, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, assets.page);
        return;
      }
      route = r.re.source;
      const params = path.match(r.re).slice(1);
      const write = ["POST", "PATCH", "DELETE"].includes(req.method);

      const address = clientAddress(req, config.trustProxy);
      /** Answers 429 and says so when the limiter's verdict is a refusal. */
      const refused = (t) => { if (t.ok) return false; fail("too-many-requests", { retryAfter: t.retryAfter }); return true; };

      // ---- the public routes are limited, per address and for the instance, before anything is read
      if (r.w === "public" && refused(limiters[write ? "writes" : "reads"].take(address))) return;

      // ---- the machine routes are not authenticated until their token's RSA signature is checked: each
      //      call is counted for its address before that check (review finding of 2026-11-10); the instance's
      //      budget counts the calls whose token was refused, and refuses only the addresses that failed
      if (r.w === "workload" || r.w === "reader") {
        const entry = limiters.machine.enter(address);
        if (refused(entry)) return;
        machine = entry;
      }

      // ---- writes from a browser: same origin, checked before the body is read
      if (write && r.w !== "workload" && r.w !== "reader") {
        const o = req.headers.origin;
        const okOrigin = o ? o === origin : req.headers["sec-fetch-site"] === "same-origin";
        if (!okOrigin) return fail("same-origin");
      }

      // ---- the session, before any other read of the database. A request that is not signed in is
      //      counted (a cookie that resolves to no session, or a session route called without one); past the
      //      budget of its address, or once the instance's is spent and its address has failed, its cookie
      //      is refused before the database is read. A cookie that resolved a moment ago is not asked.
      const token = cookieOf(req.headers.cookie);
      let session = null;
      if (token) {
        const hash = createHash("sha256").update(token).digest("hex");
        const entry = validCookies.has(hash) ? null : limiters.signedOut.enter(address);
        if (entry && refused(entry)) return;
        // the entry holds a place in its address's budget while the session is read, and gives it back
        // unless the cookie resolved to nothing
        try { session = await app.identity.sessionFrom(token); } catch (e) { entry?.settle(false); throw e; }
        if (session) { entry?.settle(false); validCookies.add(hash); }
        else { validCookies.drop(hash); const e = entry ?? limiters.signedOut.enter(address); if (e.ok) e.settle(true); }
      }
      if (r.w === "session" && !session) {
        if (!token) { const entry = limiters.signedOut.enter(address); if (refused(entry)) return; entry.settle(true); }
        return fail("signed-out");
      }

      // ---- maintenance: writes answer 503 (the upload use case says so itself)
      if (write && r.w === "session") {
        const m = await health.maintenance();
        if (m) return fail("maintenance", { retryAfter: 600 });
      }

      // ---- the body (uploads read their own, last, after the token and the repository)
      let body = {};
      if (write && r.w !== "workload" && r.w !== "reader") {
        const raw = await readLimited(req, JSON_LIMIT);
        if (raw.length) {
          if (!/^application\/json\b/.test(String(req.headers["content-type"] ?? ""))) return fail("body-invalid");
          try { body = JSON.parse(raw.toString("utf8")); } catch { return fail("body-invalid"); }
          if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body-invalid");
        }
      }
      const q = { headers: req.headers, url, body, session, requestId, lang, config, version, health: async () => { const h = await health.body(); return { ...h, body: { ...h.body, errors: errors.read() } }; },
        readRaw: (limit) => readLimited(req, Math.min(limit, MAX_EXPORT_BYTES)) };
      const out = await r.h(q, params);
      const shaped = out && typeof out === "object" && ("status" in out && ("body" in out || "raw" in out)) ? out : { status: 200, body: out };
      if (shaped.refusal && REFUSALS[shaped.refusal]) shaped.body = { ...refusalBody(shaped.refusal, lang), ...shaped.body, requestId };
      else if (shaped.body && typeof shaped.body === "object" && !Array.isArray(shaped.body) && path === "/api/v0/exports") shaped.body = { ...shaped.body, requestId };
      machine?.settle(shaped.status === 401); machine = null;
      const h = { ...headers, "cache-control": "no-store", ...(shaped.headers ?? {}) };
      if (shaped.cookie !== undefined) h["set-cookie"] = setCookie(shaped.cookie);
      if (shaped.raw) { h["content-type"] = shaped.type; send(res, shaped.status, h, shaped.raw); }
      else { h["content-type"] = "application/json; charset=utf-8"; send(res, shaped.status, h, JSON.stringify(shaped.body ?? {})); }
      log.info("http", { requestId, method: req.method, route, status: shaped.status, ms: clock.now() - started, ...(shaped.refusal ? { refusal: shaped.refusal } : {}), ...(session ? { tenant: createHash("sha256").update(session.tenantId).digest("hex").slice(0, 12) } : {}) });
    } catch (e) {
      if (e instanceof Refusal) return fail(e.code, e.extra);
      log.error("http.error", { requestId, route, error: String(e?.message ?? e).slice(0, 200) });
      return fail("service-unavailable");
    }
  }

  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, (req, res) => { handle(req, res); });
  return { server, handle, table };
}
