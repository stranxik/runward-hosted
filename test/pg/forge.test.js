// The forge port against a real PostgreSQL (ADR-0029 section 5, step c; section 6 points 6 and 7): migration
// 0007 on a base the image of before still writes to, the planted control of two tenants that register the
// same issuer string and declare the same project_id, and what the database itself refuses, under the
// service's role (rw_app) and the maintenance role (rw_maint), behind forced row level security.
// Needs PG_ADMIN_URL (a superuser of a throwaway server). Run on the NAS, never against a real base.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { migrate } from "../../scripts/migrate.mjs";
import { postgresStore } from "../../src/adapters/store/postgres.js";
import { scopedKey, GITHUB_ISSUER_KEY } from "../../src/domain/forge.js";
import { harness, founder, gesture, send, pinnedRepository, sendToken, gitlabKey, gitlabClaims, registerIssuer, pinnedGitlab, INSTANCE, GITLAB_COM_KEY } from "../helpers.js";

const ADMIN = process.env.PG_ADMIN_URL;
if (!ADMIN) { test("PG_ADMIN_URL is set", () => assert.fail("PG_ADMIN_URL is required: this suite never skips silently")); }
const DB = `rw_forge_${randomBytes(4).toString("hex")}`;
const urlAs = (role) => { const u = new URL(ADMIN); u.username = role; u.password = ""; u.pathname = `/${DB}`; return u.toString(); };
let admin, adminDb, store, maint, h, A, B, a, b;
const as = (sql, tenant, fn) => sql.begin(async (q) => { await q`select set_config('app.tenant', ${tenant ?? ""}, true)`; return fn(q); });

/** A registered instance of tenant `f` with a pinned project: { reg, repo, sign, claims }. */
async function instance(f, { name = "temoin/demo", mission, projectId = "1" }) {
  const reg = await registerIssuer(h, f, { issuer: INSTANCE });
  const claims = (x = {}, over = {}) => gitlabClaims(h.clock, { issuer: INSTANCE, audience: reg.audience, path: name, projectId, ...x }, over);
  const repo = await pinnedGitlab(h, f, { issuer: reg.id, sign: reg.key.sign, name, mission, claims: { issuer: INSTANCE, audience: reg.audience, projectId } });
  assert.equal(repo.first.status, 202, JSON.stringify(repo.first));
  return { reg, repo, sign: reg.key.sign, claims, mission };
}

before(async () => {
  if (!ADMIN) return;
  admin = postgres(ADMIN, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${DB}`);
  for (const r of ["rw_owner login", "rw_resolve nologin", "rw_app login nobypassrls", "rw_maint login nobypassrls"]) {
    const [name] = r.split(" ");
    const [x] = await admin`select 1 from pg_roles where rolname = ${name}`;
    if (!x) await admin.unsafe(`create role ${r}`);
  }
  await admin.unsafe("grant rw_resolve to rw_owner");
  await admin.unsafe(`grant create, connect on database ${DB} to rw_owner; grant connect on database ${DB} to rw_app, rw_maint`);
  process.env.DATABASE_SSL = "disable";
  await migrate(urlAs("rw_owner"), { log: () => {} });
  store = postgresStore({ url: urlAs("rw_app"), ssl: false });
  maint = postgresStore({ url: urlAs("rw_maint"), ssl: false });
  const u = new URL(ADMIN); u.pathname = `/${DB}`;
  adminDb = postgres(u.toString(), { max: 1, onnotice: () => {} });
  h = harness({ store, realTime: true });
  A = await founder(h, { prefix: "fa" });
  B = await founder(h, { prefix: "fb" });
});
after(async () => {
  if (!ADMIN) return;
  await store?.close(); await maint?.close();
  await adminDb?.end();
  await admin.unsafe(`drop database if exists ${DB} with (force)`);
  await admin.end();
});

test("0007 is an expansion: a row written as the image of before writes it is GitHub's, resolved by the functions of before and of now; the functions of before still answer", async () => {
  const sql = postgres(urlAs("rw_app"), { max: 1, onnotice: () => {} });
  try {
    const id = randomUUID();
    await as(sql, A.tenant, (q) => q`insert into rw.forge_repository (id, forge, name_key, name, state) values (${id}, 'github', 'old/image', 'old/image', 'pending')`);
    const [row] = await as(sql, A.tenant, (q) => q`select forge_name, issuer_key from rw.forge_repository where id = ${id}`);
    assert.deepEqual([row.forge_name, row.issuer_key], ["github", GITHUB_ISSUER_KEY], "the defaults give it its forge name and issuer key");
    const [before] = await sql`select * from rw.resolve_repository('github', '424242', 'old/image')`;
    const now = await store.tx(null, (tx) => tx.resolveRepository({ forge: "github", repositoryId: "424242", nameKey: "old/image" }));
    assert.equal(before.id, id); assert.equal(now.id, id);
    await as(sql, A.tenant, (q) => q`update rw.forge_repository set repository_id = '424242', owner_id = '7', state = 'pinned' where id = ${id}`);
    assert.equal((await store.tx(null, (tx) => tx.resolveRepository({ forge: "github", repositoryId: "424242", nameKey: "renamed/since" }))).state, "pinned");
    // a GitHub row cannot carry another issuer key, and a key of another forge must carry its scope
    await assert.rejects(as(sql, A.tenant, (q) => q`insert into rw.forge_repository (id, forge_name, issuer_key, name_key, name, state) values (${randomUUID()}, 'github', 'https://gitlab.com', 'x/y', 'x/y', 'pending')`), /forge_repository_keys_scoped/);
    await assert.rejects(as(sql, A.tenant, (q) => q`insert into rw.forge_repository (id, forge_name, issuer_key, name_key, name, state) values (${randomUUID()}, 'gitlab', 'https://gitlab.com', 'x/y', 'x/y', 'pending')`), /forge_repository_keys_scoped/);
    await assert.rejects(as(sql, A.tenant, (q) => q`insert into rw.forge_repository (id, forge_name, issuer_key, name_key, name, state) values (${randomUUID()}, 'bitbucket', 'https://gitlab.com', 'bitbucket:https://gitlab.com:x/y', 'x/y', 'pending')`), /forge_name_check/);
    // the replay ids: a GitHub token used on the image of before is refused by this one, and the reverse
    const exp = new Date(Date.now() + 300_000).toISOString();
    assert.equal((await sql`select rw.use_jti('jti-old-image', ${exp}::timestamptz) as ok`)[0].ok, true);
    assert.equal(await store.tx(null, (tx) => tx.useJti("jti-old-image", Date.now() + 300_000)), false, "used on the image of before, refused by this one");
    assert.equal(await store.tx(null, (tx) => tx.useJti("jti-new-image", Date.now() + 300_000)), true);
    assert.equal((await sql`select rw.use_jti('jti-new-image', ${exp}::timestamptz) as ok`)[0].ok, false, "used on this image, refused by the one of before");
    assert.equal(await store.tx(null, (tx) => tx.useJti("jti-new-image", Date.now() + 300_000)), false);
    // within its issuer key only: the same id under another issuer key is another token's
    assert.equal(await store.tx(null, (tx) => tx.useJti("jti-new-image", Date.now() + 300_000, "https://gitlab.com")), true);
    assert.equal(await store.tx(null, (tx) => tx.useJti("jti-new-image", Date.now() + 300_000, "https://gitlab.com")), false);
    assert.equal((await adminDb`select count(*)::int as n from rw.oidc_jti where jti = 'jti-new-image'`)[0].n, 1, "only GitHub's replay ids are written where the image of before looks");
    assert.equal((await sql`select rw.take_rate('424242', 1, 'run', 30) as ok`)[0].ok, true, "the counters of before still answer the image of before");
  } finally { await sql.end(); }
});

test("point 6, planted control on PostgreSQL: two tenants register the same issuer string and declare the same project_id: both pin, no upload crosses, no counter and no replay id is shared", async () => {
  a = await instance(A, { mission: "demo-a" });
  b = await instance(B, { mission: "demo-b" });
  assert.notEqual(a.reg.id, b.reg.id);
  assert.ok(a.repo.confirm.published && b.repo.confirm.published, "both pin project_id 1 of the same issuer string");
  const rows = await adminDb`select tenant_id, issuer_key, repository_id, state from rw.forge_repository where forge_name = 'gitlab' order by tenant_id`;
  assert.equal(rows.length, 2);
  for (const r of rows) assert.deepEqual([r.state, r.repository_id], ["pinned", scopedKey("gitlab", r.issuer_key, "1")]);
  // no upload crosses: each key with the other's audience is unreadable, and writes nothing
  const count = async (t) => (await store.tx(t, (tx) => tx.ledgerAll())).length;
  const lens = [await count(A.tenant), await count(B.tenant)];
  assert.equal((await sendToken(h, a.sign(a.claims({ pipeline: "50", job: "500" }, { aud: b.reg.audience })), { mission: "demo-b" })).refusal, "token-unreadable");
  assert.equal((await sendToken(h, b.sign(b.claims({ pipeline: "50", job: "500" }, { aud: a.reg.audience })), { mission: "demo-a" })).refusal, "token-unreadable");
  assert.deepEqual([await count(A.tenant), await count(B.tenant)], lens);
  // each upload lands in its own tenant, under its own issuer key
  const jti = `shared-${randomBytes(4).toString("hex")}`;
  assert.equal((await sendToken(h, a.sign(a.claims({ pipeline: "51", job: "510" }, { jti })), { mission: "demo-a" })).status, 201);
  assert.equal((await sendToken(h, b.sign(b.claims({ pipeline: "51", job: "510" }, { jti })), { mission: "demo-b" })).status, 201, "the same replay id is B's own");
  assert.equal((await sendToken(h, a.sign(a.claims({ pipeline: "52", job: "520" }, { jti })), { mission: "demo-a" })).refusal, "token-replayed");
  const uses = await adminDb`select issuer_key from rw.token_use where jti = ${jti} order by 1`;
  assert.deepEqual(uses.map((r) => r.issuer_key).sort(), [a.reg.id, b.reg.id].sort(), "one row per issuer key");
  for (let i = 0; i < 28; i++) assert.equal((await sendToken(h, a.sign(a.claims({ pipeline: String(60 + i), job: String(600 + i) })), { mission: "demo-a" })).status, 201, `A's run ${i}`);
  assert.equal((await sendToken(h, a.sign(a.claims({ pipeline: "99", job: "990" })), { mission: "demo-a" })).refusal, "rate-limited", "A spent its 30 runs of the hour");
  assert.equal((await sendToken(h, b.sign(b.claims({ pipeline: "53", job: "530" })), { mission: "demo-b" })).status, 201, "B's counter is its own");
  const rate = await adminDb`select issuer_key, count(*)::int as n from rw.send_rate where repository_id = '1' group by 1`;
  assert.deepEqual(Object.fromEntries(rate.map((r) => [r.issuer_key, r.n])), { [a.reg.id]: 30, [b.reg.id]: 3 });
  const ups = await adminDb`select tenant_id, count(*)::int as n from rw.upload group by 1`;
  assert.deepEqual(Object.fromEntries(ups.map((r) => [r.tenant_id, r.n])), { [A.tenant]: 30, [B.tenant]: 3 }, "no upload crossed");
  // the journal of each names its own issuer key, never the other's
  const text = async (t) => JSON.stringify((await store.tx(t, (tx) => tx.ledgerAll())).map((e) => e.body));
  assert.ok(!(await text(A.tenant)).includes(b.reg.id) && !(await text(B.tenant)).includes(a.reg.id));
  // the same path on gitlab.com, and on GitHub, are other repositories: declared and pinned beside
  const com = await pinnedGitlab(h, A, { issuer: "gitlab.com", sign: GITLAB_COM_KEY.sign, claims: { issuer: "https://gitlab.com" }, mission: "demo-com" });
  assert.ok(com.confirm.published);
  const gh = await pinnedRepository(h, A, { name: "temoin/demo", mission: "demo-gh", claims: { repository_id: "1" } });
  assert.ok(gh.confirm.published);
  assert.equal((await send(h, { repository: "temoin/demo", repository_id: "1", run_number: "2", run_id: "39000000002" }, { mission: "demo-gh" })).status, 201);
});

test("points 6 and 7: what the database refuses, whatever the application does: another tenant's registration, a key changed, a retirement undone, a read outside the tenant", async () => {
  const sql = postgres(urlAs("rw_app"), { max: 1, onnotice: () => {} });
  try {
    // B cannot declare on A's registration, even with its exact identifier (the trigger of 0007, under B's policies)
    await assert.rejects(as(sql, B.tenant, (q) => q`insert into rw.forge_repository (id, forge_name, issuer_key, name_key, name, state) values (${randomUUID()}, 'gitlab', ${a.reg.id}, ${scopedKey("gitlab", a.reg.id, "temoin/x")}, 'temoin/x', 'pending')`), /live registration of its own tenant/);
    await gesture(h, B.session, null, null);
    await assert.rejects(h.app.repositories.declare(await h.app.identity.sessionFrom(B.token), { forge: "gitlab", issuer: a.reg.id, name: "temoin/x", missions: [{ id: "x" }] }, {}), { code: "issuer-unknown" });
    // nor add a key to it, nor read it
    await assert.rejects(as(sql, B.tenant, (q) => q`insert into rw.issuer_key (id, issuer_ref, kid, jwk, thumbprint) values (${randomUUID()}, ${a.reg.id}, 'k', '{}'::jsonb, 'k')`), /foreign key|violates/);
    for (const t of ["issuer", "issuer_key"]) {
      assert.equal((await as(sql, B.tenant, (q) => q.unsafe(`select count(*)::int as n from rw.${t} where tenant_id = $1`, [A.tenant])))[0].n, 0, `${t}: A's rows from B`);
      assert.equal((await sql.unsafe(`select count(*)::int as n from rw.${t}`))[0].n, 0, `${t}: with no tenant set`);
    }
    await assert.rejects(as(sql, B.tenant, (q) => q`insert into rw.issuer (tenant_id, id, forge, issuer) values (${A.tenant}, ${randomBytes(16).toString("hex")}, 'gitlab', 'https://x.test')`), /row-level security/);
    // the lookup before the tenant is known answers by the exact identifier, and nothing else
    assert.equal(await store.tx(null, (tx) => tx.resolveIssuer("0".repeat(32))), null);
    assert.equal(await store.tx(null, (tx) => tx.resolveIssuer(a.reg.id.slice(0, 31))), null);
    const got = await store.tx(null, (tx) => tx.resolveIssuer(a.reg.id));
    assert.deepEqual([got.tenantId, got.issuer, got.removed, got.keys.length, got.keys[0].kid], [A.tenant, INSTANCE, false, 1, a.reg.key.kid]);
    assert.deepEqual(Object.keys(got.keys[0].jwk).sort(), ["e", "kid", "kty", "n"], "a jsonb object, with the public members only");
    // a key is written once, by the service's role and by the maintenance role alike
    const keyId = got.keys[0].id;
    for (const [role, s] of [["rw_app", store], ["rw_maint", maint]]) {
      await assert.rejects(s.tx(A.tenant, (tx) => tx.update("issuer_key", { id: keyId }, { jwk: gitlabKey().jwk })), /written once/, `${role}: a key's material`);
      await assert.rejects(s.tx(A.tenant, (tx) => tx.update("issuer", { id: a.reg.id }, { issuer: "https://elsewhere.test" })), /written once/, `${role}: a registration's issuer`);
    }
    await assert.rejects(as(sql, A.tenant, (q) => q`delete from rw.issuer_key where id = ${keyId}`), /permission denied/, "the service deletes nothing");
    // the maintenance role may record a retirement and a removal again (the replay after a restore), never undo one
    const spare = await registerIssuer(h, A, { issuer: "https://gitlab.spare.test" });
    const spareKey = (await store.tx(null, (tx) => tx.resolveIssuer(spare.id))).keys[0].id;
    await maint.tx(A.tenant, (tx) => tx.update("issuer_key", { id: spareKey }, { retiredAt: Date.now() }));
    await assert.rejects(maint.tx(A.tenant, (tx) => tx.update("issuer_key", { id: spareKey }, { retiredAt: null })), /a retirement is final/);
    await assert.rejects(store.tx(A.tenant, (tx) => tx.update("issuer_key", { id: spareKey }, { retiredAt: Date.now() + 1000 })), /a retirement is final/);
    await maint.tx(A.tenant, (tx) => tx.update("issuer", { id: spare.id }, { removedAt: Date.now() }));
    await assert.rejects(maint.tx(A.tenant, (tx) => tx.update("issuer", { id: spare.id }, { removedAt: null })), /a removal is final/);
    await maint.tx(A.tenant, (tx) => tx.update("repository", { id: a.repo.id }, { protectionLiftedAt: null }));
    assert.equal((await sendToken(h, spare.key.sign(gitlabClaims(h.clock, { issuer: "https://gitlab.spare.test", audience: spare.audience })))).refusal, "token-unreadable", "a removed registration is an unknown one");
    // the tables without a tenant are reached through their functions only
    for (const t of ["token_use", "send_rate", "send_refused"]) await assert.rejects(sql.unsafe(`select * from rw.${t}`), /permission denied/, t);
  } finally { await sql.end(); }
});

test("point 8 on PostgreSQL: a retired key is told key-retired after its signature holds, in its tenant's journal; a bad signature under its kid writes nothing", async () => {
  const s = () => h.app.identity.sessionFrom(B.token);
  const keyId = (await h.app.identity.accessView(await s())).issuers[0].keys[0].id;
  await gesture(h, B.session, "issuer-key-retire", keyId);
  assert.equal((await h.app.issuers.keyRetire(await s(), b.reg.id, keyId, {})).receiving, false);
  const len = async () => (await store.tx(B.tenant, (tx) => tx.ledgerAll())).length;
  const before = await len();
  assert.equal((await sendToken(h, gitlabKey().sign(b.claims({ pipeline: "70", job: "700" }), { kid: b.reg.key.kid }), { mission: "demo-b" })).refusal, "token-unreadable");
  assert.equal(await len(), before);
  assert.equal((await sendToken(h, b.sign(b.claims({ pipeline: "71", job: "710" })), { mission: "demo-b" })).refusal, "key-retired");
  assert.equal(await len(), before + 1);
  const last = (await store.tx(B.tenant, (tx) => tx.ledgerAll())).pop().body;
  assert.deepEqual([last.detail.refusal, last.detail.key.kid, last.who.id], ["key-retired", b.reg.key.kid, `gitlab:${b.reg.id}:1`]);
  assert.equal((await store.tx(A.tenant, (tx) => tx.ledgerAll())).some((e) => JSON.stringify(e.body).includes("key-retired")), false, "and nothing in A's");
});
