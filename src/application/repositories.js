// Declared repositories, their missions, consent and erasure (architecture §3.1, §3.4; PADR-0017).
import { Refusal } from "../domain/refusals.js";
import { readDeclaration, checkRestoreRepository, confirmation, MISSION_ID, REMOVED_KEEP } from "../domain/repository.js";
import { StoreConflict } from "../ports/errors.js";
import { iso } from "./context.js";

const human = (s) => ({ type: "human", id: s.memberId });

export function repositoryCases(ctx, identity) {
  const { store, clock, append, security, republish, objects } = ctx;
  const now = () => clock.now();
  const { useFresh, useGesture } = identity;

  async function owned(tx, id) {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Refusal("not-found");
    const r = await tx.get("repository", { id });
    if (!r) throw new Refusal("not-found");
    return r;
  }

  async function declare(s, input, { requestId }) {
    const d = readDeclaration(input);
    try {
      return await store.tx(s.tenantId, async (tx) => {
        await useFresh(tx, s);
        if (d.consent) await useGesture(tx, s, "declare-with-consent", d.nameKey);
        const taken = await tx.nameTaken({ forge: "github", nameKey: d.nameKey });
        if (taken === "here") throw new Refusal("repository-exists");
        if (taken === "elsewhere") throw new Refusal("repository-unavailable");
        const existing = await tx.list("mission");
        for (const m of d.missions) if (existing.some((x) => x.id === m.id)) throw new Refusal("mission-exists");
        const id = store.newId();
        await tx.insert("forge_repository", { id, forge: "github", nameKey: d.nameKey, name: d.name, state: "pending" });
        await tx.insert("repository", { id, name: d.name, workflow: d.workflow, consent: d.consent, consentAt: d.consent ? now() : null, declaredAt: now() });
        for (const m of d.missions) await tx.insert("mission", { id: m.id, repositoryRef: id, path: m.path, addedAt: now() });
        const e = await append(tx, { who: human(s), what: "repository-declared", object: id, requestId, detail: { name: d.name, workflow: d.workflow, missions: d.missions.map((m) => m.id) } });
        if (d.consent) { await security(tx, { what: "consent-given", repository: id }); await append(tx, { who: human(s), what: "consent-given", object: id, requestId }); }
        return { id, state: "pending", entry: e, expiresAt: iso(now() + 7 * 86_400_000) };
      });
    } catch (e) {
      if (e instanceof StoreConflict) throw new Refusal(e.constraint.startsWith("mission") ? "mission-exists" : "repository-unavailable");
      throw e;
    }
  }

  async function patch(s, id, input, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useFresh(tx, s);
      const r = await owned(tx, id);
      if (r.removedAt) throw new Refusal("not-found");
      const changes = {};
      if (input.workflow !== undefined && input.workflow !== r.workflow) {
        const d = readDeclaration({ name: r.name, workflow: input.workflow, missions: [{ id: "x" }] });
        await tx.update("repository", { id }, { workflow: d.workflow, epoch: r.epoch + 1 });
        changes.workflow = d.workflow; changes.epoch = r.epoch + 1;
      }
      const missions = await tx.list("mission");
      for (const m of input.addMissions ?? []) {
        if (!MISSION_ID.test(String(m?.id ?? ""))) throw new Refusal("mission-malformed");
        const path = String(m.path ?? ".");
        if (path.startsWith("/") || path.split("/").includes("..")) throw new Refusal("mission-malformed");
        if (missions.some((x) => x.id === m.id)) throw new Refusal("mission-exists");
        await tx.insert("mission", { id: m.id, repositoryRef: id, path, addedAt: now() });
        (changes.added ??= []).push(m.id);
      }
      for (const mid of input.removeMissions ?? []) {
        const m = missions.find((x) => x.id === mid && x.repositoryRef === id && !x.removedAt);
        if (!m) throw new Refusal("not-found");
        const sends = (await tx.list("upload", { mission: mid })).length;
        if (sends && input.knowingSendsStay !== true) throw new Refusal("mission-has-sends", { sends });
        await tx.update("mission", { id: mid }, { removedAt: now() });
        (changes.removed ??= []).push(mid);
      }
      const out = await republish(tx, "repository-changed", human(s), id, changes);
      return { entry: out.entry, changes };
    });
  }

  /** Pin repository_id and repository_owner_id from the kept upload's claims, or confirm a new owner. */
  async function confirm(s, id, { requestId }) {
    try {
      return await store.tx(s.tenantId, async (tx) => {
        await useGesture(tx, s, "repository-confirm", id);
        const r = await owned(tx, id);
        if (r.removedAt) throw new Refusal("not-found");
        const pin = confirmation(r);
        await tx.update("forge_repository", { id }, { repositoryId: pin.repositoryId, ownerId: pin.ownerId, state: "pinned" });
        await tx.update("repository", { id }, { confirmedAt: r.confirmedAt ?? now(), pendingSend: null });
        let published = null, quarantine = null;
        if (r.pendingSend.uploadId) {
          const u = await tx.get("upload", { id: r.pendingSend.uploadId });
          const built = await ctx.assemble(tx, { mission: u.mission, repositoryRef: id, kind: u.kind, sha256: u.sha256, commit: u.commit });
          if (built.ok) {
            const head = await tx.ledgerHead();
            published = await ctx.publish(tx, built, head.seq + 1);
            for (const old of await tx.list("upload", { mission: u.mission, kind: u.kind, rank: "current" })) await tx.update("upload", { id: old.id }, { rank: "superseded" });
            await tx.update("upload", { id: u.id }, { rank: "current", seq: head.seq + 1 });
          } else {
            await tx.update("upload", { id: u.id }, { rank: "quarantine" });
            quarantine = built.refusal;
          }
        }
        const e = await append(tx, { who: human(s), what: "repository-confirmed", object: id, requestId, detail: { repositoryId: pin.repositoryId, ownerId: pin.ownerId, ...(published ? { indexSha256: published.sha256, indexVersion: published.version } : {}), ...(quarantine ? { refusal: quarantine } : {}) } });
        return { entry: e, published, quarantine, ...(quarantine ? { refusal: quarantine } : {}) };
      });
    } catch (e) {
      if (e instanceof StoreConflict) throw new Refusal("repository-unavailable");
      throw e;
    }
  }

  async function remove(s, id, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useFresh(tx, s);
      const r = await owned(tx, id);
      if (r.removedAt) throw new Refusal("not-found");
      await tx.update("repository", { id }, { removedAt: now() });
      await tx.update("forge_repository", { id }, { removedAt: now() });
      await security(tx, { what: "repository-removed", repository: id });
      const out = await republish(tx, "repository-removed", human(s), id, {});
      return { entry: out.entry, restorableUntil: iso(now() + REMOVED_KEEP) };
    });
  }

  async function restore(s, id, { requestId }) {
    try {
      return await store.tx(s.tenantId, async (tx) => {
        await useFresh(tx, s);
        const r = await owned(tx, id);
        checkRestoreRepository(r, now());
        await tx.update("repository", { id }, { removedAt: null });
        await tx.update("forge_repository", { id }, { removedAt: null });
        await security(tx, { what: "repository-restored", repository: id });
        const out = await republish(tx, "repository-restored", human(s), id, {});
        return { entry: out.entry };
      });
    } catch (e) {
      if (e instanceof StoreConflict) throw new Refusal("repository-unavailable");
      throw e;
    }
  }

  async function consent(s, id, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useGesture(tx, s, "consent", id);
      const r = await owned(tx, id);
      if (r.removedAt) throw new Refusal("not-found");
      await tx.update("repository", { id }, { consent: true, consentAt: now() });
      await security(tx, { what: "consent-given", repository: id });
      return { entry: await append(tx, { who: human(s), what: "consent-given", object: id, requestId }) };
    });
  }

  /** Erase the bytes of a repository's uploads; the journal keeps the digests (PADR-0017 point 4). */
  async function eraseIn(tx, s, id, requestId) {
    const ups = (await tx.list("upload", { repositoryRef: id })).filter((u) => !u.erasedAt);
    const digests = [...new Set(ups.map((u) => u.sha256))];
    for (const u of ups) await tx.update("upload", { id: u.id }, { erasedAt: now() });
    const freed = [];
    for (const d of digests) {
      const b = await tx.get("blob", { sha256: d });
      const n = ups.filter((u) => u.sha256 === d).length;
      const refs = Math.max(0, (b?.refs ?? n) - n);
      await tx.update("blob", { sha256: d }, { refs, ...(refs === 0 ? { erasedAt: now() } : {}) });
      if (refs === 0) freed.push(d);
    }
    for (const a of await tx.list("archive", { erasedAt: null })) {
      if ((a.contains ?? []).some((d) => digests.includes(d))) { await objects.removeArchive(tx.tenantId, a.id); await tx.update("archive", { id: a.id }, { erasedAt: now() }); }
    }
    for (const d of freed) await objects.removeBytes(tx.tenantId, d);
    await security(tx, { what: "content-erased", repository: id, digests });
    return republish(tx, "content-erased", human(s), id, { digests });
  }

  async function withdrawConsent(s, id, { erase = false, requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useGesture(tx, s, "consent-withdraw", id);
      const r = await owned(tx, id);
      await tx.update("repository", { id }, { consent: false, consentAt: null });
      await security(tx, { what: "consent-withdrawn", repository: id });
      const e = await append(tx, { who: human(s), what: "consent-withdrawn", object: id, requestId, detail: { erase: Boolean(erase) } });
      if (erase) await eraseIn(tx, s, r.id, requestId);
      return { entry: e, erased: Boolean(erase) };
    });
  }

  async function eraseContent(s, id, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useGesture(tx, s, "content-erase", id);
      const r = await owned(tx, id);
      const out = await eraseIn(tx, s, r.id, requestId);
      return { entry: out.entry };
    });
  }

  async function settings(s, input, { requestId }) {
    if (!["fr", "en"].includes(input?.lang)) throw new Refusal("body-invalid");
    return store.tx(s.tenantId, async (tx) => {
      await useFresh(tx, s);
      await tx.update("tenant", { id: s.tenantId }, { lang: input.lang });
      const out = await republish(tx, "settings-changed", human(s), s.tenantId, { lang: input.lang });
      return { entry: out.entry, lang: input.lang };
    });
  }

  async function reader(s, on, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useGesture(tx, s, on ? "reader-authorize" : "reader-withdraw", "");
      const cur = await tx.get("reader", {});
      const patch = on ? { authorizedAt: now(), withdrawnAt: null } : { withdrawnAt: now() };
      if (cur) await tx.update("reader", {}, patch); else await tx.insert("reader", patch);
      return { entry: await append(tx, { who: human(s), what: on ? "reader-authorized" : "reader-withdrawn", object: "temoin.yml", requestId }) };
    });
  }

  return { declare, patch, confirm, remove, restore, consent, withdrawConsent, eraseContent, settings, reader };
}
