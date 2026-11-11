// The composition root: configuration from the environment (twelve-factor III), checked at start; the
// service refuses to serve half configured (fail closed). Secrets are read from the environment only,
// never logged. The adapters chosen are said in one startup line.
import { createApp } from "./application/app.js";
import { memoryStore } from "./adapters/store/memory.js";
import { postgresStore } from "./adapters/store/postgres.js";
import { databaseTls, databaseTlsProblems } from "./adapters/store/tls.js";
import { memoryObjects, s3Objects } from "./adapters/objects/objects.js";
import { githubVerifier, GITHUB_ISSUER } from "./adapters/oidc/github.js";
import { gitlabComVerifier, GITLAB_COM_KEYS } from "./adapters/oidc/gitlab.js";
import { issuerRegistry } from "./adapters/oidc/registry.js";
import { simpleWebAuthn } from "./adapters/webauthn/simplewebauthn.js";
import { fleetAssembler, fleetPin } from "./adapters/fleet/assembler.js";
import { tar } from "./adapters/archive/tar.js";
import { boundFetch } from "./adapters/system/egress.js";
import { systemClock } from "./adapters/system/clock.js";
import { jsonLog } from "./adapters/system/log.js";
import { ulid } from "./adapters/system/ulid.js";
import { createHttp, routes, apiContract } from "./http/server.js";
import { buildAssets } from "./http/assets.js";
import { INDEX_FORMAT } from "runward-fleet";
import { readFileSync } from "node:fs";

const LOCK = new URL("../vendor/runward-fleet.lock.json", import.meta.url).pathname;
const SHA40 = /^[0-9a-f]{40}$/;
const DAILY_JOBS = ["retention", "verify-chains"];

/** An origin: http or https, a lower-case host, an optional port, nothing else (parsed, not matched). */
const isOrigin = (o) => { try { const u = new URL(o); return (u.protocol === "https:" || u.protocol === "http:") && u.origin === o && /^[a-z0-9.-]+$/.test(u.hostname); } catch { return false; } };

/** Read and check the configuration. Throws a list of what is missing, never a value. */
export function readConfig(env) {
  const problems = [];
  const origin = env.RW_ORIGIN ?? "https://app.runward.dev";
  if (!isOrigin(origin)) problems.push("RW_ORIGIN must be an origin (scheme, host, optional port)");
  const store = env.RW_STORE ?? (env.DATABASE_URL ? "postgres" : "missing");
  if (store === "missing") problems.push("DATABASE_URL is required (or RW_STORE=memory for a local witness)");
  if (store === "memory" && env.NODE_ENV === "production") problems.push("RW_STORE=memory is refused in production");
  const objects = env.RW_OBJECTS ?? (env.S3_BUCKET ? "s3" : store === "memory" ? "memory" : "missing");
  if (objects === "missing") problems.push("S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are required");
  if (objects === "s3") for (const k of ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) if (!env[k]) problems.push(`${k} is required`);
  let ca = env.DATABASE_CA ?? null;
  if (!ca && env.DATABASE_CA_FILE) { try { ca = readFileSync(env.DATABASE_CA_FILE, "utf8"); } catch { problems.push("DATABASE_CA_FILE cannot be read"); } }
  const tlsMode = env.DATABASE_SSL ?? "verify-full";
  if (store === "postgres") problems.push(...databaseTlsProblems({ url: env.DATABASE_URL, mode: tlsMode, ca, production: env.NODE_ENV === "production" }));
  // RW_TRUST_PROXY: how many proxies of the hoster stand in front of the service (0 or unset: none, the
  // socket's peer is the client); it chooses which X-Forwarded-For entry the rate limits count.
  const trustProxy = env.RW_TRUST_PROXY === undefined || env.RW_TRUST_PROXY === "" ? 0 : Number(env.RW_TRUST_PROXY);
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5) problems.push("RW_TRUST_PROXY must be an integer from 0 to 5 (the number of proxies in front of the service)");
  const published = (env.RW_SEND_WORKFLOW_SHAS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const s of published) if (!SHA40.test(s)) problems.push("RW_SEND_WORKFLOW_SHAS holds a value that is not a 40-hex commit");
  const revoked = (env.RW_SEND_WORKFLOW_REVOKED ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((x) => { const [sha, upgradeTo] = x.split(":"); return { sha, upgradeTo: upgradeTo ?? null }; });
  if (problems.length) { const e = new Error(`configuration refused:\n  - ${problems.join("\n  - ")}`); e.problems = problems; throw e; }
  const host = new URL(origin).host;
  return {
    origin, store, objects, port: Number(env.PORT ?? 8080),
    hosts: [host, ...(env.RW_EXTRA_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)],
    rpID: new URL(origin).hostname,
    commit: env.RW_COMMIT ?? "unknown", image: env.RW_IMAGE ?? "unknown",
    sendWorkflow: { published, revoked },
    readerRepositoryId: env.RW_READER_REPOSITORY_ID ?? null,
    issuer: env.RW_OIDC_ISSUER ?? GITHUB_ISSUER,
    securityTxt: `Contact: ${env.RW_SECURITY_CONTACT ?? "https://github.com/stranxik/runward-hosted/security/advisories/new"}\nExpires: ${env.RW_SECURITY_EXPIRES ?? "2027-11-06T00:00:00Z"}\nPreferred-Languages: fr, en\nCanonical: ${origin}/.well-known/security.txt\n`,
    s3: { endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    databaseUrl: env.DATABASE_URL, databaseTls: { mode: tlsMode, ca },
    trustProxy,
  };
}

export function compose(config, { clock = systemClock, log = jsonLog({ clock }), fetchImpl = globalThis.fetch, egressOptions = {}, store: givenStore, objects: givenObjects, authn: givenAuthn, verifier: givenVerifier } = {}) {
  const issuerHost = new URL(config.issuer).host;
  const s3Host = config.objects === "s3" ? new URL(config.s3.endpoint).host : null;
  // every call out has a deadline and each host a circuit breaker (egress.js, EGRESS_DEFAULTS)
  // the hosts outside the hoster: the keys of two public issuers, GitHub's and gitlab.com's, and the object
  // store (ADR-0029 section 1, which refines ADR-0001). RW_OIDC_ISSUER moves the first for a local witness
  // and never adds an issuer; a registered instance is never called: its keys are rows of its tenant.
  const egress = boundFetch([issuerHost, new URL(GITLAB_COM_KEYS).host, ...(s3Host ? [s3Host] : [])], fetchImpl, { now: () => clock.now(), ...egressOptions });
  const store = givenStore ?? (config.store === "postgres" ? postgresStore({ url: config.databaseUrl, ssl: databaseTls(config.databaseUrl, config.databaseTls) }) : memoryStore({ clock }));
  const objects = givenObjects ?? (config.objects === "s3" ? s3Objects({ ...config.s3, fetch: egress }) : memoryObjects());
  const pin = fleetPin({ lockFile: LOCK });
  // `verifier`, when given, is the GitHub adapter (a test's, a witness's): the registry of issuers is built
  // around it, as around the real one
  const github = givenVerifier ?? githubVerifier({ issuer: config.issuer, fetch: egress, clock });
  const ports = {
    store, objects, clock, log, ulid,
    verifier: issuerRegistry({ github, githubIssuer: config.issuer, gitlabCom: gitlabComVerifier({ fetch: egress, clock }), store, clock, origin: config.origin }),
    authn: givenAuthn ?? simpleWebAuthn({ rpID: config.rpID, origin: config.origin }),
    assembler: fleetAssembler({ pin }),
    archive: { pack: tar },
  };
  const app = createApp(ports, config);
  const assets = buildAssets({ pin, commit: config.commit });
  const version = {
    commit: config.commit, image: config.image,
    views: { runwardFleet: pin.version, runwardFleetCommit: pin.commit, runwardFleetArchiveSha256: pin.archiveSha256, viewsSha256: assets.viewsSha256 },
    apiContract: apiContract(routes(app)), indexFormat: INDEX_FORMAT, sendWorkflow: config.sendWorkflow.published,
  };
  const health = {
    async maintenance() { try { return await store.tx(null, (tx) => tx.maintenance()); } catch { return null; } },
    // the last run of each daily job and whether it completed (review finding of 2026-11-10: a failure was
    // noted in the operator journal and read by nothing); a job that never ran says null; the hourly probe
    // alerts on ok false and on a last run older than a day (scripts/probe-verdict.mjs)
    async dailyJobs() {
      try {
        const j = await store.tx(null, (tx) => tx.dailyJobs());
        return Object.fromEntries(DAILY_JOBS.map((k) => [k, j[k] ? { lastRun: new Date(j[k].at).toISOString(), ok: j[k].ok } : { lastRun: null, ok: null }]));
      } catch { return null; }
    },
    async body() {
      const [db, obj] = await Promise.all([store.ping().then(() => "ok", () => "down"), objects.ping().then((x) => (x ? "ok" : "down"), () => "down")]);
      return { status: db === "ok" && obj === "ok" ? 200 : 503, body: { ok: db === "ok" && obj === "ok", store: store.kind, objects: objects.kind, db, objectStore: obj, maintenance: db === "ok" ? await this.maintenance() : null, dailyJobs: db === "ok" ? await this.dailyJobs() : null } };
    },
  };
  const http = createHttp({ app, config, assets, version, health, log, clock });
  return { app, http, version, store, objects, ports, egress };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let config;
  try { config = readConfig(process.env); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(78); }
  const c = compose(config);
  const log = c.ports.log;
  log.info("start", { detail: { store: c.store.kind, objects: c.objects.kind, origin: config.origin, commit: config.commit, runwardFleet: c.version.views.runwardFleet, egress: c.egress.allowed, sendWorkflow: config.sendWorkflow.published.length } });
  if (c.store.kind === "memory") log.warn("store.memory", { detail: "in-memory store: nothing survives a restart (local witness only)" });
  c.http.server.listen(config.port, process.env.RW_BIND ?? "0.0.0.0");
  const stop = () => { c.http.server.close(() => c.store.close().finally(() => process.exit(0))); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
