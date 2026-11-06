#!/usr/bin/env node
// CI only (job "image"): the image of this exact commit runs against a real PostgreSQL and a local S3, the
// way it runs at the hoster but on neither of the hoster's services (R9: portability exercised). Then the
// smoke, a real upload through the S3 path refused for the right reason, and a look at the logs.
//   IMAGE, PG_ADMIN_URL, SEND_TOKEN_FROM_THIS_JOB (yes on a push: a real OIDC token of this job is sent).
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { AwsClient } from "aws4fetch";
import { migrate } from "./migrate.mjs";

const { IMAGE, PG_ADMIN_URL, SEND_TOKEN_FROM_THIS_JOB, GITHUB_SHA, ACTIONS_ID_TOKEN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN } = process.env;
const ORIGIN = "http://localhost:8080";
const DB = `rw_ci_${randomBytes(3).toString("hex")}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlAs = (role) => { const u = new URL(PG_ADMIN_URL); u.username = role; u.pathname = `/${DB}`; return u.toString(); };
const fail = (m) => { console.error(`image-smoke: ${m}`); try { console.error(execFileSync("docker", ["logs", "rw"], { encoding: "utf8" }).slice(-4000)); } catch {} process.exit(1); };

const admin = postgres(PG_ADMIN_URL, { max: 1, onnotice: () => {} });
await admin.unsafe(`create database ${DB}`);
for (const r of ["rw_owner login", "rw_resolve nologin", "rw_app login nobypassrls", "rw_maint login nobypassrls"]) {
  const [name] = r.split(" ");
  if (!(await admin`select 1 from pg_roles where rolname = ${name}`).length) await admin.unsafe(`create role ${r}`);
}
await admin.unsafe(`grant rw_resolve to rw_owner; grant create, connect on database ${DB} to rw_owner; grant connect on database ${DB} to rw_app, rw_maint`);
await admin.end();
process.env.DATABASE_SSL = "disable";
await migrate(urlAs("rw_owner"), { log: console.log });

// the bucket, on the local S3 (any credentials: the local server checks none)
const aws = new AwsClient({ accessKeyId: "local", secretAccessKey: "local-only", service: "s3", region: "us-east-1" });
for (let i = 0; i < 30; i++) { const r = await aws.fetch("http://localhost:8333/rw-ci", { method: "PUT" }).catch(() => null); if (r && r.status < 500) break; await sleep(1000); }

const run = spawnSync("docker", ["run", "-d", "--name", "rw", "--network", "host", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "512m",
  "-e", `DATABASE_URL=${urlAs("rw_app")}`, "-e", "DATABASE_SSL=disable", "-e", "S3_ENDPOINT=http://localhost:8333", "-e", "S3_REGION=us-east-1", "-e", "S3_BUCKET=rw-ci",
  "-e", "S3_ACCESS_KEY_ID=local", "-e", "S3_SECRET_ACCESS_KEY=local-only", "-e", `RW_ORIGIN=${ORIGIN}`, "-e", `RW_COMMIT=${GITHUB_SHA}`, "-e", "RW_IMAGE=ci", "-e", "PORT=8080", IMAGE], { encoding: "utf8" });
if (run.status !== 0) fail(`docker run: ${run.stderr}`);
let up = false;
for (let i = 0; i < 40 && !up; i++) { await sleep(500); up = await fetch(`${ORIGIN}/api/health`).then((r) => r.ok, () => false); }
if (!up) fail("the image did not answer /api/health");

const smoke = spawnSync("node", ["scripts/smoke.mjs", ORIGIN, GITHUB_SHA], { encoding: "utf8" });
process.stdout.write(smoke.stdout); process.stderr.write(smoke.stderr);
if (smoke.status !== 0) fail("smoke");

if (SEND_TOKEN_FROM_THIS_JOB === "yes") {
  // A real token of this job, verified against GitHub's real keys: it must be refused because ci.yml is not
  // the send workflow, which proves the signature, issuer and audience passed.
  const t = await (await fetch(`${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(ORIGIN)}`, { headers: { authorization: `Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } })).json();
  const body = Buffer.from("{}");
  const r = await fetch(`${ORIGIN}/api/v0/exports`, { method: "POST", headers: { authorization: `Bearer ${t.value}`, "runward-mission": "ci", "runward-export-kind": "check", "content-digest": "sha-256=:RBNvo1WzZ4oRRq0W9+hknpT7T8If536DEMBg9hyq/4o=:" }, body });
  const b = await r.json();
  if (b.refusal !== "event-not-push" && b.refusal !== "called-workflow-not-pinned") fail(`a real token was refused for the wrong reason: ${b.refusal}`);
  console.log(`image-smoke: a real OIDC token of this job is verified, then refused ${b.refusal}`);
}
const logs = execFileSync("docker", ["logs", "rw"], { encoding: "utf8" });
if (/eyJ[A-Za-z0-9_-]{20,}/.test(logs)) fail("a token reached the logs");
if (!logs.split("\n").filter(Boolean).every((l) => { try { JSON.parse(l); return true; } catch { return false; } })) fail("a log line is not JSON");
execFileSync("docker", ["rm", "-f", "rw"]);
console.log(`image-smoke: ${IMAGE} served ${GITHUB_SHA} on PostgreSQL and S3, logs are JSON lines without a token`);
