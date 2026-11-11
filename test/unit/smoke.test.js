// The smoke's foreign-host check (found at the first deploy, 2026-11-10: behind the hoster it could not
// pass). Node derives the TLS server name from the Host header, so the handshake asked for a certificate
// the service does not hold; and the hoster's router picks the container by Host, so an unknown host is
// answered 404 by the router and never reaches the app. A local TLS server stands in for the hoster: it
// holds a certificate for the origin's name only, records the server name of each handshake, and routes
// by Host (the app's 421 for the service's default hostname, the router's 404 for an unknown host). The
// app's own guard is then asked through the real application on a real socket, and the script itself is
// run: it refuses an https origin without the service's host instead of passing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer } from "node:https";
import { createServer as createTcpServer } from "node:net";
import { foreignHostFault, hostToRefuse, FOREIGN_HOST } from "../../scripts/smoke.mjs";
import { readConfig, compose } from "../../src/main.js";
import { memoryStore } from "../../src/adapters/store/memory.js";
import { memoryObjects } from "../../src/adapters/objects/objects.js";
import { manualClock } from "../../src/adapters/system/clock.js";
import { silentLog } from "../../src/adapters/system/log.js";
import { fakeAuthn } from "../helpers.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const SERVICE_HOST = "rw-default-hostname.hoster.test"; // routed to the service by the stand-in, not served by the app
const REFUSAL = JSON.stringify({ refusal: "host-not-allowed", requestId: "r-000000000000" });

let dir, ca, hoster, origin;
const seen = []; // { servername, host } of each request that completed a handshake
let appAnswer = { status: 421, body: REFUSAL }; // what the "app" behind the stand-in answers for its default hostname

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "rw-smoke-"));
  const openssl = (args) => execFileSync("openssl", args, { stdio: "ignore" });
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=rw-smoke-ca",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign",
    "-keyout", join(dir, "ca.key"), "-out", join(dir, "ca.pem")]);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", join(dir, "origin.key"), "-out", join(dir, "origin.csr")]);
  // the certificate names the origin only, as the service's does: not the default hostname, not an IP
  writeFileSync(join(dir, "origin.ext"), "subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\n");
  openssl(["x509", "-req", "-in", join(dir, "origin.csr"), "-CA", join(dir, "ca.pem"), "-CAkey", join(dir, "ca.key"),
    "-CAcreateserial", "-days", "1", "-extfile", join(dir, "origin.ext"), "-out", join(dir, "origin.pem")]);
  ca = readFileSync(join(dir, "ca.pem"), "utf8");
  hoster = createTlsServer({ key: readFileSync(join(dir, "origin.key")), cert: readFileSync(join(dir, "origin.pem")) }, (req, res) => {
    const host = String(req.headers.host ?? "");
    seen.push({ servername: req.socket.servername, host });
    const json = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(body); };
    if (host === SERVICE_HOST) return json(appAnswer.status, appAnswer.body); // routed: the app answers
    if (host.replace(/:\d+$/, "") === "localhost") return json(200, JSON.stringify({ commit: "c0ffee" }));
    res.writeHead(404, { "content-type": "text/plain" }); res.end("404 page not found\n"); // the router's own answer
  });
  await new Promise((r) => hoster.listen(0, "127.0.0.1", r));
  origin = `https://localhost:${hoster.address().port}`;
});
after(() => { hoster?.close(); hoster?.closeAllConnections?.(); if (dir) rmSync(dir, { recursive: true, force: true }); });

test("the TLS server name stays the origin's while Host names the service's default hostname, and the app's 421 passes", async () => {
  seen.length = 0; appAnswer = { status: 421, body: REFUSAL };
  assert.equal(await foreignHostFault(origin, { host: SERVICE_HOST, ca }), null);
  assert.deepEqual(seen, [{ servername: "localhost", host: SERVICE_HOST }], "one request: server name of the origin, Host of the service");
});

test("a 404 from the router is a fault, never the app's guard: an unknown host does not reach the app", async () => {
  seen.length = 0;
  const fault = await foreignHostFault(origin, { host: FOREIGN_HOST, ca });
  assert.match(fault, /got 404, not the app's 421 host-not-allowed \(a 404 is the router's answer/);
  assert.deepEqual(seen, [{ servername: "localhost", host: FOREIGN_HOST }], "the handshake itself completed, on the origin's name");
});

test("a 421 that is not the app's refusal, and any other status, are faults", async () => {
  for (const [answer, expected] of [
    [{ status: 421, body: "Misdirected Request" }, /got 421, not the app's 421 host-not-allowed/],
    [{ status: 421, body: JSON.stringify({ refusal: "not-found" }) }, /got 421 not-found, not the app's/],
    [{ status: 200, body: JSON.stringify({ commit: "c0ffee" }) }, /got 200, not the app's/],
    [{ status: 403, body: REFUSAL }, /got 403 host-not-allowed, not the app's/],
  ]) {
    appAnswer = answer;
    assert.match(await foreignHostFault(origin, { host: SERVICE_HOST, ca }), expected, JSON.stringify(answer));
  }
  appAnswer = { status: 421, body: REFUSAL };
});

test("a failed handshake is a fault: a certificate that does not name the origin, an authority that is not trusted", async () => {
  const port = hoster.address().port;
  seen.length = 0;
  // the stand-in's certificate names localhost only: asked by IP, the origin's name is not in it
  assert.match(await foreignHostFault(`https://127.0.0.1:${port}`, { host: SERVICE_HOST, ca }), /no answer \(ERR_TLS_CERT_ALTNAME_INVALID\)/);
  // without the test's authority the certificate chain is not trusted
  assert.match(await foreignHostFault(origin, { host: SERVICE_HOST }), /no answer \((SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_GET_ISSUER_CERT_LOCALLY)\)/);
  assert.deepEqual(seen, [], "no request was answered");
  // a port where nothing listens
  const closed = createTcpServer(); await new Promise((r) => closed.listen(0, "127.0.0.1", r));
  const free = closed.address().port; await new Promise((r) => closed.close(r));
  assert.match(await foreignHostFault(`https://localhost:${free}`, { host: SERVICE_HOST, ca }), /no answer \(ECONNREFUSED\)/);
});

test("the host to refuse is never the origin's own", async () => {
  seen.length = 0;
  assert.match(await foreignHostFault(origin, { host: "localhost", ca }), /is the origin's own/);
  assert.match(await foreignHostFault(origin, { host: `LOCALHOST:${hoster.address().port}`, ca }), /is the origin's own/);
  // the root's trailing dot names the same host (review of 2026-11-10, C31, run S4: it was sent and passed)
  assert.match(await foreignHostFault(origin, { host: "localhost.", ca }), /is the origin's own/);
  assert.match(await foreignHostFault(origin, { host: `Localhost.:${hoster.address().port}`, ca }), /is the origin's own/);
  assert.deepEqual(seen, [], "nothing was asked");
});

test("which host is sent: the service's when given, elsewhere.example in plain http, and an https origin without it is refused", () => {
  assert.deepEqual(hostToRefuse("https://app.runward.dev", SERVICE_HOST), { host: SERVICE_HOST });
  assert.deepEqual(hostToRefuse("http://localhost:8080", undefined), { host: "elsewhere.example" });
  assert.deepEqual(hostToRefuse("http://localhost:8080", ""), { host: "elsewhere.example" });
  assert.deepEqual(hostToRefuse("http://localhost:8080", SERVICE_HOST), { host: SERVICE_HOST });
  for (const none of [undefined, "", "  "]) assert.match(hostToRefuse("https://app.runward.dev", none).refused, /an https origin needs RW_SERVICE_HOST/);
  for (const bad of ["https://x.example", "a b", "x.example/path", "x.example\r\nx-injected: 1"]) assert.equal(hostToRefuse("https://app.runward.dev", bad).refused, "RW_SERVICE_HOST is not a host name", bad);
});

/** The smoke as the workflows run it: the script, an origin, the environment. */
function smoke(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, "scripts/smoke.mjs"), ...args], { env: { PATH: process.env.PATH, ...env } });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; });
    p.on("close", (status) => resolve({ status, out, err }));
  });
}

test("the script against the real application in plain http: sound; the app's own 421 is what passes, and a host the app serves is a fault", async () => {
  // a port for the origin, known before the application is composed (its origin names it)
  const probe = createTcpServer(); await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port; await new Promise((r) => probe.close(r));
  const base = `http://127.0.0.1:${port}`;
  const clock = manualClock(Date.now());
  const config = readConfig({ RW_STORE: "memory", RW_ORIGIN: base, RW_EXTRA_HOSTS: "also-served.test", RW_COMMIT: "c0ffee", RW_IMAGE: "sha256:abc" });
  const c = compose(config, { clock, log: silentLog, store: memoryStore({ clock }), objects: memoryObjects(), authn: fakeAuthn() });
  await new Promise((r) => c.http.server.listen(port, "127.0.0.1", r));
  try {
    assert.equal(await foreignHostFault(base), null, "today's behaviour in CI: elsewhere.example, refused by the app");
    assert.match(await foreignHostFault(base, { host: "also-served.test" }), /got 200, not the app's 421/);
    const sound = await smoke([base, "c0ffee"]);
    assert.equal(sound.status, 0, sound.err);
    assert.match(sound.out, /^smoke: http:\/\/127\.0\.0\.1:\d+ sound at c0ffee\n$/);
    // the script does run its checks (an entry guard that failed would exit 0 with no output)
    const wrongCommit = await smoke([base, "deadbeef"]);
    assert.equal(wrongCommit.status, 1);
    assert.match(wrongCommit.err, /version serves c0ffee, not deadbeef/);
    const served = await smoke([base, "c0ffee"], { RW_SERVICE_HOST: "also-served.test" });
    assert.equal(served.status, 1);
    assert.match(served.err, /host also-served\.test got 200, not the app's 421 host-not-allowed/);
  } finally { await new Promise((r) => { c.http.server.close(r); c.http.server.closeAllConnections?.(); }); }
});

test("the script refuses an https origin without the service's host, exit 3, before asking anything", async () => {
  seen.length = 0;
  for (const env of [{}, { RW_SERVICE_HOST: "" }]) {
    const r = await smoke([origin, "c0ffee"], { ...env, NODE_EXTRA_CA_CERTS: join(dir, "ca.pem") });
    assert.equal(r.status, 3, r.err);
    assert.match(r.err, /smoke: cannot run: an https origin needs RW_SERVICE_HOST/);
    assert.equal(r.out, "");
  }
  assert.deepEqual(seen, [], "nothing was asked");
  assert.equal((await smoke([])).status, 3, "no origin");
});

test("the guard: a workflow that runs the smoke gives it vars.RW_SERVICE_HOST and refuses, before any secret, when it is empty", () => {
  const check = (env = {}) => spawnSync(process.execPath, [join(ROOT, "scripts/check-workflows.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  const clean = check();
  assert.equal(clean.status, 0, clean.stderr);
  const tmp = mkdtempSync(join(tmpdir(), "rw-guard-smoke-"));
  try {
    const wf = join(tmp, "workflows/"), sh = join(tmp, "scripts/");
    cpSync(join(ROOT, ".github/workflows"), wf, { recursive: true });
    mkdirSync(sh);
    const deploy = readFileSync(join(wf, "deploy.yml"), "utf8");
    const planted = (text) => { writeFileSync(join(wf, "deploy.yml"), text); return check({ RW_WORKFLOWS_DIR: wf, RW_SCRIPTS_DIR: sh }); };
    const env = '        env: { RW_SERVICE_HOST: "${{ vars.RW_SERVICE_HOST }}" }\n        run: node scripts/smoke.mjs';
    assert.ok(deploy.includes(env), "deploy.yml gives the smoke the service's host");
    // the workflow as it was before this fix: the smoke without the host
    const without = planted(deploy.replace(env, "        run: node scripts/smoke.mjs"));
    assert.equal(without.status, 1);
    assert.match(without.stderr, /deploy\.yml: a step runs scripts\/smoke\.mjs without RW_SERVICE_HOST from vars\.RW_SERVICE_HOST/);
    // the refusal removed: the deploy would build, switch the service, fail its smoke and roll back
    const refusal = /      - name: the smoke can reach the app's own 421[^\n]*\n(?: {8}[^\n]*\n)+/;
    assert.match(deploy, refusal);
    const unrefused = planted(deploy.replace(refusal, ""));
    assert.equal(unrefused.status, 1);
    assert.match(unrefused.stderr, /deploy\.yml: no step refuses when vars\.RW_SERVICE_HOST is empty/);
    // the refusal moved after the build
    const step = refusal.exec(deploy)[0];
    const late = planted(deploy.replace(step, "").replace("      - name: the operator's gateway serves the new digest", `${step}      - name: the operator's gateway serves the new digest`));
    assert.equal(late.status, 1);
    assert.match(late.stderr, /deploy\.yml: the refusal of an empty vars\.RW_SERVICE_HOST comes after a step that holds a secret/);
    // C30 (review of 2026-11-10): the rule read the text's order, not the jobs', and did not see a refusal
    // that cannot fire. Each planted workflow below passed the guard at 22a983b.
    const refused = (text, said, what) => { const r = planted(text); assert.equal(r.status, 1, `${what}: ${r.stdout}`); assert.match(r.stderr, said, what); };
    // N9: the refusal moved into a job nothing needs, placed before `deploy` in the text
    const orphan = `  refuse:\n    runs-on: ubuntu-24.04\n    steps:\n${step}\n`;
    assert.ok(deploy.includes("  deploy:\n    needs: verdict\n"));
    refused(deploy.replace(step, "").replace("  deploy:\n    needs: verdict\n", `${orphan}  deploy:\n    needs: verdict\n`),
      /deploy\.yml: the job deploy holds a secret and neither refuses an empty vars\.RW_SERVICE_HOST first nor needs a job that does/, "N9");
    // the same job, needed by deploy: the refusal runs first, by the jobs' order
    const neededJob = planted(deploy.replace(step, "").replace("  deploy:\n    needs: verdict\n", `${orphan}  deploy:\n    needs: [verdict, refuse]\n`));
    assert.equal(neededJob.status, 0, neededJob.stderr);
    // N4 and N5: a refusal that may be skipped, or that does not stop the job
    const head = step.split("\n")[0];
    refused(deploy.replace(step, step.replace(head, `${head}\n        if: \${{ false }}`)), /deploy\.yml: the step that refuses an empty vars\.RW_SERVICE_HOST carries if: or continue-on-error:/, "N4");
    refused(deploy.replace(step, step.replace(head, `${head}\n        continue-on-error: true`)), /deploy\.yml: the step that refuses an empty vars\.RW_SERVICE_HOST carries if: or continue-on-error:/, "N5");
    refused(deploy.replace("  deploy:\n    needs: verdict\n", "  deploy:\n    needs: verdict\n    continue-on-error: true\n"), /deploy\.yml: the job deploy holds a secret and neither refuses/, "the refusing job itself may fail and go on");
    // N8: the smoke through an npm script, without the host; by the script's name, then by what it runs
    const smokeStep = `${env} "$SERVICE" "\${{ github.sha }}"`;
    assert.ok(deploy.includes(smokeStep));
    refused(deploy.replace(smokeStep, '        run: npm run smoke -- "$SERVICE"'), /deploy\.yml: a step runs scripts\/smoke\.mjs without RW_SERVICE_HOST/, "N8");
    const pkg = join(tmp, "package.json");
    writeFileSync(pkg, JSON.stringify({ scripts: { "verify:served": "node scripts/smoke.mjs", "verify:image": "node scripts/image-smoke.mjs" } }));
    const viaScript = (name) => { writeFileSync(join(wf, "deploy.yml"), deploy.replace(smokeStep, `        run: npm run ${name} -- "$SERVICE"`)); return check({ RW_WORKFLOWS_DIR: wf, RW_SCRIPTS_DIR: sh, RW_PACKAGE_JSON: pkg }); };
    assert.match(viaScript("verify:served").stderr, /deploy\.yml: a step runs scripts\/smoke\.mjs without RW_SERVICE_HOST/, "N8, the script named otherwise");
    assert.equal(viaScript("verify:image").status, 0, "the image's own smoke, over plain http, is another script");
    // N10: a secret in the workflow-level env, which every step holds, the refusal included
    assert.ok(deploy.includes("env:\n  REGION: fr-par\n"));
    refused(deploy.replace("env:\n  REGION: fr-par\n", 'env:\n  SCW_SECRET_KEY: "${{ secrets.SCW_SECRET_KEY }}"\n  REGION: fr-par\n'), /deploy\.yml: a secret in the workflow-level env/, "N10");
    refused(deploy.replace("    environment: production\n    permissions: { contents: read }\n    outputs:", '    environment: production\n    env: { SCW_SECRET_KEY: "${{ secrets.SCW_SECRET_KEY }}" }\n    permissions: { contents: read }\n    outputs:'),
      /deploy\.yml: the job deploy holds a secret in its own env, before its refusal/, "a secret in the refusing job's env");
    // C28 and C31: the two comparisons of deploy.yml cannot be dropped, weakened or moved
    const grants = "          scripts/operator-call.sh grants\n";
    assert.ok(deploy.includes(`          scripts/operator-call.sh migrate\n${grants}`));
    refused(deploy.replace(grants, ""), /deploy\.yml: no step compares the grants of rw_app and rw_maint with the snapshot right after migrate/, "the grants' comparison removed");
    refused(deploy.replace(`          scripts/operator-call.sh migrate\n${grants}`, `${grants}          scripts/operator-call.sh migrate\n`), /deploy\.yml: no step compares the grants/, "the grants compared before migrate");
    // the form of 2026-11-10, which the gateway now refuses (roles takes no argument), is not a comparison
    refused(deploy.replace(grants, "          scripts/operator-call.sh roles '{\"grants\":true}'\n"), /deploy\.yml: no step compares the grants/, "the comparison asked of roles, as rw_admin");
    const hostCheck = '          scripts/service-host-check.sh "$RW_SERVICE_HOST" <<<"$svc"\n';
    assert.ok(deploy.includes(hostCheck));
    refused(deploy.replace(hostCheck, ""), /deploy\.yml: no step compares vars\.RW_SERVICE_HOST with the hostname the hoster reports/, "the host's comparison removed");
    const firstOutput = '          echo "previous=$(jq -r .registry_image <<<"$svc")" >> "$GITHUB_OUTPUT"\n';
    assert.ok(deploy.includes(firstOutput));
    refused(deploy.replace(hostCheck, "").replace(firstOutput, `${firstOutput}${hostCheck}`), /deploy\.yml: the comparison of vars\.RW_SERVICE_HOST with the hoster's hostname comes after the step wrote its outputs/, "the host compared after the rollback targets were written");
    assert.equal(planted(deploy).status, 0, "the workflow as committed passes in the copy");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// C31 (review of 2026-11-10): vars.RW_SERVICE_HOST was compared with the origin only. deploy.yml now gives
// the container the hoster returned to scripts/service-host-check.sh, run here for real (bash, jq).
test("service-host-check.sh: only the hostname the hoster reports for the service's container passes; anything unreadable is a refusal", () => {
  const HOST = "rwdefault0a1b2c3d-rw.functions.hoster.test";
  const run = (want, stdin) => spawnSync("bash", [join(ROOT, "scripts/service-host-check.sh"), ...(want === null ? [] : [want])], { input: stdin, encoding: "utf8", env: { PATH: process.env.PATH } });
  const container = (o) => JSON.stringify({ id: "11111111-2222-4333-8444-555555555555", registry_image: "x", ...o });
  for (const tool of ["bash", "jq"]) assert.equal(spawnSync(tool, ["--version"]).status, 0, `${tool} is required by scripts/service-host-check.sh and by this test`);
  for (const [want, reported] of [[HOST, HOST], [HOST.toUpperCase(), HOST], [`${HOST}.`, HOST], [HOST, `${HOST}.`], [HOST, HOST.replace("rwdefault", "RWdefault")]]) {
    const r = run(want, container({ domain_name: reported }));
    assert.equal(r.status, 0, `${want} against ${reported}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^service-host: RW_SERVICE_HOST is the service's container's own hostname at the hoster\n$/);
  }
  const refusals = [
    ["another routed host", "other0a1b2c3d-rw.functions.hoster.test", container({ domain_name: HOST }), /is not the hostname the hoster reports/],
    ["a prefix of it", HOST.slice(0, -1), container({ domain_name: HOST }), /is not the hostname the hoster reports/],
    ["two trailing dots", `${HOST}..`, container({ domain_name: HOST }), /is not the hostname the hoster reports/],
    ["a scheme", `https://${HOST}`, container({ domain_name: HOST }), /is not the hostname the hoster reports/],
    ["the variable empty", "", container({ domain_name: HOST }), /RW_SERVICE_HOST is empty/],
    ["no argument", null, container({ domain_name: HOST }), /RW_SERVICE_HOST is empty/],
    ["an answer without the field", HOST, container({}), /names no hostname \(domain_name\)/],
    ["the field empty", HOST, container({ domain_name: "" }), /names no hostname/],
    ["the field not a string", HOST, container({ domain_name: [HOST] }), /names no hostname/],
    ["the field null", HOST, container({ domain_name: null }), /names no hostname/],
    ["an answer that is not JSON", HOST, "<html>502</html>", /names no hostname/],
    ["an empty answer", HOST, "", /names no hostname/],
  ];
  for (const [what, want, stdin, said] of refusals) {
    const r = run(want, stdin);
    assert.equal(r.status, 1, `${what}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, said, what);
  }
});
