#!/usr/bin/env node
// The operator's gateway (ADR-0016): the only path from outside to the private database for the gestures
// that are not the service. Serverless Jobs cannot join a Private Network; this process runs in a second,
// PRIVATE Serverless Container of the same image, attached to the private network, and runs one gesture
// per authenticated call, as a child process that receives ONE database role's URL and nothing else:
//   roles          scripts/roles.mjs [--grants]   rw_admin  (ADMIN_URL)
//   migrate        scripts/migrate.mjs            rw_owner  (MIGRATE_URL)
//   isolation      scripts/isolation-deployed.mjs rw_app    (DATABASE_URL)
//   retention, verify-chains, open-bootstrap, open-recovery, reset-access, maintenance, restore-replay
//                  src/operator.js <gesture>      rw_maint  (DATABASE_URL, and the bucket's key)
// Two barriers: the hoster refuses an unauthenticated call (privacy "private", X-Auth-Token), and this
// process refuses a call whose X-RW-Operator-Token does not hash to RW_OPERATOR_TOKEN_SHA256 (only the
// hash is in its environment). The single exception is the hoster's schedule, which cannot carry a secret
// it does not keep in clear: POST /scheduled/retention and /scheduled/verify-chains take no token, no
// argument, and run idempotent gestures; nothing else is reachable without the token.
// One gesture at a time (409 otherwise), each bounded by its own deadline (killed, 504), each outcome one
// JSON log line at the hoster (never a header, a body, a token or a URL).
// A daily job that ends without having written its own note (killed at its deadline, ended before it could
// write, refused because another gesture was running) gets one from the gateway: a second, short child
// (src/operator.js job-note, under rw_maint) writes "did not complete" to the operator journal, which
// /api/health reads and the hourly probe alerts on (review finding of 2026-11-10: such a job wrote nothing
// and was seen only a day later). If that note cannot be written either, the gateway's log line says so
// and the rule on a job that has not run for a day still applies; the answer to the caller never changes.
// What leaves the private network is a status and a code (review finding of 2026-11-10: the answer carried
// the child's output, tenant, member and link identifiers, chain heads and error messages included, and
// scripts/operator-call.sh printed it in a GitHub runner's log): the HTTP status and { gesture, ok, exit }
// for a gesture that ran, { error: <code> } for one that did not. The child's output stays here: its last
// error line goes to the gateway's own log line, every result is in the operator journal of the database.
import { createServer } from "node:http";
import { spawn as nodeSpawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { jsonLog } from "./adapters/system/log.js";

const ROOT = new URL("..", import.meta.url).pathname;
const MIN = 60_000;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
// A date-time (YYYY-MM-DDTHH:MM[:SS[.mmm]] then Z or ±HH:MM), checked in small unambiguous pieces: one
// pattern with nested optional groups is the shape the regex scan refuses.
const ISO_PARTS = /^\d{4}-\d{2}-\d{2}T([0-9:.]{5,12})(Z|[+-]\d{2}:\d{2})$/;
const ISO_TIMES = [/^\d{2}:\d{2}$/, /^\d{2}:\d{2}:\d{2}$/, /^\d{2}:\d{2}:\d{2}\.\d{1,3}$/];
const ISO = { test: (s) => { const m = ISO_PARTS.exec(s); return m !== null && ISO_TIMES.some((t) => t.test(m[1])); } };
const TEXT = /^[^\u0000-\u001f\u007f]{1,200}$/;

// the database role of each URL variable of the gateway, and the name the child reads it under
const ROLES = {
  rw_admin: { from: "RW_OPERATOR_URL_ADMIN", as: "ADMIN_URL" },
  rw_owner: { from: "RW_OPERATOR_URL_OWNER", as: "MIGRATE_URL" },
  rw_maint: { from: "RW_OPERATOR_URL_MAINT", as: "DATABASE_URL" },
  rw_app: { from: "RW_OPERATOR_URL_APP", as: "DATABASE_URL" },
};
const op = (name, args = {}, extra = {}) => ({ argv: ["src/operator.js", name], role: "rw_maint", s3: true, timeoutMs: 10 * MIN, args, ...extra });
export const GESTURES = {
  roles: { argv: ["scripts/roles.mjs"], role: "rw_admin", s3: false, timeoutMs: 2 * MIN, args: { grants: ["bool"] } },
  migrate: { argv: ["scripts/migrate.mjs"], role: "rw_owner", s3: false, timeoutMs: 10 * MIN, args: {} },
  isolation: { argv: ["scripts/isolation-deployed.mjs"], role: "rw_app", s3: false, timeoutMs: 5 * MIN, args: {} },
  retention: op("retention", {}, { scheduled: true, timeoutMs: 14 * MIN }),
  "verify-chains": op("verify-chains", {}, { scheduled: true, timeoutMs: 14 * MIN }),
  "open-bootstrap": op("open-bootstrap", { hash: [HEX64, true], tenant: [UUID], witness: ["bool"], title: [TEXT] }, { timeoutMs: 2 * MIN }),
  "open-recovery": op("open-recovery", { hash: [HEX64, true], tenant: [UUID, true], member: [UUID, true] }, { timeoutMs: 2 * MIN }),
  "reset-access": op("reset-access", { hash: [HEX64, true], tenant: [UUID, true] }, { timeoutMs: 2 * MIN }),
  maintenance: op("maintenance", { on: ["bool"], off: ["bool"], until: [ISO], reason: [TEXT] }, { timeoutMs: 2 * MIN }),
  "restore-replay": op("restore-replay", { anchor: ["bool"], since: [ULID], recoveryHash: [HEX64] }),
};

// what a child may see besides its one URL: configuration, never a credential
const PASS = ["PATH", "NODE_ENV", "TZ", "DATABASE_SSL", "DATABASE_CA", "DATABASE_CA_FILE", "RW_DATABASE", "RW_ORIGIN", "RW_STORE", "RW_COMMIT", "RW_IMAGE",
  "RW_SEND_WORKFLOW_SHAS", "RW_SEND_WORKFLOW_REVOKED", "RW_WITNESS_TENANTS", "RW_TRUST_PROXY", "RW_OIDC_ISSUER"];
const S3_CONF = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET"];
const S3_KEYS = ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
const SECRET_NAMES = [...Object.values(ROLES).map((r) => r.from), ...S3_KEYS];

/** What is missing for the gateway to start, as sentences that name variables, never a value. */
export function gatewayProblems(env) {
  const problems = [];
  if (!HEX64.test(env.RW_OPERATOR_TOKEN_SHA256 ?? "")) problems.push("RW_OPERATOR_TOKEN_SHA256 must be the sha256 (64 hex) of the operator token");
  for (const { from } of Object.values(ROLES)) if (!env[from]) problems.push(`${from} is required`);
  for (const k of [...S3_CONF, ...S3_KEYS]) if (!env[k]) problems.push(`${k} is required`);
  return problems;
}

/** The argv of a gesture with its validated arguments, or a refusal (Error with .status 400). */
export function argvOf(name, args = {}) {
  const g = GESTURES[name];
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw bad("args must be an object");
  const out = [...g.argv];
  for (const k of Object.keys(args)) if (!g.args[k]) throw bad(`${name} takes no argument ${k}`);
  for (const [k, [rule, required]] of Object.entries(g.args)) {
    const v = args[k];
    if (v === undefined || v === null || v === false) { if (required) throw bad(`${name} needs ${k}`); continue; }
    const flag = `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    if (rule === "bool") { if (v !== true) throw bad(`${k} is a boolean`); out.push(flag); continue; }
    if (typeof v !== "string" || !rule.test(v)) throw bad(`${k} is not in the expected form`);
    out.push(flag, v);
  }
  if (name === "maintenance" && Boolean(args.on) === Boolean(args.off)) throw bad("maintenance needs exactly one of on, off");
  return out;
}

/** The environment of a gesture's child: the passed configuration and the one URL of its role. */
export function childEnv(name, env) {
  const g = GESTURES[name];
  const out = {};
  for (const k of [...PASS, ...(g.s3 ? [...S3_CONF, ...S3_KEYS] : [])]) if (env[k] !== undefined) out[k] = env[k];
  out[ROLES[g.role].as] = env[ROLES[g.role].from];
  return out;
}

const tail = (s, n) => (s.length > n ? s.slice(-n) : s);
export const NOTE_TIMEOUT_MS = 30_000;
/** Did the child say how its run ended? src/operator.js prints one status line once its gesture has run
 *  (and, for a daily job, has written its note); a child killed or ended before that printed none. */
const saidItsStatus = (stdout, name) => stdout.split("\n").some((l) => { try { return JSON.parse(l).gesture === name; } catch { return false; } });

/** Removes every secret value of the environment (and any connection URL) from a text. */
export function redactor(env) {
  const values = [];
  for (const k of SECRET_NAMES) {
    const v = env[k];
    if (!v) continue;
    values.push(v);
    try { const p = decodeURIComponent(new URL(v).password); if (p) values.push(p, encodeURIComponent(p)); } catch { /* not a URL */ }
  }
  values.sort((a, b) => b.length - a.length);
  return (text) => {
    let t = String(text);
    for (const v of values) t = t.split(v).join("[redacted]");
    return t.replace(/postgres(ql)?:\/\/\S+/gi, "postgres://[redacted]");
  };
}

/** Runs one child to its end or its deadline. */
function runChild({ spawn, argv, env, timeoutMs, killGraceMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "", stderr = "", timedOut = false, settled = false;
    const child = spawn(process.execPath, argv, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (d) => { stdout = tail(stdout + d, 65536); });
    child.stderr?.on("data", (d) => { stderr = tail(stderr + d, 65536); });
    const timer = setTimeout(() => {
      timedOut = true; child.kill("SIGTERM");
      setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, killGraceMs).unref();
    }, timeoutMs);
    const done = (code, signal, error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ code, signal, error, timedOut, stdout, stderr, ms: Date.now() - started });
    };
    child.on("error", (e) => done(null, null, e.message));
    child.on("close", (code, signal) => done(code, signal, null));
  });
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error("body too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createGateway({ env, log = jsonLog(), spawn = nodeSpawn, killGraceMs = 5000, timeouts = {} } = {}) {
  const problems = gatewayProblems(env);
  if (problems.length) { const e = new Error(`operator gateway refused to start:\n  - ${problems.join("\n  - ")}`); e.problems = problems; throw e; }
  const expected = Buffer.from(env.RW_OPERATOR_TOKEN_SHA256, "hex");
  const redact = redactor(env);
  let busy = null;

  const authorized = (req) => {
    const t = req.headers["x-rw-operator-token"];
    if (typeof t !== "string" || !t) return false;
    return timingSafeEqual(createHash("sha256").update(t).digest(), expected);
  };

  /** Writes the note of a daily job that ended without its own. Never throws, never changes an answer. */
  async function noteIncomplete(name, why, route) {
    try {
      const r = await runChild({ spawn, argv: ["src/operator.js", "job-note", "--job", name, "--why", why], env: childEnv(name, env), timeoutMs: timeouts["job-note"] ?? NOTE_TIMEOUT_MS, killGraceMs });
      const ok = r.code === 0 && !r.timedOut;
      const detail = { gesture: name, why, exit: r.code, timedOut: r.timedOut };
      if (ok) log.info("operator.job-note", { route, status: 200, ms: r.ms, detail });
      else log.error("operator.job-note", { route, status: 500, ms: r.ms, detail, error: redact(r.error ?? r.stderr.trim().split("\n").pop() ?? "").slice(0, 300) || `exit ${r.code}` });
    } catch (e) { log.error("operator.job-note", { route, status: 500, detail: { gesture: name, why }, error: redact(String(e?.message ?? e)).slice(0, 300) }); }
  }

  async function handle(req, res) {
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, "http://gateway");
    if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true });
    const m = /^\/(gestures|scheduled)\/([a-z-]+)$/.exec(url.pathname);
    if (req.method !== "POST" || !m) return send(404, { error: "not-found" });
    const [, kind, name] = m;
    const route = `/${kind}/${name}`;
    const scheduled = kind === "scheduled";
    if (scheduled ? !GESTURES[name]?.scheduled : !authorized(req)) {
      log.warn("operator.refused", { route, method: req.method, status: 401, detail: { reason: scheduled ? "not a scheduled gesture" : "no valid operator token" } });
      return send(401, { error: "refused" });
    }
    if (!GESTURES[name]) return send(404, { error: "not-found" });
    let argv;
    try {
      const text = scheduled ? "" : await readBody(req);
      const body = text.trim() ? JSON.parse(text) : {};
      argv = argvOf(name, scheduled ? {} : body.args ?? {});
    } catch (e) {
      const status = e.status ?? 400;
      const code = e instanceof SyntaxError ? "not-json" : status === 413 ? "too-large" : "arguments";
      // the reason (which argument, which form) is said here, in the gateway's log at the hoster; the caller
      // reads the forms in runward/runbook.md §8
      log.warn("operator.refused", { route, method: req.method, status, detail: { gesture: name, reason: e instanceof SyntaxError ? "body is not JSON" : redact(e.message) } });
      return send(status, { error: code });
    }
    if (busy) {
      log.warn("operator.busy", { route, method: req.method, status: 409, detail: { gesture: name, running: busy } });
      if (GESTURES[name].scheduled) await noteIncomplete(name, "busy", route);
      return send(409, { error: "busy" });
    }
    busy = name;
    const g = GESTURES[name];
    try {
      const r = await runChild({ spawn, argv, env: childEnv(name, env), timeoutMs: timeouts[name] ?? g.timeoutMs, killGraceMs });
      const ok = r.code === 0 && !r.timedOut;
      const status = ok ? 200 : r.timedOut ? 504 : 500;
      const lastLine = redact(r.error ?? r.stderr.trim().split("\n").pop() ?? "").slice(0, 300);
      const detail = { gesture: name, role: g.role, scheduled, exit: r.code, signal: r.signal, timedOut: r.timedOut };
      if (ok) log.info("operator.gesture", { route, method: req.method, status, ms: r.ms, detail });
      else log.error("operator.gesture", { route, method: req.method, status, ms: r.ms, detail, error: r.timedOut ? `deadline of ${timeouts[name] ?? g.timeoutMs} ms reached, killed` : lastLine || `exit ${r.code}` });
      if (!ok && g.scheduled && (r.timedOut || !saidItsStatus(r.stdout, name))) await noteIncomplete(name, r.timedOut ? "deadline" : "exit", route);
      return send(status, { gesture: name, ok, exit: r.code });
    } finally { busy = null; }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log.error("operator.gateway", { route: req.url?.split("?")[0], method: req.method, status: 500, error: redact(e.message).slice(0, 300) });
      if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"gateway-error"}'); }
    });
  });
  server.requestTimeout = 0; // a gesture's own deadline bounds the request (the hoster's timeout is above all of them)
  return { server, handle };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = jsonLog();
  let g;
  try { g = createGateway({ env: process.env, log }); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(78); }
  g.server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", () => log.info("operator.start", { detail: { gestures: Object.keys(GESTURES), commit: process.env.RW_COMMIT ?? "unknown" } }));
  const stop = () => { g.server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
