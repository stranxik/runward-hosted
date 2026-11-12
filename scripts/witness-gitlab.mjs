#!/usr/bin/env node
// The witness of a registered GitLab instance (ADR-0029 section 5, step c), never shipped in the image.
// It runs the REAL service (real routes, the real registry of issuers, the real runward-fleet) with the
// in-memory store, on an address the instance's runner reaches, registers the instance by the real
// gestures, and records what each upload of the real runner is answered: the status, the refusal, the
// level, and the time from the token's `iat` to its reception. The tokens are the instance's own; none is
// printed, written or logged: the record keeps the claims' dates and the answer only.
// The passkey ceremony is a stand-in here (it checks the challenge and the credential, as the unit suites
// do): the WebAuthn library is witnessed by scripts/witness-local.mjs, in a browser.
//   node scripts/witness-gitlab.mjs --ip <address the runner reaches> --issuer <iss> --jwks <file> --kid <kid> --out <dir>
// Control: a file dropped in <out>/ctl/ is a command, run once; its content, when it is JSON, is the command's
// arguments: `declare` (declare a project with consent, by the real gestures: {"project", "mission", "branch"},
// --project, mission demo and branch main by default), `confirm` (confirm the first send of a declared project as
// the shell does: the values to pin and their digest read on the access view, the gesture bound to them:
// {"project"}), `reading` (the application's screen as the shell paints it, web/views/decision.js over the
// tenant's real index and status: its level panel, the sentence first, and the repository the index names:
// {"mission"}), `retire` (retire the instance's key), `forged` (send a token under the key's kid with a bad
// signature), `stop`. Every event is a line of <out>/events.jsonl.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, appendFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULES } from "../src/http/assets.js";
import { confirmObject } from "../src/domain/forge.js";
import { readConfig, compose } from "../src/main.js";
import { memoryStore } from "../src/adapters/store/memory.js";
import { memoryObjects } from "../src/adapters/objects/objects.js";
import { systemClock } from "../src/adapters/system/clock.js";
import { fakeAuthn, gitlabKey } from "../test/helpers.js";

const arg = (name, dflt = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const IP = arg("ip"), ISSUER = arg("issuer"), JWKS = arg("jwks"), KID = arg("kid"), OUT = arg("out", "captures/witness-gitlab");
const PROJECT = arg("project", "temoin/demo"), PORT = Number(arg("port", "8787"));
if (!IP || !ISSUER || !JWKS || !KID) { console.error("usage: witness-gitlab.mjs --ip <address> --issuer <iss> --jwks <file> --kid <kid> [--project group/project] [--port 8787] [--out dir]"); process.exit(2); }
const ORIGIN = `http://${IP}:${PORT}`;
mkdirSync(join(OUT, "ctl"), { recursive: true });
const record = (e) => { const line = { at: new Date().toISOString(), ...e }; appendFileSync(join(OUT, "events.jsonl"), `${JSON.stringify(line)}\n`); console.log(JSON.stringify(line)); };
const sha = (b) => createHash("sha256").update(b).digest("hex");

// the script's own calls reach the service on the loopback address, which is added to the hosts it serves
const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: ORIGIN, RW_EXTRA_HOSTS: `127.0.0.1:${PORT}`, RW_COMMIT: "witness", RW_IMAGE: "local", PORT: String(PORT) });
const quiet = { info() {}, warn() {}, error: (e, f) => record({ event: "service-error", e, error: f?.error ?? null }) };
const c = compose(config, { log: quiet, store: memoryStore({ clock: systemClock }), objects: memoryObjects(), authn: fakeAuthn() });

// what an upload is answered, and the time from the token's iat to its reception. The claims are read
// here without being trusted, for the record only; the service verifies the token itself.
const upload = c.app.ingest.upload.bind(c.app.ingest);
const journals = async () => Object.fromEntries(await Promise.all(tenants.map(async (t) => [t.name, (await c.store.tx(t.tenant, (tx) => tx.ledgerAll())).length])));
c.app.ingest.upload = async (args) => {
  const received = Date.now();
  let claims = {};
  try { claims = JSON.parse(Buffer.from(String(args.headers.authorization ?? "").split(".")[1] ?? "", "base64url").toString("utf8")); } catch { claims = {}; }
  const seen = { event: "upload", label: args.headers["runward-witness"] ?? null, iat: claims.iat ?? null, exp: claims.exp ?? null, receivedS: Math.floor(received / 1000), iatToReceptionS: typeof claims.iat === "number" ? Math.round((received / 1000 - claims.iat) * 10) / 10 : null,
    claims: { pipeline_source: claims.pipeline_source ?? null, ref: claims.ref ?? null, ref_protected: claims.ref_protected ?? null, project_path: claims.project_path ?? null, project_id: claims.project_id ?? null, pipeline_id: claims.pipeline_id ?? null, job_id: claims.job_id ?? null, runner_id: claims.runner_id ?? null, definition: claims.ci_config_ref_uri ?? null } };
  const before = await journals();
  try {
    const out = await upload(args);
    record({ ...seen, status: out.status, refusal: out.refusal ?? null, level: out.body?.level ?? null, journals: { before, after: await journals() } });
    return out;
  } catch (e) {
    record({ ...seen, status: null, refusal: e.code ?? String(e.message).slice(0, 80), journals: { before, after: await journals() } });
    throw e;
  }
};

await new Promise((r) => c.http.server.listen(PORT, "0.0.0.0", r));
const H = { origin: ORIGIN, "content-type": "application/json" };
const call = async (method, path, { body, cookie } = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { ...H, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: r.headers.get("set-cookie")?.split(";")[0] ?? null };
};

/** A tenant with a founder signed in, through the real routes; `verify(gesture, object)` is its passkey gesture. */
async function tenant(name) {
  const token = randomBytes(32).toString("base64url");
  const { tenant: id } = await c.app.operator.openBootstrap({ hash: sha(Buffer.from(token)) });
  const cred = `witness-${name}`;
  const o = await call("POST", "/api/v0/links/options", { body: { token } });
  const red = await call("POST", "/api/v0/links/redeem", { body: { token, challengeId: o.body.challengeId, response: { id: cred, challenge: o.body.options.challenge } } });
  const cookie = red.cookie;
  const verify = async (gesture, object) => {
    const go = await call("POST", "/api/v0/auth/fresh/options", { body: gesture ? { gesture, object } : {}, cookie });
    const r = await call("POST", "/api/v0/auth/fresh", { body: { challengeId: go.body.challengeId, response: { id: cred, challenge: go.body.options.challenge } }, cookie });
    if (r.status !== 200) throw new Error(`gesture ${gesture}: ${r.status}`);
  };
  return { name, tenant: id, cookie, verify };
}
/** Register an instance by the real gesture: preview, the passkey gesture bound to the digest shown, register. */
async function register(t, input) {
  const shown = await call("POST", "/api/v0/issuers/preview", { body: input, cookie: t.cookie });
  if (shown.status !== 200) throw new Error(`preview: ${shown.status} ${shown.body.refusal} ${shown.body.why ?? ""}`);
  await t.verify("issuer-register", shown.body.digest);
  const r = await call("POST", "/api/v0/issuers", { body: { ...input, digest: shown.body.digest }, cookie: t.cookie });
  if (r.status !== 201) throw new Error(`register: ${r.status} ${r.body.refusal}`);
  return { ...r.body, bits: shown.body.bits };
}

const tenants = [];
const A = await tenant("a"); tenants.push(A);
const B = await tenant("b"); tenants.push(B);
const keys = JSON.parse(readFileSync(JWKS, "utf8"));
// A registers the instance with the instance's own key: the one a CI token's header names
const regA = await register(A, { issuer: ISSUER, keys, kid: KID });
// B registers the SAME issuer string with a key of its own, made here: the squatter of the record's review (A1)
const own = gitlabKey();
const regB = await register(B, { issuer: ISSUER, keys: { keys: [own.jwk] }, kid: own.kid });
record({ event: "registered", origin: ORIGIN, issuer: ISSUER, a: { audience: regA.audience, kid: regA.kid, thumbprint: regA.thumbprint, bits: regA.bits }, b: { audience: regB.audience, kid: regB.kid, note: "the same issuer string, registered by another tenant with a key of its own" } });
writeFileSync(join(OUT, "audiences.json"), `${JSON.stringify({ origin: ORIGIN, a: regA.audience, b: regB.audience }, null, 2)}\n`);

// The shell's screen, painted here as in a browser (the modules as src/http/assets.js serves them, the slot of the
// pinned views filled), over what the real routes answer: the decision reading of one application and its level.
const WEB = new URL("../web/", import.meta.url).pathname;
const VIEWS = new URL("../node_modules/runward-fleet/ui/views.js", import.meta.url);
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, getElementById: () => ({}) };
globalThis.localStorage = { getItem: (k) => (k === "rw-accueil-lang" ? "fr" : null), setItem() {}, removeItem() {} };
const served = mkdtempSync(join(tmpdir(), "rw-witness-shell-"));
for (const f of MODULES) {
  const p = join(served, f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href)));
}
const shell = { D: await import(pathToFileURL(join(served, "views/decision.js")).href), S: (await import(pathToFileURL(join(served, "views/base.js")).href)).S };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|\u00a0/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const args = (f) => { try { return JSON.parse(readFileSync(join(OUT, "ctl", f), "utf8") || "{}"); } catch { return {}; } };

const commands = {
  async declare({ project = PROJECT, mission = "demo", branch = "main" } = {}) {
    await A.verify("declare-with-consent", `gitlab:${regA.id}:${project.toLowerCase()}`);
    const r = await call("POST", "/api/v0/repositories", { body: { forge: "gitlab", issuer: regA.id, name: project, defaultBranch: branch, consent: true, missions: [{ id: mission, path: "." }] }, cookie: A.cookie });
    record({ event: "declare", project, mission, branch, status: r.status, state: r.body.state ?? null, refusal: r.body.refusal ?? null, message: r.body.message ?? null });
  },
  async confirm({ project = PROJECT } = {}) {
    const access = await call("GET", "/api/v0/access", { cookie: A.cookie });
    const repo = (access.body.repositories ?? []).find((x) => x.name === project);
    if (!repo?.pending) return record({ event: "confirm", project, status: null, refusal: "nothing pending to confirm", state: repo?.state ?? null });
    await A.verify("repository-confirm", confirmObject(repo.id, repo.pending.digest));
    const r = await call("POST", `/api/v0/repositories/${repo.id}/confirm`, { body: { digest: repo.pending.digest }, cookie: A.cookie });
    record({ event: "confirm", project, shown: { values: repo.pending.values ?? null, digest: repo.pending.digest, confirmable: repo.pending.confirmable ?? null }, status: r.status, published: r.body.published ?? null, refusal: r.body.refusal ?? null });
  },
  async reading({ mission = "demo" } = {}) {
    const status = await call("GET", "/api/v0/fleet/status", { cookie: A.cookie });
    const idx = await fetch(`http://127.0.0.1:${PORT}/f/${A.tenant}/index.json`, { headers: { cookie: A.cookie } });
    const index = idx.status === 200 ? await idx.json() : null;
    const session = await call("GET", "/api/v0/session", { cookie: A.cookie });
    Object.assign(shell.S, { index, status: status.body, fleetError: null, session: session.body });
    const painted = shell.D.viewDecision(mission);
    const html = typeof painted === "string" ? painted : painted?.html ?? "";
    const panel = html.match(/<section[^>]*lecture-niveau[\s\S]*?<\/section>|<[a-z]+[^>]*class="[^"]*lecture-niveau[^"]*"[\s\S]*?data-level-code[^<]*<\/p>/)?.[0] ?? "";
    const line = (status.body.lines ?? []).find((l) => l.mission === mission) ?? null;
    record({ event: "reading", mission, index: index ? { repository: index.missions.find((m) => m.id === mission)?.repository ?? null, verdict: index.missions.find((m) => m.id === mission)?.latest?.verdict ?? null } : { status: idx.status },
      line: line ? { state: line.state, forge: line.forge, level: line.level, accepted: line.accepted ? { runNumber: line.accepted.runNumber, runAttempt: line.accepted.runAttempt, commit: line.accepted.commit } : null, firstConfirmed: html.includes("premier contrôle confirmé") } : null,
      levelPanel: text(panel) });
  },
  async retire() {
    const access = await call("GET", "/api/v0/access", { cookie: A.cookie });
    const key = access.body.issuers[0].keys[0];
    await A.verify("issuer-key-retire", key.id);
    const r = await call("DELETE", `/api/v0/issuers/${regA.id}/keys/${key.id}`, { cookie: A.cookie });
    record({ event: "key-retired", status: r.status, receiving: r.body.receiving ?? null, kid: key.kid });
  },
  // the instance's kid, another key's signature: made here, since the instance signs nothing badly
  async forged() {
    const now = Math.floor(Date.now() / 1000);
    const token = own.sign({ iss: ISSUER, aud: regA.audience, iat: now, nbf: now - 5, exp: now + 3600, jti: randomUUID(), project_id: "1", project_path: PROJECT }, { kid: KID });
    await fetch(`http://127.0.0.1:${PORT}/api/v0/exports`, { method: "POST", body: "{}", headers: { authorization: `Bearer ${token}`, "runward-witness": "forged: the registered kid, another key's signature", "runward-mission": "demo", "runward-export-kind": "check", "content-digest": `sha-256=:${createHash("sha256").update("{}").digest("base64")}:` } });
  },
};
let stopped = false;
while (!stopped) {
  for (const f of readdirSync(join(OUT, "ctl"))) {
    if (f === "stop") { rmSync(join(OUT, "ctl", f)); stopped = true; break; }
    const given = args(f);
    rmSync(join(OUT, "ctl", f));
    try { if (commands[f]) await commands[f](given); else record({ event: "unknown-command", command: f }); } catch (e) { record({ event: "command-failed", command: f, error: String(e.message).slice(0, 200) }); }
  }
  await new Promise((r) => setTimeout(r, 500));
}
record({ event: "stopped", journals: await journals() });
rmSync(served, { recursive: true, force: true });
c.http.server.close();
