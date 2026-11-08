// The operator's gestures and the daily jobs (PADR-0012 notes 5 ter, 5 quater and complement; PADR-0017;
// PADR-0018 point 7). They have no HTTP route: they run as `node src/operator.js <gesture>` inside the
// hoster's private network, started by an approved workflow of the private operator repository or by
// the hoster's schedule. Only digests of link tokens ever reach them; the database writes link dates.
import { Refusal } from "../domain/refusals.js";
import { verifyChain } from "../domain/ledger.js";
import { bytesExpired, archiveExpired, PENDING_LIFE } from "../domain/repository.js";
import { iso } from "./context.js";

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const operator = { type: "operator", id: "operateur" };

/** Waits between the attempts of a daily job on one tenant: three attempts in all. */
export const JOB_RETRY_WAITS = [1000, 4000];

export function operatorCases(ctx) {
  const { store, clock, append, security, objects, config, ports } = ctx;
  const now = () => clock.now();
  const waits = config?.jobRetryWaits ?? JOB_RETRY_WAITS;
  const sleep = ports?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const why = (e) => String(e?.message ?? e).slice(0, 200);

  /**
   * A daily job over every tenant (review finding of 2026-11-08: the note was written on success only, a
   * failure went to stderr, and one tenant's error stopped the next ones). Each tenant is a separate
   * transaction with a bounded number of attempts; a tenant that still fails is recorded with its error
   * and the job goes on to the next. The operator journal receives the note in every case, failures
   * included; if even the tenant list cannot be read, that failure is noted before the job stops.
   */
  async function eachTenant(job, fn) {
    let tenants;
    try { tenants = await store.tx(null, (tx) => tx.tenantIds()); }
    catch (e) { await store.tx(null, (tx) => tx.operatorNote(job, { report: [], failed: 1, error: why(e), stage: "tenant list" })); throw e; }
    const report = [];
    for (const tenant of tenants) {
      for (let attempt = 1; ; attempt++) {
        try { report.push({ tenant, ...(await fn(tenant)), attempts: attempt }); break; }
        catch (e) {
          if (attempt > waits.length) { report.push({ tenant, failed: true, error: why(e), attempts: attempt }); break; }
          await sleep(waits[attempt - 1]);
        }
      }
    }
    await store.tx(null, (tx) => tx.operatorNote(job, { report, failed: report.filter((r) => r.failed).length }));
    return report;
  }
  const need = (re, v, what) => { if (!re.test(String(v ?? ""))) throw new Error(`${what} is malformed`); return v; };

  /** Open the founder's link of a new (or still memberless) tenant. */
  async function openBootstrap({ hash, tenant = null, witness = false, title = null }) {
    need(HEX64, hash, "--hash");
    const tenantId = tenant ? need(UUID, tenant, "--tenant") : store.newId();
    return store.tx(tenantId, async (tx) => {
      let t = await tx.get("tenant", { id: tenantId });
      if (!t) t = await tx.insert("tenant", { id: tenantId, witness, ...(title ? { title } : {}), createdAt: now() });
      if ((await tx.list("member")).some((m) => !m.removedAt)) throw new Error("bootstrap is closed for good: this tenant has a member (use recovery or reset-access)");
      for (const l of await tx.list("link", { kind: "bootstrap" })) if (!l.usedAt && !l.cancelledAt) await tx.update("link", { id: l.id }, { cancelledAt: now() });
      const link = await tx.insert("link", { id: store.newId(), tokenHash: hash, kind: "bootstrap" });
      const e = await append(tx, { who: operator, what: "bootstrap-opened", object: link.id });
      await tx.operatorNote("bootstrap-opened", { tenant: tenantId, link: link.id, seq: e.seq });
      return { tenant: tenantId, link: link.id, expiresAt: iso(link.expiresAt) };
    });
  }

  /** Open a recovery: usable 24 h after it opens (dates written by the database), for 24 h. */
  async function openRecovery({ hash, tenant, member }) {
    need(HEX64, hash, "--hash"); need(UUID, tenant, "--tenant"); need(UUID, member, "--member");
    return store.tx(tenant, async (tx) => {
      const m = await tx.get("member", { id: member });
      if (!m || m.removedAt) throw new Error("no such member in this tenant");
      const link = await tx.insert("link", { id: store.newId(), tokenHash: hash, kind: "recovery", memberId: member });
      await security(tx, { what: "recovery-opened", link: link.id, member });
      const e = await append(tx, { who: operator, what: "recovery-opened", object: link.id, detail: { member, usableFrom: iso(link.usableFrom), expiresAt: iso(link.expiresAt) } });
      await tx.operatorNote("recovery-opened", { tenant, link: link.id, seq: e.seq });
      return { link: link.id, usableFrom: iso(link.usableFrom), expiresAt: iso(link.expiresAt) };
    });
  }

  /** The intruder who won the bootstrap: every access of the tenant is withdrawn, its data kept, a bootstrap reopened. */
  async function resetAccess({ hash, tenant }) {
    need(HEX64, hash, "--hash"); need(UUID, tenant, "--tenant");
    return store.tx(tenant, async (tx) => {
      for (const s of await tx.list("session")) if (!s.closedAt) await tx.update("session", { id: s.id }, { closedAt: now() });
      for (const p of await tx.list("passkey")) if (!p.removedAt) await tx.update("passkey", { id: p.id }, { removedAt: now(), lost: true });
      for (const m of await tx.list("member")) if (!m.removedAt) await tx.update("member", { id: m.id }, { removedAt: now(), founder: false });
      for (const l of await tx.list("link")) if (!l.usedAt && !l.cancelledAt) await tx.update("link", { id: l.id }, { cancelledAt: now() });
      const link = await tx.insert("link", { id: store.newId(), tokenHash: hash, kind: "bootstrap" });
      await security(tx, { what: "access-reset", link: link.id });
      const e = await append(tx, { who: operator, what: "access-reset", object: link.id });
      await tx.operatorNote("access-reset", { tenant, link: link.id, seq: e.seq });
      return { link: link.id, expiresAt: iso(link.expiresAt) };
    });
  }

  async function maintenance({ on, until = null, reason = "" }) {
    await store.tx(null, async (tx) => {
      await tx.setMaintenance(on ? { since: iso(now()), until, reason: String(reason).slice(0, 200) } : null);
      await tx.operatorNote(on ? "maintenance-on" : "maintenance-off", { until, reason });
    });
    return { maintenance: on };
  }

  /** The daily job: expired declarations, bytes of repositories removed 30 days ago, archives older than 24 h. */
  async function retention() {
    return eachTenant("retention", (tenant) => store.tx(tenant, async (tx) => {
        let erased = 0, archives = 0, expired = 0;
        for (const repo of await tx.list("repository")) {
          const f = await tx.get("forge_repository", { id: repo.id });
          if (f?.state === "pending" && !repo.removedAt && !repo.pendingSend && now() - repo.declaredAt >= PENDING_LIFE) {
            await tx.update("repository", { id: repo.id }, { removedAt: now() });
            await tx.update("forge_repository", { id: repo.id }, { removedAt: now() });
            await append(tx, { who: operator, what: "repository-expired", object: repo.id });
            expired++;
          }
          if (bytesExpired(repo, now())) {
            const ups = (await tx.list("upload", { repositoryRef: repo.id })).filter((u) => !u.erasedAt);
            if (!ups.length) continue;
            for (const u of ups) await tx.update("upload", { id: u.id }, { erasedAt: now() });
            const digests = [...new Set(ups.map((u) => u.sha256))];
            for (const d of digests) {
              const b = await tx.get("blob", { sha256: d });
              const refs = Math.max(0, (b?.refs ?? 0) - ups.filter((u) => u.sha256 === d).length);
              await tx.update("blob", { sha256: d }, { refs, ...(refs === 0 ? { erasedAt: now() } : {}) });
              if (refs === 0) await objects.removeBytes(tenant, d);
            }
            await append(tx, { who: operator, what: "content-erased", object: repo.id, detail: { digests, reason: "retention" } });
            erased += digests.length;
          }
        }
        for (const a of await tx.list("archive", { erasedAt: null })) if (archiveExpired(a, now())) { await objects.removeArchive(tenant, a.id); await tx.update("archive", { id: a.id }, { erasedAt: now() }); archives++; }
        return { erased, archives, expired };
    }));
  }

  /** The daily check of every tenant's chain (PADR-0018 point 2). */
  async function verifyChains() {
    return eachTenant("verify-chains", async (tenant) => {
      const v = await store.tx(tenant, async (tx) => verifyChain(await tx.ledgerAll()));
      return { ok: v.ok, head: v.head ?? null, ...(v.ok ? {} : { at: v.at, why: v.why }) };
    });
  }

  /**
   * After a database restore (PADR-0014 note, T24): close every session of every tenant, replay from the
   * object store the access gestures after `since` (ULID order), and say so in each tenant's journal.
   * A member left with no passkey gets a recovery opened at once.
   */
  async function restoreReplay({ since, headBefore = null, recoveryHash = null }) {
    const report = [];
    for (const tenant of await store.tx(null, (tx) => tx.tenantIds())) {
      const events = await objects.securitySince(tenant, since);
      const r = await store.tx(tenant, async (tx) => {
        let closed = 0, replayed = 0;
        for (const s of await tx.list("session")) if (!s.closedAt) { await tx.update("session", { id: s.id }, { closedAt: now() }); closed++; }
        for (const { event } of events) {
          if (event.what === "passkey-removed" || event.what === "passkey-restored") {
            const p = await tx.get("passkey", { id: event.passkey });
            if (p) { await tx.update("passkey", { id: p.id }, { removedAt: event.what === "passkey-removed" ? Date.parse(event.at) : null }); replayed++; }
          } else if (event.what === "consent-withdrawn" || event.what === "consent-given") {
            if (await tx.get("repository", { id: event.repository })) { await tx.update("repository", { id: event.repository }, { consent: event.what === "consent-given" }); replayed++; }
          } else if (event.what === "repository-removed" || event.what === "repository-restored") {
            const at = event.what === "repository-removed" ? Date.parse(event.at) : null;
            if (await tx.get("repository", { id: event.repository })) { await tx.update("repository", { id: event.repository }, { removedAt: at }); await tx.update("forge_repository", { id: event.repository }, { removedAt: at }); replayed++; }
          } else if (event.what === "recovery-cancelled" && event.link) {
            if (await tx.get("link", { id: event.link })) { await tx.update("link", { id: event.link }, { cancelledAt: Date.parse(event.at) }); replayed++; }
          }
        }
        const stranded = [];
        for (const m of (await tx.list("member")).filter((x) => !x.removedAt)) {
          if (!(await tx.list("passkey", { memberId: m.id })).some((p) => !p.removedAt)) stranded.push(m.id);
        }
        if (stranded.length && recoveryHash) await tx.insert("link", { id: store.newId(), tokenHash: recoveryHash, kind: "recovery", memberId: stranded[0] });
        const head = await tx.ledgerHead();
        const e = await append(tx, { who: operator, what: "restore-replayed", object: null, detail: { since, headBefore: headBefore ?? "", headAfterRestore: head?.hash ?? "", closed, replayed, stranded } });
        return { tenant, closed, replayed, stranded, seq: e.seq };
      });
      report.push(r);
    }
    await store.tx(null, (tx) => tx.operatorNote("restore-replayed", { since, report }));
    return report;
  }

  return { openBootstrap, openRecovery, resetAccess, maintenance, retention, verifyChains, restoreReplay };
}

/** The witness reader (PADR-0020): a workload identity of the product's temoin.yml, audience /read. */
export function readerCases(ctx, ingest, reading) {
  const { store, append } = ctx;
  async function authorize({ authorization, fleet, requestId }) {
    const c = await ingest.verifyToken(authorization, `${ctx.config.origin}/read`);
    const ok = c.repository === "stranxik/runward-hosted"
      && (!ctx.config.readerRepositoryId || c.repositoryId === ctx.config.readerRepositoryId)
      && c.jobWorkflowRef === "stranxik/runward-hosted/.github/workflows/temoin.yml@refs/heads/main"
      && c.ref === "refs/heads/main" && c.runnerEnvironment === "github-hosted";
    if (!ok || !UUID.test(String(fleet ?? ""))) throw new Refusal("reader-not-authorized");
    const allowed = await store.tx(fleet, async (tx) => {
      const r = await tx.get("reader", {});
      return Boolean(r && r.authorizedAt && !r.withdrawnAt);
    });
    if (!allowed) throw new Refusal("reader-not-authorized");
    return { tenantId: fleet, runId: c.runId, requestId };
  }
  async function readIndex(args) {
    const a = await authorize(args);
    const idx = await reading.index(a.tenantId);
    await store.tx(a.tenantId, (tx) => append(tx, { who: { type: "reader", id: "temoin.yml" }, what: "reader-read", object: idx?.sha256 ?? null, requestId: args.requestId, detail: { read: "index", runId: a.runId } }));
    const status = await reading.status({ tenantId: a.tenantId });
    return { index: idx, status };
  }
  async function readExport(args) {
    const a = await authorize(args);
    return reading.prepareExport({ tenantId: a.tenantId, memberId: null }, { requestId: args.requestId, reader: true });
  }
  return { readIndex, readExport };
}
