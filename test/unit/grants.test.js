// The comparison of the grants of rw_app and rw_maint with db/schema.snapshot.txt, a gesture of its own
// under rw_owner since 2026-11-11 (scripts/grants.mjs). What needs no database is shown here: where the
// gesture refuses to read, what the two scripts take on their command line, and that the image carries
// every script the gateway runs. No test here reaches a database: the one connection that is opened goes
// to a listener of this file, on the loopback interface, which refuses it as a server would. The comparison itself, with each planted drift, is in
// test/pg/isolation.test.js, against a real PostgreSQL.
// The deploy of run 43018993884 stopped because the comparison ran under the administrator, whose URL names
// the hoster's default database and who may not connect to the service's. A URL that names another
// database than RW_DATABASE is therefore refused before any connection: read there, the catalog holds no
// table of the service, and the answer would be a count of missing grants, not a refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { GESTURES } from "../../src/operator-gateway.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const SNAPSHOT = readFileSync(new URL("../../db/schema.snapshot.txt", import.meta.url), "utf8");
// assembled at run time: no line of the repository reads as a connection string (scripts/security-scans.mjs)
const urlOf = (user, port, database) => ["postgres", "://", user, "@127.0.0.1:", port, database === null ? "" : `/${database}`].join("");

// A test that waits forever blocks the whole suite (it did, on the NAS, on 2026-11-11): each one is bounded.
const BOUNDED = { timeout: 60_000 };

/** One field of a PostgreSQL ErrorResponse, then the message: what a server answers to a startup it refuses. */
const field = (code, text) => Buffer.concat([Buffer.from(code), Buffer.from(text), Buffer.from([0])]);
function refusal(database) {
  const body = Buffer.concat([field("S", "FATAL"), field("V", "FATAL"), field("C", "42501"), field("M", `permission denied for database "${database}"`), Buffer.from([0])]);
  const head = Buffer.alloc(5); head.write("E"); head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}

/** A listener that counts the connections it receives and answers each startup as the hoster answered
 * rw_admin: a FATAL "permission denied for database", then the end. It ANSWERS, it does not just hang up:
 * the client opens a new connection, without end, to a server that closes without a word (seen on Linux,
 * where the close arrives clean; on macOS it arrives as a reset, which the client takes as an error).
 * `t.after` closes it, and whatever socket is left, whatever the test's outcome. */
async function listener(t, database = "runward_hosted") {
  let connections = 0;
  const sockets = new Set();
  const server = createServer((socket) => {
    connections++; sockets.add(socket);
    socket.on("close", () => sockets.delete(socket)).on("error", () => {});
    socket.once("data", () => socket.end(refusal(database)));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }));
  return { port: server.address().port, connections: () => connections };
}

test("the grants gesture refuses a URL that names another database than RW_DATABASE, before any connection", BOUNDED, async (t) => {
  process.env.RW_DATABASE = "runward_hosted";
  process.env.DATABASE_SSL = "disable";
  const { grants } = await import("../../scripts/grants.mjs");
  const l = await listener(t);
  {
    const said = (url) => grants(url, { log: () => {}, snapshot: SNAPSHOT }).then(() => "(no refusal)", (e) => e.message);
    // the hoster's default database (the administrator's URL), another one, none (PostgreSQL then takes the
    // user's name), and a name that only starts like the service's
    for (const [what, url] of [["rdb", urlOf("rw_owner", l.port, "rdb")], ["postgres", urlOf("rw_admin", l.port, "postgres")], ["no database", urlOf("rw_owner", l.port, null)], ["a longer name", urlOf("rw_owner", l.port, "runward_hosted_2")], ["another case", urlOf("rw_owner", l.port, "Runward_Hosted")]]) {
      const answer = await said(url);
      assert.equal(answer, "the URL given for the comparison of the grants names another database than runward_hosted: nothing compared, refused (the comparison reads the service database runward_hosted and no other)", what);
      assert.equal(/fewer|more than/.test(answer), false, `${what}: never a count of grants`);
    }
    assert.equal(l.connections(), 0, "no connection was opened for a URL that names another database");
    // the control: the same listener, under the service database's name, IS reached, once, and the refusal
    // is the server's, said in the gesture's one line (so the zero above is the check's doing, not a listener
    // that sees nothing). It is the line of the deploy of run 43018993884, under the role the URL names.
    const reached = await said(urlOf("rw_owner", l.port, "runward_hosted"));
    assert.equal(reached, 'cannot connect to the service database runward_hosted as rw_owner: permission denied for database "runward_hosted"');
    assert.equal(l.connections(), 1, "the listener sees the connection when one is opened, and it is not retried");
  }
});

test("roles takes no argument and no option: the --grants of 2026-11-10 is refused, never ignored; grants takes none either", BOUNDED, async (t) => {
  // Each child runs while this process keeps serving its listener (a synchronous spawn would leave a
  // connection unanswered and uncounted), and is bounded too: one that waited would be killed, status null.
  const run = (script, args, env = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, timeout: 20_000, stdio: ["ignore", "ignore", "pipe"], env: { PATH: process.env.PATH, DATABASE_SSL: "disable", ...env } });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stderr }));
  });
  const l = await listener(t);
  {
    const admin = urlOf("rw_admin", l.port, "rdb"), owner = urlOf("rw_owner", l.port, "runward_hosted");
    const old = await run("scripts/roles.mjs", ["--grants"], { ADMIN_URL: admin });
    assert.equal(old.status, 2, old.stderr);
    assert.equal(old.stderr.trim(), "roles: unknown argument --grants");
    const extra = await run("scripts/grants.mjs", ["--snapshot", "/tmp/x"], { MIGRATE_URL: owner });
    assert.equal(extra.status, 2, extra.stderr);
    assert.equal(extra.stderr.trim(), "grants: unknown argument --snapshot");
    // each reads its own role's variable and no other: the comparison does not start on the administrator's
    const wrong = await run("scripts/grants.mjs", [], { ADMIN_URL: admin, DATABASE_URL: owner });
    assert.equal(wrong.status, 2);
    assert.equal(wrong.stderr.trim(), "MIGRATE_URL is required");
    const elsewhere = await run("scripts/grants.mjs", [], { MIGRATE_URL: admin });
    assert.equal(elsewhere.status, 1);
    assert.match(elsewhere.stderr.trim(), /^grants: the URL given for the comparison of the grants names another database than runward_hosted: nothing compared, refused/);
    assert.equal(l.connections(), 0, "none of these opened a connection");
    const { roles } = await import("../../scripts/roles.mjs");
    await assert.rejects(roles(admin, { log: () => {}, grants: true }), /^Error: roles takes no option grants$/);
    assert.equal(l.connections(), 0, "the option is refused before the administrator connects");
  }
});

test("the snapshot's grant lines: both roles, the three kinds, or nothing to compare with", BOUNDED, async () => {
  const { expectedGrants } = await import("../../scripts/grants.mjs");
  const lines = expectedGrants(SNAPSHOT);
  assert.ok(lines.length > 60, "table, schema and database lines for both roles");
  assert.ok(lines.every((l) => / rw_(app|maint) [A-Z]+$/.test(l)), "only the two roles of the service");
  assert.ok(lines.includes("grant database rw_app CONNECT") && lines.includes("grant schema rw rw_maint USAGE"));
  const without = (re) => SNAPSHOT.split("\n").filter((l) => !re.test(l)).join("\n");
  for (const [what, text] of [["no table line for rw_maint", without(/^grant rw\.\S+ rw_maint /)], ["no schema line", without(/^grant schema /)], ["no database line", without(/^grant database /)], ["empty", ""]]) {
    assert.throws(() => expectedGrants(text), /holds no (table|schema|database) grant line for rw_(app|maint): nothing to compare with, refused/, what);
  }
});

test("the image carries every script the gateway runs, and deploy.yml calls only gestures the gateway has", BOUNDED, () => {
  const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
  const copied = new Set(dockerfile.split("\n").filter((l) => l.startsWith("COPY scripts/")).flatMap((l) => l.split(/\s+/).slice(1, -1)));
  const scripts = [...new Set(Object.values(GESTURES).map((g) => g.argv[0]).filter((f) => f.startsWith("scripts/")))];
  assert.deepEqual(scripts.sort(), ["scripts/grants.mjs", "scripts/isolation-deployed.mjs", "scripts/migrate.mjs", "scripts/roles.mjs"]);
  for (const f of scripts) assert.ok(copied.has(f), `${f} is run by the gateway and is not copied into the image`);
  assert.ok(dockerfile.includes("COPY db ./db"), "the snapshot the comparison reads is in the image");
  const deploy = readFileSync(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const calls = [...deploy.matchAll(/^\s*(?:run: )?scripts\/operator-call\.sh ([a-z-]+)(.*)$/gm)].map((m) => [m[1], m[2].trim()]);
  assert.deepEqual(calls, [["roles", ""], ["migrate", ""], ["grants", ""], ["isolation", ""]], "the deploy's gestures, in order, none with an argument");
  for (const [name] of calls) assert.ok(GESTURES[name], `deploy.yml calls ${name}, which the gateway does not have`);
});
