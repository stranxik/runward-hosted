// Declared repositories, their missions, consent and erasure (architecture §3.1, §3.4; PADR-0017).
import { Refusal } from "../domain/refusals/index.js";
import { readDeclaration, readBranch, readDefinitionFile, checkRestoreRepository, confirmation, githubPinValues, MISSION_ID, REMOVED_KEEP } from "../domain/repository.js";
import { GITHUB_ISSUER_KEY, GITLAB_COM_ISSUER, scopedKey, nameKeyOf, pinDigest, confirmObject } from "../domain/forge.js";
import { indexNameOf } from "../domain/issuer.js";
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

  /** The name the index gives a repository: host[:port]/full/path (ADR-0029 section 1). */
  const indexName = (forgeName, issuerKey, issuer, name) => (forgeName === "github" ? `github.com/${name}` : issuerKey === GITLAB_COM_ISSUER ? `gitlab.com/${name}` : indexNameOf(issuer.issuer, name));
  /** A name the pinned runward-fleet cannot carry is refused, with its reason, never truncated (section 1). */
  const carried = (name) => { if (!ctx.ports.assembler.admits(name)) throw new Refusal("repository-path-unsupported", { forge: "gitlab", name }); };

  async function declare(s, input, { requestId }) {
    const d = readDeclaration(input);
    try {
      return await store.tx(s.tenantId, async (tx) => {
        await useFresh(tx, s);
        let issuerKey = GITHUB_ISSUER_KEY;
        if (d.forge === "gitlab") {
          // the issuer: gitlab.com, or an instance this tenant registered (read under its own policies)
          const reg = d.issuer === "gitlab.com" ? null : await tx.get("issuer", { id: d.issuer });
          if (d.issuer !== "gitlab.com" && (!reg || reg.removedAt)) throw new Refusal("issuer-unknown");
          issuerKey = reg ? reg.id : GITLAB_COM_ISSUER;
          carried(indexName("gitlab", issuerKey, reg, d.name));
        }
        if (d.consent) await useGesture(tx, s, "declare-with-consent", d.nameKey);
        const taken = await tx.nameTaken({ forge: d.forge, issuerKey, nameKey: d.nameKey });
        if (taken === "here") throw new Refusal("repository-exists");
        if (taken === "elsewhere") throw new Refusal("repository-unavailable");
        const existing = await tx.list("mission");
        for (const m of d.missions) if (existing.some((x) => x.id === m.id)) throw new Refusal("mission-exists");
        const id = store.newId();
        await tx.insert("forge_repository", { id, forgeName: d.forge, issuerKey, nameKey: nameKeyOf(d.forge, issuerKey, d.name), name: d.name, state: "pending" });
        await tx.insert("repository", { id, name: d.name, workflow: d.workflow, defaultBranch: d.defaultBranch, consent: d.consent, consentAt: d.consent ? now() : null, declaredAt: now() });
        for (const m of d.missions) await tx.insert("mission", { id: m.id, repositoryRef: id, path: m.path, addedAt: now() });
        const e = await append(tx, { who: human(s), what: "repository-declared", object: id, requestId, detail: { name: d.name, workflow: d.workflow, defaultBranch: d.defaultBranch, missions: d.missions.map((m) => m.id), ...(d.forge === "github" ? {} : { forge: d.forge, issuerKey }) } });
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
      const f = await tx.get("forge_repository", { id });
      const gitlab = f.forgeName === "gitlab";
      if (input.workflow !== undefined && input.workflow !== r.workflow) {
        if (gitlab) {
          const file = readDefinitionFile(input.workflow);
          await tx.update("repository", { id }, { workflow: file });
          changes.workflow = file;
        } else {
          const d = readDeclaration({ name: r.name, workflow: input.workflow, missions: [{ id: "x" }] });
          await tx.update("repository", { id }, { workflow: d.workflow, epoch: r.epoch + 1 });
          changes.workflow = d.workflow; changes.epoch = r.epoch + 1;
        }
      }
      if (input.defaultBranch !== undefined && input.defaultBranch !== r.defaultBranch) {
        const b = readBranch(input.defaultBranch);
        await tx.update("repository", { id }, { defaultBranch: b });
        changes.defaultBranch = b;
      }
      // GitLab: a change of the declared file or branch unpins the definition; every upload is then refused
      // `definition-not-pinned` until a member confirms the new one (ADR-0029 section 3 rule 3)
      if (gitlab && f.definitionRef && (changes.workflow !== undefined || changes.defaultBranch !== undefined)) {
        await tx.update("forge_repository", { id }, { definitionRef: null });
        changes.definitionUnpinned = true;
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

  /**
   * Pin what the kept upload's claims carry (GitHub: repository_id and repository_owner_id; GitLab: the
   * project, its namespace, its path and the pipeline definition), or confirm a new owner or definition.
   * The gesture is bound to the repository and to the digest of the values to pin, which the screen showed
   * (ADR-0029 section 1): `input.digest` is the one the member saw, and a confirmation whose values are no
   * longer those is refused `confirmation-stale`. What is pinned is what the member saw.
   */
  async function confirm(s, id, input, { requestId }) {
    try {
      return await store.tx(s.tenantId, async (tx) => {
        const r = await owned(tx, id);
        if (r.removedAt) throw new Refusal("not-found");
        const f = await tx.get("forge_repository", { id });
        const gitlab = f.forgeName === "gitlab";
        const pin = confirmation(r, f);
        const digest = pinDigest(gitlab ? pin.values : githubPinValues(pin));
        if (input?.digest !== undefined && input.digest !== digest) throw new Refusal("confirmation-stale", { digest });
        await useGesture(tx, s, "repository-confirm", confirmObject(id, digest));
        if (gitlab) {
          // the definition must name the declared file, on the declared branch, of the token's own project
          if (!pin.confirmable) throw new Refusal("definition-not-pinned", { forge: "gitlab" });
          // a renamed or moved project is named by its new path, if the index can carry it
          if (pin.path !== r.name) {
            carried(indexName("gitlab", f.issuerKey, f.issuerKey === GITLAB_COM_ISSUER ? null : await tx.get("issuer", { id: f.issuerKey }), pin.path));
            await tx.update("repository", { id }, { name: pin.path });
          }
          await tx.update("forge_repository", { id }, { repositoryId: scopedKey("gitlab", f.issuerKey, pin.repositoryId), ownerId: pin.ownerId, definitionRef: pin.definitionRef, name: pin.path, nameKey: nameKeyOf("gitlab", f.issuerKey, pin.path), state: "pinned" });
        } else {
          await tx.update("forge_repository", { id }, { repositoryId: pin.repositoryId, ownerId: pin.ownerId, state: "pinned" });
        }
        await tx.update("repository", { id }, { confirmedAt: r.confirmedAt ?? now(), pendingSend: null });
        let published = null, quarantine = null;
        if (!r.pendingSend.uploadId) {
          // no byte kept (content not consented): the mission still enters the index, declared and silent
          const built = await ctx.assemble(tx);
          if (built.ok) { const head = await tx.ledgerHead(); published = await ctx.publish(tx, built, head.seq + 1); }
        } else {
          const u = await tx.get("upload", { id: r.pendingSend.uploadId });
          const built = await ctx.assemble(tx, { mission: u.mission, repositoryRef: id, kind: u.kind, sha256: u.sha256, commit: u.commit, receivedAt: u.receivedAt });
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
        const e = await append(tx, { who: human(s), what: "repository-confirmed", object: id, requestId, detail: { repositoryId: pin.repositoryId, ownerId: pin.ownerId, pinned: digest, ...(gitlab ? { forge: "gitlab", issuerKey: f.issuerKey, path: pin.path, definitionRef: pin.definitionRef } : {}), ...(published ? { indexSha256: published.sha256, indexVersion: published.version, fleetVersion: ctx.ports.assembler.pin.version, fleetArchiveSha256: ctx.ports.assembler.pin.archiveSha256 } : {}), ...(quarantine ? { refusal: quarantine } : {}) } });
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

  /** A GitLab repository of this tenant, live, or `not-found`: the two gestures below are GitLab's. */
  async function gitlabOwned(tx, id) {
    const r = await owned(tx, id);
    const f = await tx.get("forge_repository", { id });
    if (r.removedAt || f.forgeName !== "gitlab") throw new Refusal("not-found");
    return r;
  }

  /**
   * Lift, or require again, the protection of the declared branch (ADR-0029 section 2). Lifting lowers the
   * level of every later upload to P3b; requiring it again withdraws an access, so both are written to the
   * security log before commit and replayed after a restore (T24).
   */
  async function protection(s, id, lift, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useGesture(tx, s, lift ? "protection-lift" : "protection-restore", id);
      const r = await gitlabOwned(tx, id);
      await tx.update("repository", { id }, { protectionLiftedAt: lift ? now() : null });
      if (lift) await security(tx, { what: "protection-lifted", repository: id });
      else await security(tx, { what: "protection-restored", repository: id });
      const e = await append(tx, { who: human(s), what: lift ? "protection-lifted" : "protection-restored", object: id, requestId, detail: { name: r.name } });
      return { entry: e, protectionRequired: !lift };
    });
  }

  /**
   * Open a new order epoch (ADR-0029 section 3 rule 7): after an instance was restored from a backup its
   * pipelines count again from lower numbers, and no rule tells that from a late job of an old pipeline.
   * The next upload of each mission and kind becomes the current one.
   */
  async function openEpoch(s, id, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useGesture(tx, s, "order-epoch-open", id);
      const r = await gitlabOwned(tx, id);
      await tx.update("repository", { id }, { epoch: r.epoch + 1 });
      const e = await append(tx, { who: human(s), what: "order-epoch-opened", object: id, requestId, detail: { name: r.name, epoch: r.epoch + 1 } });
      return { entry: e, epoch: r.epoch + 1 };
    });
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

  /**
   * Erase the bytes of a repository's uploads, and of every published version of the index that was built
   * from them; the journal keeps the digests (PADR-0017 point 4), the versions keep theirs.
   */
  async function eraseIn(tx, s, id, requestId) {
    // the tenant lock before the first read (C21): an upload in flight commits its version first, and
    // the erasure then sees that version and that upload
    await tx.lockTenant();
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
    const indexVersions = await ctx.eraseIndexVersions(tx);
    for (const a of await tx.list("archive", { erasedAt: null })) {
      if ((a.contains ?? []).some((d) => digests.includes(d))) { await objects.removeArchive(tx.tenantId, a.id); await tx.update("archive", { id: a.id }, { erasedAt: now() }); }
    }
    for (const d of freed) await objects.removeBytes(tx.tenantId, d);
    await security(tx, { what: "content-erased", repository: id, digests });
    return republish(tx, "content-erased", human(s), id, { digests, indexVersions });
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

  return { declare, patch, confirm, protection, openEpoch, remove, restore, consent, withdrawConsent, eraseContent, settings, reader };
}
