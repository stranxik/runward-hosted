// scripts/container-deploy.sh, the one writer of a container's image in deploy.yml and rollback.yml, run
// for real (bash, curl, jq) against a local stand-in of the hoster's containers API (v1beta1). The API
// replaces environment_variables as a whole on a PATCH (it documents a merge for the secret ones only), so
// the script reads the map, sets RW_IMAGE and RW_COMMIT on it and sends the whole map back; the stand-in
// replaces the map exactly like the hoster, so a script that sent only its two variables would lose the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../../scripts/container-deploy.sh", import.meta.url).pathname;
const ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = ["stand", "in", "key"].join("-");
const digest = (n) => `rg.fr-par.scw.cloud/runward/runward-hosted@sha256:${String(n).repeat(64).slice(0, 64)}`;
const ENV = { NODE_ENV: "production", DATABASE_SSL: "verify-full", DATABASE_CA: "-----BEGIN CERTIFICATE-----\nMII\n-----END CERTIFICATE-----\n", S3_BUCKET: "runward-hosted-objects", RW_IMAGE: digest(1), RW_COMMIT: "a".repeat(40) };

/** The hoster, as far as this script uses it: GET, PATCH (environment_variables replaced whole), POST deploy.
 * As in production (deploy run of 2026-11-10): an accepted PATCH starts a redeploy by itself (`pending` for
 * `pending` reads, then `ends`), and a POST /deploy on a container that is redeploying is answered 409.
 * `refuse` answers the PATCH itself 409, changing nothing (a container the hoster does not let be updated).
 * `early` reads after the PATCH still say `ready`, on the new digest and the old `ready_at`, before the
 * redeploy shows (then `pending`; with `pending: 0` the redeploy is over between two reads and only
 * `ready_at` tells it). `stamps: false` is a hoster whose `ready_at` never moves. `reads` counts the GETs
 * after the PATCH. */
async function hoster({ env = ENV, lose = null, pending = 0, ends = "ready", refuse = false, early = 0, stamps = true } = {}) {
  const state = { ready_at: "2026-11-10T10:00:00Z", registry_image: digest(1), status: "ready", environment_variables: { ...env }, secret_environment_variables: [{ key: "DATABASE_URL", hashed_value: "$argon2id$x" }] };
  const patches = [];
  const deploys = [];
  const out = { reads: 0 };
  let left = 0;
  let wait = 0;
  let patched = false;
  const redeployed = () => { if (stamps) state.ready_at = "2026-11-11T10:00:00Z"; };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers["x-auth-token"] !== TOKEN) { res.writeHead(401).end("{}"); return; }
      const path = `/containers/v1beta1/regions/fr-par/containers/${ID}`;
      if (req.method === "GET" && req.url === path) {
        const seen = JSON.stringify(state);
        if (patched) out.reads += 1;
        if (wait > 0) { if (--wait === 0) { if (pending > 0) { state.status = "pending"; left = pending; } else redeployed(); } }
        else if (state.status === "pending" && --left <= 0) { state.status = ends; if (ends === "error") state.error_message = "the image does not start"; else redeployed(); }
        res.writeHead(200, { "content-type": "application/json" }).end(seen); return;
      }
      if (req.method === "PATCH" && req.url === path) {
        const b = JSON.parse(body);
        patches.push(b);
        if (refuse) { res.writeHead(409, { "content-type": "application/json" }).end(JSON.stringify({ message: "resource is locked", type: "locked" })); return; }
        patched = true;
        if (early > 0) wait = early;
        else if (pending > 0) { state.status = "pending"; left = pending; }
        if (b.registry_image) state.registry_image = b.registry_image;
        if (b.environment_variables) state.environment_variables = { ...b.environment_variables }; // replaced, as the hoster does
        if (lose) delete state.environment_variables[lose];
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state)); return;
      }
      if (req.method === "POST" && req.url === `${path}/deploy`) {
        deploys.push(state.status);
        if (state.status === "pending") { res.writeHead(409, { "content-type": "application/json" }).end(JSON.stringify({ message: "resource is in a transient state", type: "transient_state" })); return; }
        res.writeHead(200).end(JSON.stringify(state)); return;
      }
      res.writeHead(404).end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { state, patches, deploys, out, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test("container-deploy: the tools it runs with are here (bash, curl, jq, as on the deploy runner ubuntu-24.04)", () => {
  // never skipped: a missing tool would otherwise read as a script failure, or worse, as nothing tested
  for (const tool of ["bash", "curl", "jq"]) assert.equal(spawnSync(tool, ["--version"]).status, 0, `${tool} is required by scripts/container-deploy.sh and by this test`);
});

function run(args, env, script = SCRIPT) {
  return new Promise((resolve) => {
    // the pause between two reads is 10 s against the hoster; the stand-in is read every 50 ms
    const child = spawn("bash", [script, ...args], { env: { PATH: process.env.PATH, CONTAINER_DEPLOY_PAUSE: "0.05", ...env } });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    const kill = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", (code) => { clearTimeout(kill); resolve({ code, out }); });
  });
}

test("container-deploy: a deploy keeps every variable of the container, sets RW_IMAGE and RW_COMMIT, sends no secret", async () => {
  const h = await hoster();
  try {
    const r = await run([ID, digest(2), "b".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: h.url });
    assert.equal(r.code, 0, r.out);
    assert.equal(h.patches.length, 1);
    const sent = h.patches[0];
    assert.equal(sent.registry_image, digest(2));
    assert.deepEqual(sent.environment_variables, { ...ENV, RW_IMAGE: digest(2), RW_COMMIT: "b".repeat(40) });
    assert.equal("secret_environment_variables" in sent, false, "the secrets are left to the hoster's merge");
    assert.deepEqual(h.state.environment_variables, { ...ENV, RW_IMAGE: digest(2), RW_COMMIT: "b".repeat(40) });
    assert.match(r.out, /serves rg\.fr-par/);
  } finally { await h.close(); }
});

test("container-deploy: a rollback without a commit removes RW_COMMIT (the image's own applies) and keeps the rest", async () => {
  const h = await hoster();
  try {
    const r = await run([ID, digest(3)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: h.url });
    assert.equal(r.code, 0, r.out);
    const { RW_COMMIT, ...rest } = ENV;
    assert.ok(RW_COMMIT);
    assert.deepEqual(h.state.environment_variables, { ...rest, RW_IMAGE: digest(3) });
  } finally { await h.close(); }
});

test("container-deploy: planted control, a variable lost by the update fails the deploy and names it", async () => {
  const h = await hoster({ lose: "DATABASE_CA" });
  try {
    const r = await run([ID, digest(4), "c".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: h.url });
    assert.equal(r.code, 1);
    assert.match(r.out, /variables lost by the update: DATABASE_CA/);
  } finally { await h.close(); }
});

test("container-deploy: an environment that reads empty is never sent back, and nothing is patched", async () => {
  const h = await hoster({ env: {} });
  try {
    const r = await run([ID, digest(5), "d".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: h.url });
    assert.equal(r.code, 1);
    assert.match(r.out, /reads empty: refused/);
    assert.equal(h.patches.length, 0);
  } finally { await h.close(); }
});

test("container-deploy: a tag, another registry, or an API other than the hoster's or the loopback is refused before any call", async () => {
  const h = await hoster();
  try {
    for (const [args, env, said] of [
      [[ID, "rg.fr-par.scw.cloud/runward/runward-hosted:latest"], { SCW_API_URL: h.url }, /not a digest of this registry/],
      [[ID, digest(6).replace("rg.fr-par", "rg.nl-ams")], { SCW_API_URL: h.url }, /not a digest of this registry/],
      [[ID, digest(6)], { SCW_API_URL: "https://api.example.com" }, /hoster's API or a loopback stand-in/],
    ]) {
      const r = await run(args, { SCW_SECRET_KEY: TOKEN, ...env });
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, said);
    }
    assert.equal(h.patches.length, 0);
  } finally { await h.close(); }
});

// The deploy of 2026-11-10: the PATCH was accepted, the hoster redeployed by itself, and the POST /deploy
// the script sent next was answered 409; the step failed with a container already changed, and so did the
// rollback's first line, which left the gateway on the new digest.

test("container-deploy: the update alone deploys; no POST /deploy is sent to a container that already redeploys, and the digest is waited for", async () => {
  const h = await hoster({ pending: 3 });
  try {
    const r = await run([ID, digest(7), "e".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: h.url });
    assert.equal(r.code, 0, r.out);
    assert.equal(h.patches.length, 1);
    assert.deepEqual(h.deploys, [], "a POST /deploy was sent");
    assert.equal(h.state.status, "ready");
    assert.match(r.out, /serves rg\.fr-par/);
  } finally { await h.close(); }
});

test("container-deploy: planted control, the script that still sends POST /deploy after the update fails on the stand-in's 409, as in production", async () => {
  const now = readFileSync(SCRIPT, "utf8");
  const mark = "\n# the pause between two reads";
  assert.equal(now.split(mark).length, 2, "the place where the old script sent its POST is not found");
  assert.equal(/-X POST/.test(now), false, "scripts/container-deploy.sh sends a POST again");
  const dir = mkdtempSync(join(tmpdir(), "rw-container-deploy-"));
  const h = await hoster({ pending: 3 });
  try {
    const old = join(dir, "container-deploy-old.sh");
    writeFileSync(old, now.replace(mark, `\ncurl -sSf --max-time 30 -X POST -H @<(auth) -H 'content-type: application/json' "$api/deploy" -d '{}' >/dev/null${mark}`));
    const r = await run([ID, digest(7), "e".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: h.url }, old);
    assert.equal(r.code, 22, r.out);
    assert.match(r.out, /error: 409/);
    assert.deepEqual(h.deploys, ["pending"]);
    assert.equal(h.state.registry_image, digest(7), "the container was changed before the failure, as in production");
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("container-deploy: a 409 of another kind, the update itself refused, fails with the status and the hoster's message, and nothing is waited for", async () => {
  const h = await hoster({ refuse: true });
  try {
    const r = await run([ID, digest(8), "f".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: h.url });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the update of \S+ was refused \(HTTP 409\): resource is locked/);
    assert.equal(/serves/.test(r.out), false);
    assert.equal(h.state.registry_image, digest(1));
    assert.deepEqual(h.deploys, []);
  } finally { await h.close(); }
});

test("container-deploy: a redeploy that ends in error fails and says the hoster's message; one that never ends fails after a bounded number of reads", async () => {
  const failed = await hoster({ pending: 2, ends: "error" });
  try {
    const r = await run([ID, digest(9), "a".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: failed.url });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is in error: the image does not start/);
  } finally { await failed.close(); }
  const stuck = await hoster({ pending: 1000 });
  try {
    const r = await run([ID, digest(9), "a".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: stuck.url });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not serve \S+ after 60 reads/);
  } finally { await stuck.close(); }
});

test("container-deploy: the pause between two reads is shortened for the loopback stand-in only, never for the hoster's API", () => {
  const text = readFileSync(SCRIPT, "utf8");
  assert.match(text, /^pause=10$/m);
  assert.match(text, /^\[\[ "\$base" == http:\/\/127\.0\.0\.1:\* && .*CONTAINER_DEPLOY_PAUSE.* \]\] && pause="\$CONTAINER_DEPLOY_PAUSE"$/m);
  assert.equal((text.match(/CONTAINER_DEPLOY_PAUSE/g) ?? []).length, 2, "CONTAINER_DEPLOY_PAUSE is read elsewhere");
});

// `ready` on the new digest, read right after the update, may still be the revision served before: the
// gateway has no /api/version behind it, and roles and migrate would then run on the old code.
test("container-deploy: ready on the new digest right after the update is not believed; the script waits for the redeploy it then sees (a status other than ready)", async () => {
  const h = await hoster({ early: 1, pending: 2, stamps: false });
  try {
    const r = await run([ID, digest(2), "b".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: h.url });
    assert.equal(r.code, 0, r.out);
    assert.equal(h.out.reads, 4, "ready (early), pending, pending, ready");
    assert.equal(h.state.status, "ready");
    assert.match(r.out, /serves \S+ \(redeploy seen: status pending\)/);
  } finally { await h.close(); }
});

test("container-deploy: planted control, the loop that accepts ready on the digest without the proof exits on the first read, while the container redeploys", async () => {
  const now = readFileSync(SCRIPT, "utf8");
  const guard = ' && [ -n "$proven" ]; then';
  const first = '\n[ "$changed" = "true" ] && sleep "$pause"\n';
  assert.equal(now.split(guard).length, 2, "the proof is not asked where ready on the digest is accepted");
  assert.equal(now.split(first).length, 2, "the first read does not wait one pause after an update that changed something");
  const dir = mkdtempSync(join(tmpdir(), "rw-container-deploy-"));
  const h = await hoster({ early: 1, pending: 2, stamps: false });
  try {
    const old = join(dir, "container-deploy-unproven.sh");
    writeFileSync(old, now.replace(guard, "; then").replace(first, "\n"));
    const r = await run([ID, digest(2), "b".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: h.url }, old);
    assert.equal(r.code, 0, r.out);
    assert.equal(h.out.reads, 1);
    assert.equal(h.state.status, "pending", "the control said served while the hoster was redeploying");
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("container-deploy: a redeploy over between two reads is told by ready_at alone; without any sign, ready on the digest is accepted after 6 reads, and said", async () => {
  const quick = await hoster({ early: 2 });
  try {
    const r = await run([ID, digest(2), "b".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: quick.url });
    assert.equal(r.code, 0, r.out);
    assert.equal(quick.out.reads, 3, "two reads on the old ready_at, one on the new");
    assert.match(r.out, /\(redeploy seen: ready_at 2026-11-11T10:00:00Z\)/);
  } finally { await quick.close(); }
  const mute = await hoster({ stamps: false });
  try {
    const r = await run([ID, digest(2), "b".repeat(40)], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: mute.url });
    assert.equal(r.code, 0, r.out);
    assert.equal(mute.out.reads, 6);
    assert.match(r.out, /showed no redeploy in 6 reads.*ready on the digest is accepted from here/);
    assert.match(r.out, /\(no redeploy seen\)/);
  } finally { await mute.close(); }
});

test("container-deploy: an update that changes nothing (the same digest, map and commit) has no redeploy to prove: one read", async () => {
  const h = await hoster({ stamps: false });
  try {
    const r = await run([ID, digest(1), ENV.RW_COMMIT], { SCW_SECRET_KEY: TOKEN, SCW_API_URL: h.url });
    assert.equal(r.code, 0, r.out);
    assert.equal(h.out.reads, 1);
    assert.match(r.out, /\(the update changed nothing\)/);
  } finally { await h.close(); }
});
