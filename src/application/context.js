// What every use case shares: the journal append (serialised per tenant), the security log written to
// the object store before the database commits (fail closed, PADR-0014 complement), and the assembly
// and publication of a tenant's index from its current uploads (PADR-0011 points 1, 3, 3 bis, 6 bis).
import { createHash, randomBytes } from "node:crypto";
import { nextEntry, entryBody } from "../domain/ledger.js";
import { Refusal } from "../domain/refusals/index.js";
import { GITLAB_COM_ISSUER } from "../domain/forge.js";
import { indexNameOf } from "../domain/issuer.js";

export const sha256 = (b) => createHash("sha256").update(b).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
/** The inventory's `asOf`: a label to the minute, in UTC. */
export const minuteLabel = (ms) => `${iso(ms).slice(0, 16).replace("T", " ")} UTC`;
const PARIS = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const PARIS_OFFSET = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", timeZoneName: "longOffset" });
/**
 * The date the service accepted an upload, as each export's `at` says it: to the minute, in the service's time
 * (Paris) with its offset, the form the app shows every time in (web/views/time.js#when), so that the reading's
 * "last check received" and the service's own lines say the same instant the same way (`2026-11-11 10:42 +01:00`).
 */
export const receivedLabel = (ms) => {
  const d = new Date(ms);
  const offset = (PARIS_OFFSET.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT").replace("GMT", "") || "+00:00";
  return `${PARIS.format(d)} ${offset}`;
};
/** The export files a published version was built from, as its fleet.json names them. */
export const manifestExports = (manifest) => JSON.parse(manifest.toString("utf8")).missions.flatMap((m) => Object.values(m.exports ?? {}).map((e) => e.file));

/**
 * The ports and settings a use case reads. `ports`: store, objects, verifier, authn, assembler, clock,
 * log, ulid. `config`: origin, sendWorkflow, readerRepositoryId.
 */
export function context(ports, config) {
  const { store, objects, clock, assembler } = ports;

  /** Append one entry to the tenant's journal, under the tenant lock. Returns { seq, hash }. */
  async function append(tx, args) {
    await tx.lockTenant();
    const head = await tx.ledgerHead();
    const e = nextEntry(head, entryBody({ received: iso(clock.now()), ...args }));
    await tx.ledgerAppend(e);
    return { seq: e.seq, hash: e.hash };
  }

  /** Write the security log object before the transaction commits; a failure fails the gesture. */
  async function security(tx, event) {
    const id = ports.ulid(clock.now());
    await objects.writeSecurity(tx.tenantId, id, { ...event, at: iso(clock.now()) });
    return id;
  }

  /** The current, non-erased uploads of every live mission of every pinned, live repository. */
  async function currentSet(tx, override = null) {
    const repos = (await tx.list("repository")).filter((r) => !r.removedAt && r.confirmedAt);
    const missions = (await tx.list("mission")).filter((m) => !m.removedAt);
    const uploads = (await tx.list("upload", { rank: "current" })).filter((u) => !u.erasedAt);
    // the host a repository is named under in the index: github.com as before the forge port, gitlab.com,
    // or the host[:port] of the instance its tenant registered (ADR-0029 section 1)
    const forges = (await tx.list("forge_repository")).filter((f) => f.forgeName !== "github");
    const issuers = forges.some((f) => f.issuerKey !== GITLAB_COM_ISSUER) ? await tx.list("issuer") : [];
    const forgeOf = (r) => {
      const f = forges.find((x) => x.id === r.id);
      if (!f) return {};
      if (f.issuerKey === GITLAB_COM_ISSUER) return { forge: f.forgeName, host: "gitlab.com" };
      const reg = issuers.find((i) => i.id === f.issuerKey);
      // no registration, no name: a repository is never named under a host it was not declared on
      if (!reg) throw new Error("a repository's issuer key names no registration of its tenant");
      return { forge: f.forgeName, host: indexNameOf(reg.issuer, "").slice(0, -1) };
    };
    const out = [];
    for (const r of repos.sort((a, b) => a.declaredAt - b.declaredAt || a.name.localeCompare(b.name))) {
      for (const m of missions.filter((x) => x.repositoryRef === r.id).sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id))) {
        const mine = uploads.filter((u) => u.mission === m.id && u.repositoryRef === r.id);
        const byKind = {}, received = {};
        let commit = null;
        for (const u of mine) { byKind[u.kind] = u.sha256; received[u.kind] = receivedLabel(u.receivedAt); if (u.kind === "check") commit = u.commit; }
        if (override && override.mission === m.id && override.repositoryRef === r.id) {
          byKind[override.kind] = override.sha256;
          received[override.kind] = receivedLabel(override.receivedAt);
          if (override.kind === "check") commit = override.commit;
        }
        out.push({ id: m.id, name: r.name, repository: r.name, path: m.path, commit, uploads: byKind, received, ...forgeOf(r) });
      }
    }
    return out;
  }

  /** Assemble the tenant's index from the current set (and a candidate upload), with every byte preloaded. */
  async function assemble(tx, override = null, extraBytes = null) {
    const tenant = await tx.get("tenant", { id: tx.tenantId });
    const missions = await currentSet(tx, override);
    const bytes = new Map();
    for (const m of missions) for (const digest of Object.values(m.uploads)) {
      if (bytes.has(digest)) continue;
      if (extraBytes && digest === override?.sha256) { bytes.set(digest, extraBytes); continue; }
      const b = await objects.getBytes(tx.tenantId, digest);
      if (!b) throw new Refusal("service-unavailable");
      bytes.set(digest, b);
    }
    const asOf = minuteLabel(clock.now());
    return assembler.assemble({ title: tenant.title, lang: tenant.lang, asOf, missions, read: (d) => bytes.get(d) ?? null });
  }

  /** Publish an assembled index as the next version (compare and swap under the tenant lock). */
  async function publish(tx, built, seq) {
    await tx.lockTenant();
    const versions = await tx.list("fleet_index");
    const last = versions.reduce((a, v) => (v.version > (a?.version ?? 0) ? v : a), null);
    // an erased version is never the one served again: the same index, rebuilt, is a new version with its bytes
    if (last && !last.erasedAt && last.sha256 === built.sha256 && last.manifestSha256 === built.manifestSha256) return { version: last.version, sha256: last.sha256, unchanged: true };
    const version = (last?.version ?? 0) + 1;
    await tx.insert("fleet_index", {
      version, sha256: built.sha256, bytes: built.bytes, manifestSha256: built.manifestSha256, manifest: built.manifest,
      fleetVersion: assembler.pin.version, fleetArchiveSha256: assembler.pin.archiveSha256, seq, publishedAt: clock.now(),
    });
    return { version, sha256: built.sha256 };
  }

  /** The version served: the last one published, or none when its bytes were erased and nothing was published since. */
  async function latestIndex(tx) {
    const versions = await tx.list("fleet_index");
    const last = versions.reduce((a, v) => (v.version > (a?.version ?? 0) ? v : a), null);
    return last && !last.erasedAt ? last : null;
  }

  /**
   * Erase the bytes of every published version built from an export that is no longer held (ADR-0009,
   * lot E1 of 2026-11-10). A version's bytes are the projection of the uploads its fleet.json names: once
   * one of them is erased, the version carries content the tenant asked to erase. The rule reads the
   * state, not the gesture: a version keeps its bytes only while, for each export it names, an upload of
   * that mission, kind and digest is still held. So it is the same after an erasure on demand, after the
   * retention job, after a replayed erasure on a restored database, and for an erasure made before this
   * rule existed; applied twice, it changes nothing. The digests, the seq and the fleet.json stay: the
   * journal names them and replay.json says which index no longer replays. An archive prepared before
   * may carry those versions: every live archive goes with them. Returns the versions erased.
   * The caller holds the tenant lock since before its first read (review finding C21 of 2026-11-10): the
   * state read here is then the one every transaction that publishes has committed, and none can publish
   * between this read and the caller's commit. It reads the versions not yet erased, and of each its
   * number and its fleet.json only (C23): never the bytes, whose sum grows with every upload. The date
   * of the erasure is the database's (C24): the store writes it, whatever is given.
   */
  async function eraseIndexVersions(tx) {
    const held = new Set((await tx.list("upload")).filter((u) => !u.erasedAt).map((u) => assembler.exportPath(u.mission, u.kind, u.sha256)));
    const erased = [];
    for (const v of await tx.indexVersionsWhole()) {
      if (manifestExports(v.manifest).every((f) => held.has(f))) continue;
      await tx.update("fleet_index", { version: v.version }, { bytes: Buffer.alloc(0), erasedAt: clock.now() });
      erased.push(v.version);
    }
    if (erased.length) {
      for (const a of await tx.list("archive", { erasedAt: null })) { await objects.removeArchive(tx.tenantId, a.id); await tx.update("archive", { id: a.id }, { erasedAt: clock.now() }); }
    }
    return erased;
  }

  /** Reassemble after a gesture that changes the set (remove, restore, erase, language); never blocks it. */
  async function republish(tx, what, who, object, detail = {}) {
    // the lock before the set is read (C21): a version assembled before another transaction's erasure
    // committed would be published after it, whole, from content that is no longer held
    await tx.lockTenant();
    const built = await assemble(tx);
    const pinDetail = { fleetVersion: assembler.pin.version, fleetArchiveSha256: assembler.pin.archiveSha256 };
    if (!built.ok) {
      const e = await append(tx, { who, what, object, detail: { ...detail, index: "unchanged", refusal: built.refusal } });
      return { entry: e, index: null };
    }
    const head = await tx.ledgerHead();
    const seq = (head?.seq ?? 0) + 1;
    const pub = await publish(tx, built, seq);
    const e = await append(tx, { who, what, object, detail: { ...detail, indexSha256: built.sha256, manifestSha256: built.manifestSha256, indexVersion: pub.version, ...pinDetail } });
    return { entry: e, index: pub };
  }

  return { ports, config, store, objects, clock, append, security, assemble, publish, latestIndex, eraseIndexVersions, republish, currentSet };
}
