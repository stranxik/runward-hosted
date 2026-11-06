// What a member (or the witness reader) reads: the served index, the per-mission status line, the
// journal, the export archive with replay.json (PADR-0011 4 bis and 6 bis, PADR-0014, PADR-0017 point 10,
// PADR-0020).
import { Refusal } from "../domain/refusals.js";
import { verifyChain } from "../domain/ledger.js";
import { ARCHIVE_MAX_BYTES, ARCHIVE_LIFE } from "../domain/repository.js";
import { iso, sha256 } from "./context.js";

const PAGE = 50;

export function readingCases(ctx, identity) {
  const { store, clock, append, objects, latestIndex } = ctx;
  const { exportPath } = ctx.ports.assembler;
  const tar = (files) => ctx.ports.archive.pack(files);
  const now = () => clock.now();

  async function index(tenantId) {
    return store.tx(tenantId, async (tx) => {
      const idx = await latestIndex(tx);
      return idx ? { bytes: idx.bytes, sha256: idx.sha256, version: idx.version } : null;
    });
  }

  /** One line per declared mission: last accepted upload, uploads not accepted since, the last code. */
  async function status(s) {
    return store.tx(s.tenantId, async (tx) => {
      const repos = await tx.list("repository");
      const forge = await tx.list("forge_repository");
      const missions = (await tx.list("mission")).filter((m) => !m.removedAt);
      const uploads = await tx.list("upload");
      const entries = await tx.ledgerAll();
      const idx = await latestIndex(tx);
      const lines = [];
      for (const m of missions) {
        const r = repos.find((x) => x.id === m.repositoryRef);
        if (!r || r.removedAt) continue;
        const cur = uploads.filter((u) => u.mission === m.id && u.rank === "current" && u.kind === "check")[0] ?? null;
        const since = entries.filter((e) => ["send-not-accepted", "send-quarantined"].includes(e.body.what) && e.body.detail?.mission === m.id && e.seq > (cur?.seq ?? 0));
        const last = since[since.length - 1];
        lines.push({
          mission: m.id, repository: r.name, state: forge.find((f) => f.id === r.id)?.state ?? "pending",
          accepted: cur ? { entry: cur.id, seq: cur.seq, runId: cur.runId, runNumber: cur.runNumber, runAttempt: cur.runAttempt, commit: cur.commit, receivedAt: iso(cur.receivedAt), source: "service clock (declared)" } : null,
          notAcceptedSince: since.length,
          lastRefusal: last ? last.body.detail.refusal : null,
        });
      }
      const quarantined = uploads.filter((u) => u.rank === "quarantine" && !u.erasedAt).length;
      return { lines, index: idx ? { sha256: idx.sha256, version: idx.version, publishedAt: iso(idx.publishedAt), seq: idx.seq, fleetVersion: idx.fleetVersion } : null, quarantined };
    });
  }

  async function journal(s, cursor) {
    let before = null;
    if (cursor !== undefined && cursor !== null && cursor !== "") {
      if (!/^[0-9]{1,15}$/.test(String(cursor))) throw new Refusal("cursor-invalid");
      before = Number(cursor);
    }
    return store.tx(s.tenantId, async (tx) => {
      const head = await tx.ledgerHead();
      if (before !== null && (before < 1 || before > (head?.seq ?? 0) + 1)) throw new Refusal("cursor-invalid");
      const page = await tx.ledgerPage({ before, limit: PAGE });
      const lowest = page.length ? page[page.length - 1].seq : null;
      return {
        head, entries: page.map((e) => ({ seq: e.seq, prev: e.prev, hash: e.hash, body: e.body })),
        next: lowest && lowest > 1 ? String(lowest) : null, end: !lowest || lowest <= 1,
        note: "Ce journal est chaîné ; sa tête est recopiée dans le résumé de chaque job qui envoie, pas encore publiée ailleurs.",
      };
    });
  }

  /** Build the archive: fleet.json and index of each version, the exports, the journal, replay.json. */
  async function buildArchive(tx) {
    const versions = (await tx.list("fleet_index")).sort((a, b) => a.version - b.version);
    const uploads = (await tx.list("upload")).filter((u) => !u.erasedAt && u.rank !== "pending");
    const pendingKept = (await tx.list("upload", { rank: "pending" })).filter((u) => !u.erasedAt);
    const entries = await tx.ledgerAll();
    const chain = verifyChain(entries);
    const files = [];
    const seen = new Set();
    let total = 0;
    for (const u of [...uploads, ...pendingKept]) {
      const name = exportPath(u.mission, u.kind, u.sha256);
      if (seen.has(name)) continue;
      seen.add(name);
      const b = await objects.getBytes(tx.tenantId, u.sha256);
      if (!b) continue;
      total += b.length;
      if (total > ARCHIVE_MAX_BYTES) throw new Refusal("export-too-large");
      files.push({ name, bytes: b });
    }
    const erased = new Set((await tx.list("upload")).filter((u) => u.erasedAt).map((u) => u.sha256));
    const replay = {
      format: "runward-hosted-replay/0",
      how: "for each version: copy versions/<version>/fleet.json next to exports/, run `runward-fleet build fleet.json` with the runward-fleet version named, and compare the sha256 of index.json",
      head: chain.head ?? null,
      chainOk: chain.ok,
      versions: versions.map((v) => {
        const doc = JSON.parse(v.manifest.toString("utf8"));
        const needs = doc.missions.flatMap((m) => Object.values(m.exports ?? {}).map((e) => e.file));
        const missing = needs.filter((f) => !seen.has(f));
        return { version: v.version, seq: v.seq, indexSha256: v.sha256, manifestSha256: v.manifestSha256, runwardFleet: v.fleetVersion, runwardFleetArchiveSha256: v.fleetArchiveSha256, replayable: missing.length === 0, ...(missing.length ? { why: [...erased].length ? "content erased" : "bytes missing" } : {}) };
      }),
    };
    const out = [
      { name: "README.txt", bytes: Buffer.from("runward hosted export. replay.json says, for each published index, which runward-fleet version rebuilds it from versions/<version>/fleet.json and exports/. journal.jsonl is the tenant's chained journal, one canonical entry per line.\n") },
      { name: "replay.json", bytes: Buffer.from(`${JSON.stringify(replay, null, 2)}\n`) },
      { name: "journal.jsonl", bytes: Buffer.from(entries.map((e) => JSON.stringify({ seq: e.seq, prev: e.prev, hash: e.hash, body: e.body })).join("\n") + (entries.length ? "\n" : "")) },
      ...versions.flatMap((v) => [{ name: `versions/${v.version}/fleet.json`, bytes: v.manifest }, { name: `versions/${v.version}/index.json`, bytes: v.bytes }]),
      ...(versions.length ? [{ name: "fleet.json", bytes: versions[versions.length - 1].manifest }] : []),
      ...files,
    ];
    return { bytes: tar(out), contains: [...new Set(uploads.map((u) => u.sha256))] };
  }

  async function prepareExport(s, { requestId, reader = false }) {
    return store.tx(s.tenantId, async (tx) => {
      if (!reader) await identity.useGesture(tx, s, "export", "");
      const { bytes, contains } = await buildArchive(tx);
      const id = store.newId();
      await objects.putArchive(tx.tenantId, id, bytes);
      await tx.insert("archive", { id, preparedAt: now(), size: bytes.length, sha256: sha256(bytes), contains });
      const e = await append(tx, { who: reader ? { type: "reader", id: "temoin.yml" } : { type: "human", id: s.memberId }, what: reader ? "reader-read" : "export-prepared", object: id, requestId, detail: { size: bytes.length, sha256: sha256(bytes) } });
      return { id, size: bytes.length, sha256: sha256(bytes), expiresAt: iso(now() + ARCHIVE_LIFE), entry: e, bytes };
    });
  }

  async function downloadExport(s, id) {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) throw new Refusal("not-found");
    return store.tx(s.tenantId, async (tx) => {
      const a = await tx.get("archive", { id });
      if (!a || a.erasedAt || now() - a.preparedAt >= ARCHIVE_LIFE) throw new Refusal("not-found");
      const bytes = await objects.getArchive(tx.tenantId, id);
      if (!bytes) throw new Refusal("not-found");
      return { bytes, sha256: a.sha256 };
    });
  }

  return { index, status, journal, prepareExport, downloadExport, buildArchive };
}
