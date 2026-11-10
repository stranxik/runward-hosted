// The operator's gestures and the daily jobs (PADR-0012 notes 5 ter, 5 quater and complement; PADR-0017;
// PADR-0018 point 7). They have no HTTP route: they run as `node src/operator.js <gesture>` inside the
// hoster's private network, started by an approved workflow of the private operator repository or by
// the hoster's schedule. Only digests of link tokens ever reach them; the database writes link dates.
import { Refusal } from "../domain/refusals/index.js";
import { verifyChain, GENESIS } from "../domain/ledger.js";
import { bytesExpired, archiveExpired, PENDING_LIFE } from "../domain/repository.js";
import { iso } from "./context.js";

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const operator = { type: "operator", id: "operateur" };

// ---------------------------------------------------------------- the replay of the security log (T24)
// What `restoreReplay` does with each kind of event the security log holds. The rule of every line: after
// the replay, what exists in the restored database is where the log, read to its end, says it was. So a
// gesture replayed twice changes nothing (the backup's instant is known with a margin: a gesture between
// `since` and the dump's snapshot is in both the backup and the replay), and a gesture on something the
// restore lost (a passkey added after the backup, then removed) applies to nothing. Each returns whether
// it found something to act on.
const when = (e) => Date.parse(e.at);
/** The code of a replay refused because a tenant's security log cannot be read whole (the object store adapter throws it too). */
export const SECURITY_LOG_UNREADABLE = "security-log-unreadable";

/** What the events create: a reset or a recovery withdraws what existed before it, never what the log creates after it. */
function created(events) {
  const members = new Set(), passkeys = new Set(), links = new Set();
  for (const { event: e } of events) {
    if (e.what === "member-founded") members.add(e.member);
    if (e.what === "member-founded" || e.what === "member-recovered" || e.what === "passkey-added") passkeys.add(e.passkey);
    if (e.what === "recovery-opened" || e.what === "access-reset") links.add(e.link);
  }
  return { members, passkeys, links };
}

/** A link the log says was redeemed is single use: the restore must not make it usable again. */
async function consumeLink(tx, e) {
  const l = e.link ? await tx.get("link", { id: e.link }) : null;
  if (!l || l.usedAt) return false;
  await tx.update("link", { id: l.id }, { usedAt: when(e) });
  return true;
}

const REPLAY = new Map([
  ["passkey-removed", async (tx, e) => {
    const p = await tx.get("passkey", { id: e.passkey });
    if (p) await tx.update("passkey", { id: p.id }, { removedAt: when(e) });
    return Boolean(p);
  }],
  ["passkey-restored", async (tx, e) => {
    const p = await tx.get("passkey", { id: e.passkey });
    if (p) await tx.update("passkey", { id: p.id }, { removedAt: null });
    return Boolean(p);
  }],
  ["consent-given", async (tx, e) => {
    const r = await tx.get("repository", { id: e.repository });
    if (r) await tx.update("repository", { id: r.id }, { consent: true });
    return Boolean(r);
  }],
  ["consent-withdrawn", async (tx, e) => {
    const r = await tx.get("repository", { id: e.repository });
    if (r) await tx.update("repository", { id: r.id }, { consent: false });
    return Boolean(r);
  }],
  ["repository-removed", async (tx, e) => {
    const r = await tx.get("repository", { id: e.repository });
    if (r) { await tx.update("repository", { id: r.id }, { removedAt: when(e) }); await tx.update("forge_repository", { id: r.id }, { removedAt: when(e) }); }
    return Boolean(r);
  }],
  ["repository-restored", async (tx, e) => {
    const r = await tx.get("repository", { id: e.repository });
    if (r) { await tx.update("repository", { id: r.id }, { removedAt: null }); await tx.update("forge_repository", { id: r.id }, { removedAt: null }); }
    return Boolean(r);
  }],
  ["recovery-cancelled", async (tx, e) => {
    const l = e.link ? await tx.get("link", { id: e.link }) : null;
    if (l) await tx.update("link", { id: l.id }, { cancelledAt: when(e) });
    return Boolean(l);
  }],
  // The operator reset the tenant's access (the intruder who won the bootstrap): every member, passkey and
  // open link of before the reset is withdrawn again. The bootstrap the reset opened is gone with the
  // restore when it happened after the backup (only its digest's row held it): the tenant is then left
  // without a member and the operator opens a bootstrap again (the report says `memberless`).
  ["access-reset", async (tx, e, { later }) => {
    for (const p of await tx.list("passkey")) if (!p.removedAt && !later.passkeys.has(p.id)) await tx.update("passkey", { id: p.id }, { removedAt: when(e), lost: true });
    for (const m of await tx.list("member")) if (!m.removedAt && !later.members.has(m.id)) await tx.update("member", { id: m.id }, { removedAt: when(e), founder: false });
    // a bootstrap opened later writes no event: the link's date tells it apart (a clock that disagrees cancels too much, never too little)
    for (const l of await tx.list("link")) if (!l.usedAt && !l.cancelledAt && l.id !== e.link && !later.links.has(l.id) && l.openedAt <= when(e)) await tx.update("link", { id: l.id }, { cancelledAt: when(e) });
    return true;
  }],
  // A recovery was redeemed: the member's passkeys of before it are lost for good. The passkey the
  // recovery registered is gone with the restore when it happened after the backup: the member is then
  // left without a passkey (the report says `stranded`) and a recovery is opened again.
  ["member-recovered", async (tx, e, { later }) => {
    let found = false;
    for (const p of await tx.list("passkey", { memberId: e.member })) {
      if (p.removedAt || p.id === e.passkey || later.passkeys.has(p.id)) continue;
      await tx.update("passkey", { id: p.id }, { removedAt: when(e), lost: true });
      found = true;
    }
    return (await consumeLink(tx, e)) || found;
  }],
  // A bootstrap (or an invitation) was redeemed: the member it made is gone with the restore when it
  // happened after the backup, and the link must not open the tenant a second time.
  ["member-founded", (tx, e) => consumeLink(tx, e)],
  // Content was erased: its bytes left the object store, which the restore does not bring back, and the
  // restored database still counts them. The uploads are marked erased again, so that the next assembly
  // leaves them out instead of failing on bytes that are gone. The index itself is republished by the
  // service's next gesture or upload: rw_maint cannot write rw.fleet_index.
  ["content-erased", async (tx, e, { tenant, objects }) => {
    const digests = Array.isArray(e.digests) ? e.digests : [];
    const ups = (await tx.list("upload", { repositoryRef: e.repository })).filter((u) => !u.erasedAt && digests.includes(u.sha256) && u.receivedAt <= when(e));
    for (const u of ups) await tx.update("upload", { id: u.id }, { erasedAt: when(e) });
    for (const d of new Set(ups.map((u) => u.sha256))) {
      const b = await tx.get("blob", { sha256: d });
      const n = ups.filter((u) => u.sha256 === d).length;
      const refs = Math.max(0, (b?.refs ?? n) - n);
      await tx.update("blob", { sha256: d }, { refs, ...(refs === 0 ? { erasedAt: when(e) } : {}) });
      if (refs === 0) await objects.removeBytes(tenant, d);
    }
    for (const a of await tx.list("archive", { erasedAt: null })) {
      if (!(a.contains ?? []).some((d) => digests.includes(d))) continue;
      await objects.removeArchive(tenant, a.id);
      await tx.update("archive", { id: a.id }, { erasedAt: when(e) });
    }
    return ups.length > 0;
  }],
]);

/** The kinds of the security log the replay acts on. */
export const SECURITY_REPLAYED = [...REPLAY.keys()];
/** The kinds it leaves, each with its reason: a kind of the security log is in one list or the other (test/unit/restore-replay.test.js). */
export const SECURITY_NOT_REPLAYED = {
  "passkey-added": "a passkey added after the backup is gone with the restore: nothing is given back",
  "recovery-opened": "a recovery opened after the backup is gone with the restore: nothing is given back",
  "session-closed": "the replay closes every session",
  "sessions-closed-others": "the replay closes every session",
  "journal-anchored": "not a gesture: the head of the tenant's journal, written before a loss and read for the note (headBefore)",
};

/**
 * The head of a tenant's journal as the restore left it: the entry before the first note of this replay
 * (the same `since`) when the gesture runs again, the journal's last entry otherwise. Run twice, the gesture
 * says the same range twice.
 */
function restoredHead(entries, since) {
  const first = entries.find((e) => e.body.what === "restore-replayed" && e.body.detail?.since === since) ?? null;
  const last = first ? entries.find((e) => e.seq === first.seq - 1) ?? null : entries[entries.length - 1] ?? null;
  return { head: last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS }, rerunOf: first ? first.seq : null };
}

/**
 * The head of a tenant's journal before the loss, as the system itself wrote it: the last `journal-anchored`
 * of the tenant's own security log (restore-replay --anchor, run while the database could still be read)
 * that is not behind the restored journal and is not an entry written since the restore (an anchor taken
 * after it describes the new journal, not the lost one). Null when there is none: nothing is taken on
 * anyone's word.
 */
function anchoredHead(events, restored, entries) {
  for (let i = events.length - 1; i >= 0; i--) {
    const { id, event: e } = events[i];
    if (e.what !== "journal-anchored" || !Number.isSafeInteger(e.seq) || !HEX64.test(String(e.hash))) continue;
    if (e.seq === restored.seq && e.hash === restored.hash) return { seq: e.seq, hash: e.hash, anchor: id };
    if (e.seq > restored.seq && !entries.some((x) => x.seq === e.seq && x.hash === e.hash)) return { seq: e.seq, hash: e.hash, anchor: id };
  }
  return null;
}

/**
 * The entries of before the loss that are gone, by their seq: from the one after the restored head to the
 * head before the loss. `to` and `count` are null when that head was not anchored: the range is then open,
 * said so, never guessed. The note itself, and what follows it, take the numbers of the lost entries.
 */
function lostRange(restored, before) {
  if (!before) return { from: restored.seq + 1, to: null, count: null };
  if (before.seq === restored.seq) return { from: null, to: null, count: 0 };
  return { from: restored.seq + 1, to: before.seq, count: before.seq - restored.seq };
}

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
   * object store the gestures after `since` (ULID order, the REPLAY table above), and say so in each
   * tenant's journal: which entries of before the loss are gone, by their seq (`lost`), from the restored
   * head to the head that tenant's journal had before the loss when it was anchored (`anchor`, run before
   * the database is replaced). A member left with no passkey is reported `stranded` (a recovery is opened for the
   * first one when `recoveryHash` is given); a tenant left with no member is reported `memberless`: the
   * operator opens its bootstrap again. Refused whole, before any write, when a tenant's security log
   * cannot be read (`security-log-unreadable`); a tenant whose replay fails is recorded and the others
   * are still replayed.
   */
  async function restoreReplay({ since = null, anchor = false, recoveryHash = null }) {
    if (anchor) {
      if (since !== null || recoveryHash !== null) throw new Error("--anchor takes no other argument");
      return anchorHeads();
    }
    need(ULID, since, "--since");
    if (recoveryHash !== null) need(HEX64, recoveryHash, "--recovery-hash");
    const tenants = await tenantList("restore-replayed", { since });
    // Every tenant's log is read before the first write. A log that cannot be read whole refuses the
    // gesture whole, with a code: nothing is closed, replayed or written to a tenant's journal on a log
    // read in part, and the refusal is in the operator journal.
    const logs = new Map(), unread = [];
    for (const tenant of tenants) {
      try { logs.set(tenant, await objects.securitySince(tenant, since)); }
      catch (e) { unread.push({ tenant, failed: true, error: why(e) }); }
    }
    if (unread.length) {
      await store.tx(null, (tx) => tx.operatorNote("restore-replayed", { since, refused: SECURITY_LOG_UNREADABLE, report: unread, failed: unread.length }));
      throw Object.assign(new Error(`${SECURITY_LOG_UNREADABLE}: the security log of ${unread.length} tenant(s) out of ${tenants.length} cannot be read; nothing was replayed; first reason: ${unread[0].error}`), { code: SECURITY_LOG_UNREADABLE });
    }
    // Each tenant is one transaction, retried as a daily job's (eachTenant): its sessions, its gestures and
    // its note are written together or not at all. A tenant that still fails is recorded with its error
    // and the replay goes on to the next ones: one tenant's failure never leaves the accesses of the
    // others as the restore gave them back. The operator journal receives the note in every case, and the
    // run ends non-zero (src/operator.js#jobIncomplete); run again, the gesture replays every tenant again,
    // which changes nothing where it had succeeded.
    const report = await perTenant(tenants, (tenant) => store.tx(tenant, (tx) => replayTenant(tx, tenant, logs.get(tenant), since)));
    // One recovery, for the first member left without a passkey, opened as the operator's own gesture
    // opens it (openRecovery: its own transaction, the security log, the tenant's journal, usable in 24 h),
    // after the replay and apart from it: a digest already taken fails the recovery, never a tenant's
    // replay. The other members left without a passkey are in the report: `open-recovery` for each.
    const stranded = recoveryHash ? report.find((r) => !r.failed && r.stranded.length) : null;
    if (stranded) {
      try { stranded.recovery = (await openRecovery({ hash: recoveryHash, tenant: stranded.tenant, member: stranded.stranded[0] })).link; }
      catch (e) { report.push({ tenant: stranded.tenant, stage: "recovery", failed: true, error: why(e), attempts: 1 }); }
    }
    await store.tx(null, (tx) => tx.operatorNote("restore-replayed", { since, report, failed: report.filter((r) => r.failed).length }));
    return report;
  }

  /** The tenants, or the failure to read them noted in the operator journal before the gesture stops (as eachTenant). */
  async function tenantList(what, detail) {
    try { return await store.tx(null, (tx) => tx.tenantIds()); }
    catch (e) { await store.tx(null, (tx) => tx.operatorNote(what, { ...detail, report: [], failed: 1, error: why(e), stage: "tenant list" })); throw e; }
  }

  /** `fn` on each tenant, retried as a daily job's (eachTenant): one row per tenant, its result or its failure. */
  async function perTenant(tenants, fn) {
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
    return report;
  }

  /**
   * Before a database is replaced, while it can still be read (restore-replay --anchor): the head of each
   * tenant's journal is written to that tenant's security log in the object store (`journal-anchored`:
   * seq, hash), which the restore does not touch. The replay reads it back as the head before the loss.
   * Each tenant has its own chain, so each has its own anchor; nothing leaves the private network and no
   * head is taken on the operator's word. Nothing is appended to a journal: an anchor that moved the head
   * would not be the head.
   */
  async function anchorHeads() {
    const tenants = await tenantList("restore-anchored", {});
    const report = await perTenant(tenants, (tenant) => store.tx(tenant, async (tx) => {
      await tx.lockTenant();
      const head = await tx.ledgerHead();
      return head ? { seq: head.seq, anchor: await security(tx, { what: "journal-anchored", seq: head.seq, hash: head.hash }) } : { seq: 0 };
    }));
    await store.tx(null, (tx) => tx.operatorNote("restore-anchored", { report, failed: report.filter((r) => r.failed).length }));
    return report;
  }

  /** One tenant's replay, in its transaction: the sessions closed, the gestures replayed in ULID order, the note in its journal. */
  async function replayTenant(tx, tenant, events, since) {
    await tx.lockTenant();
    let closed = 0, replayed = 0;
    for (const s of await tx.list("session")) if (!s.closedAt) { await tx.update("session", { id: s.id }, { closedAt: now() }); closed++; }
    for (let i = 0; i < events.length; i++) {
      const act = REPLAY.get(events[i].event.what);
      if (act && await act(tx, events[i].event, { tenant, objects, later: created(events.slice(i + 1)) })) replayed++;
    }
    const members = (await tx.list("member")).filter((x) => !x.removedAt);
    const stranded = [];
    for (const m of members) if (!(await tx.list("passkey", { memberId: m.id })).some((p) => !p.removedAt)) stranded.push(m.id);
    // the note: "restore of <since>: entries lost between seq <from> and <to>" (runbook §3), as fields
    const entries = await tx.ledgerAll();
    const { head, rerunOf } = restoredHead(entries, since);
    const headBefore = anchoredHead(events, head, entries);
    const lost = lostRange(head, headBefore);
    const e = await append(tx, { who: operator, what: "restore-replayed", object: null, detail: { since, headAfterRestore: head, headBefore, lost, closed, replayed, stranded, ...(rerunOf ? { rerunOf } : {}) } });
    return { closed, replayed, stranded, memberless: members.length === 0, lost, seq: e.seq };
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
