// scripts/container-deploy.sh, the one writer of a container's image in deploy.yml and rollback.yml, run
// for real (bash, curl, jq) against a local stand-in of the hoster's containers API (v1beta1). The API
// replaces environment_variables as a whole on a PATCH (it documents a merge for the secret ones only), so
// the script reads the map, sets RW_IMAGE and RW_COMMIT on it and sends the whole map back; the stand-in
// replaces the map exactly like the hoster, so a script that sent only its two variables would lose the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";

const SCRIPT = new URL("../../scripts/container-deploy.sh", import.meta.url).pathname;
const ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = ["stand", "in", "key"].join("-");
const digest = (n) => `rg.fr-par.scw.cloud/runward/runward-hosted@sha256:${String(n).repeat(64).slice(0, 64)}`;
const ENV = { NODE_ENV: "production", DATABASE_SSL: "verify-full", DATABASE_CA: "-----BEGIN CERTIFICATE-----\nMII\n-----END CERTIFICATE-----\n", S3_BUCKET: "runward-hosted-objects", RW_IMAGE: digest(1), RW_COMMIT: "a".repeat(40) };

/** The hoster, as far as this script uses it: GET, PATCH (environment_variables replaced whole), POST deploy. */
async function hoster({ env = ENV, lose = null } = {}) {
  const state = { registry_image: digest(1), status: "ready", environment_variables: { ...env }, secret_environment_variables: [{ key: "DATABASE_URL", hashed_value: "$argon2id$x" }] };
  const patches = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers["x-auth-token"] !== TOKEN) { res.writeHead(401).end("{}"); return; }
      const path = `/containers/v1beta1/regions/fr-par/containers/${ID}`;
      if (req.method === "GET" && req.url === path) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state)); return; }
      if (req.method === "PATCH" && req.url === path) {
        const b = JSON.parse(body);
        patches.push(b);
        if (b.registry_image) state.registry_image = b.registry_image;
        if (b.environment_variables) state.environment_variables = { ...b.environment_variables }; // replaced, as the hoster does
        if (lose) delete state.environment_variables[lose];
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state)); return;
      }
      if (req.method === "POST" && req.url === `${path}/deploy`) { state.status = "ready"; res.writeHead(200).end(JSON.stringify(state)); return; }
      res.writeHead(404).end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { state, patches, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test("container-deploy: the tools it runs with are here (bash, curl, jq, as on the deploy runner ubuntu-24.04)", () => {
  // never skipped: a missing tool would otherwise read as a script failure, or worse, as nothing tested
  for (const tool of ["bash", "curl", "jq"]) assert.equal(spawnSync(tool, ["--version"]).status, 0, `${tool} is required by scripts/container-deploy.sh and by this test`);
});

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn("bash", [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env } });
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
