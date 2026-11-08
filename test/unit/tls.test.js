// TLS to PostgreSQL is verified (review finding of 2026-11-08: DATABASE_SSL=require gave the client
// rejectUnauthorized: false). A local server answers the PostgreSQL SSLRequest and then speaks TLS with a
// server certificate signed by a local authority, both made here by openssl. The served certificate has
// the shape of the Scaleway instance's (subject CN=<ip>, SAN DNS:<ip> and IP:<ip>); the real client
// library connects through the service's own TLS configuration. The right authority and an IP named in
// the IP SANs complete the handshake; another authority, an IP absent from the SANs, an IP that is only a
// DNS SAN, or a server that declines TLS, are refused before any byte of the protocol.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { TLSSocket, createSecureContext } from "node:tls";
import postgres from "postgres";
import { databaseTls, databaseTlsProblems } from "../../src/adapters/store/tls.js";
import { migrationTls } from "../../scripts/migrate.mjs";
import { readConfig } from "../../src/main.js";
import { postgresStore } from "../../src/adapters/store/postgres.js";

let dir, ca, otherCa, server, port;
const served = {};
let current = null; // the certificate the server presents, or "decline" (answers N to the SSLRequest)
const handshakes = [];

const openssl = (args) => execFileSync("openssl", args, { stdio: "ignore" });
function authority(name) {
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", `/CN=${name}`,
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign",
    "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.pem`)]);
  return readFileSync(join(dir, `${name}.pem`), "utf8");
}
function serverCert(name, cn, san) {
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${cn}`, "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.csr`)]);
  writeFileSync(join(dir, `${name}.ext`), `subjectAltName=${san}\nbasicConstraints=CA:FALSE\n`);
  openssl(["x509", "-req", "-in", join(dir, `${name}.csr`), "-CA", join(dir, "rw-ca.pem"), "-CAkey", join(dir, "rw-ca.key"),
    "-CAcreateserial", "-days", "1", "-extfile", join(dir, `${name}.ext`), "-out", join(dir, `${name}.pem`)]);
  return createSecureContext({ key: readFileSync(join(dir, `${name}.key`)), cert: readFileSync(join(dir, `${name}.pem`)) });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "rw-tls-"));
  ca = authority("rw-ca");
  otherCa = authority("rw-other-ca");
  served.instance = serverCert("instance", "127.0.0.1", "DNS:127.0.0.1,IP:127.0.0.1");
  served.elsewhere = serverCert("elsewhere", "127.0.0.2", "DNS:127.0.0.2,IP:127.0.0.2");
  served.dnsOnly = serverCert("dns-only", "127.0.0.1", "DNS:127.0.0.1");
  server = createServer((sock) => {
    sock.on("error", () => {});
    sock.once("data", () => {
      if (current === "decline") { sock.write("N"); return; }
      sock.write("S");
      const t = new TLSSocket(sock, { isServer: true, secureContext: current });
      t.on("secure", () => { handshakes.push("secure"); t.destroy(); });
      t.on("error", () => {});
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => { server?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

async function attempt(cert, host, ssl) {
  current = cert;
  const before = handshakes.length;
  const url = `postgres://rw@${host}:${port}/db`;
  const sql = postgres(url, { max: 1, ssl: typeof ssl === "function" ? ssl(url) : ssl, connect_timeout: 3, onnotice: () => {} });
  const error = await sql`select 1`.then(() => null, (e) => e);
  await sql.end({ timeout: 1 }).catch(() => {});
  return { handshake: handshakes.length > before, error, said: String(error?.code ?? "") + " " + String(error?.message ?? "") };
}
const service = (tls) => (url) => databaseTls(url, tls);

test("database TLS: the instance's authority and an IP named in the IP SANs complete the handshake", async () => {
  const r = await attempt(served.instance, "127.0.0.1", service({ mode: "verify-full", ca }));
  assert.equal(r.handshake, true, `no handshake: ${r.said}`);
});

test("database TLS: the migration and witness scripts verify the same way (DATABASE_CA)", async () => {
  const env = { DATABASE_SSL: "verify-full", DATABASE_CA: ca, NODE_ENV: "production" };
  assert.equal((await attempt(served.instance, "127.0.0.1", (url) => migrationTls(url, env))).handshake, true);
  assert.equal((await attempt(served.instance, "127.0.0.1", (url) => migrationTls(url, { ...env, DATABASE_CA: otherCa }))).handshake, false);
  assert.throws(() => migrationTls("postgres://rw@10.0.0.4/db", { DATABASE_SSL: "require", NODE_ENV: "production", DATABASE_CA: ca }), /without verifying/);
  assert.throws(() => migrationTls("postgres://rw@10.0.0.4/db", { NODE_ENV: "production" }), /DATABASE_CA or DATABASE_CA_FILE is required/);
});

test("database TLS: a certificate from another authority is refused (the client never sets rejectUnauthorized: false)", async () => {
  const r = await attempt(served.instance, "127.0.0.1", service({ mode: "verify-full", ca: otherCa }));
  assert.equal(r.handshake, false);
  assert.match(r.said, /UNABLE_TO_VERIFY|unable to verify|SELF_SIGNED|self[- ]signed/i);
});

test("database TLS: an IP address absent from the certificate's SANs is refused", async () => {
  const r = await attempt(served.elsewhere, "127.0.0.1", service({ mode: "verify-full", ca }));
  assert.equal(r.handshake, false);
  assert.match(r.said, /ERR_TLS_CERT_ALTNAME_INVALID/);
  assert.match(r.said, /IP: 127\.0\.0\.1 is not in the cert's list/);
});

test("database TLS: an IP address that the certificate names only as a DNS SAN is refused (Node wants the IP type)", async () => {
  const r = await attempt(served.dnsOnly, "127.0.0.1", service({ mode: "verify-full", ca }));
  assert.equal(r.handshake, false);
  assert.match(r.said, /ERR_TLS_CERT_ALTNAME_INVALID/);
});

test("database TLS: a host name that the certificate does not name is refused", async () => {
  const r = await attempt(served.instance, "localhost", service({ mode: "verify-full", ca }));
  assert.equal(r.handshake, false);
  assert.match(r.said, /ERR_TLS_CERT_ALTNAME_INVALID/);
});

test("database TLS: a server that declines TLS is never spoken to in clear", async () => {
  const r = await attempt("decline", "127.0.0.1", service({ mode: "verify-full", ca }));
  assert.equal(r.handshake, false);
  assert.ok(r.error, "the query must fail");
});

test("database TLS: why the explicit identity check exists (a bare { ca, rejectUnauthorized } checks the name localhost, not the IP)", async () => {
  // The client hands its own socket to tls.connect and sets no servername for an IP address; Node then
  // checks the certificate against "localhost". Against the instance's certificate this refuses a
  // legitimate server, which is why databaseTls passes the URL's host to checkServerIdentity.
  const r = await attempt(served.instance, "127.0.0.1", { ca, rejectUnauthorized: true });
  assert.equal(r.handshake, false);
  assert.match(r.said, /Host: localhost/);
});

test("database TLS: the store refuses a mode string, and the TLS options never skip the check", () => {
  for (const ssl of ["require", "prefer", "allow", "verify-full", { rejectUnauthorized: false }, null]) {
    assert.throws(() => postgresStore({ url: "postgres://rw@127.0.0.1/db", ssl }), /verifying TLS configuration/, String(ssl));
  }
  const o = databaseTls("postgres://rw@10.0.0.4:5432/db", { mode: "verify-full", ca });
  assert.equal(o.rejectUnauthorized, true);
  assert.equal(o.host, "10.0.0.4");
  assert.equal(databaseTls("postgres://rw@10.0.0.4/db", { mode: "disable" }), false);
  assert.throws(() => databaseTls("postgres://rw@10.0.0.4/db", { mode: "require" }), /refused/);
});

test("database TLS in production: verify-full with the authority, or the service does not start", () => {
  const base = { NODE_ENV: "production", DATABASE_URL: "postgres://rw_app@10.0.0.4:5432/runward_hosted", S3_BUCKET: "b", S3_ENDPOINT: "https://s3.fr-par.scw.cloud", S3_REGION: "fr-par", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };
  const refused = (env) => { try { readConfig(env); return []; } catch (e) { return e.problems; } };
  assert.match(refused({ ...base, DATABASE_SSL: "require" }).join(), /without verifying the certificate/);
  assert.match(refused({ ...base, DATABASE_SSL: "disable" }).join(), /refused in production/);
  assert.match(refused({ ...base }).join(), /DATABASE_CA or DATABASE_CA_FILE is required in production/);
  assert.deepEqual(refused({ ...base, DATABASE_CA: ca }), []);
  assert.deepEqual(refused({ ...base, DATABASE_URL: "postgres://rw_app@localhost:5432/x", DATABASE_SSL: "disable" }), [], "loopback (the CI image smoke) crosses no network");
  assert.deepEqual(databaseTlsProblems({ url: "postgres://x@10.0.0.4/db", mode: "verify-full", ca: null, production: false }), [], "outside production the system roots may serve");
});

test("database TLS: every PostgreSQL client of the tree goes through the verifying configuration", async () => {
  // A script that builds its own `ssl` (a mode string, or { ca, rejectUnauthorized } without the identity
  // check) is the defect coming back: scripts/roles.mjs, migrate.mjs and isolation-deployed.mjs call
  // migrationTls, the store takes databaseTls. The only exemption is the CI image smoke's administrator on
  // the loopback interface, where no network is crossed.
  const { readdirSync, readFileSync: read } = await import("node:fs");
  const root = new URL("../../", import.meta.url).pathname;
  const walk = (d) => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.m?js$/.test(e.name) ? [join(d, e.name)] : []);
  const files = [...walk("src"), ...walk("scripts")];
  const EXEMPT = new Set(["scripts/image-smoke.mjs"]);
  const faults = [];
  let clients = 0;
  for (const f of files) {
    const text = read(join(root, f), "utf8");
    if (/rejectUnauthorized\s*:\s*false/.test(text)) faults.push(`${f}: rejectUnauthorized: false`);
    for (const m of text.matchAll(/\bpostgres\(([^\n]*)/g)) {
      clients++;
      if (EXEMPT.has(f)) continue;
      const verified = /ssl:\s*(migrationTls|databaseTls)\(/.test(m[1]) || (f === "src/adapters/store/postgres.js" && /\{\s*max,\s*ssl,/.test(m[1]));
      if (!verified) faults.push(`${f}: postgres(${m[1].slice(0, 80)}`);
    }
  }
  assert.ok(clients >= 3, "the scan sees the clients (positive control)");
  assert.deepEqual(faults, []);
});
