// What a member (or the witness reader) reads: the served index, the per-mission status line, the
// journal, the export archive with replay.json (PADR-0011 4 bis and 6 bis, PADR-0014, PADR-0017 point 10,
// PADR-0020).
import { Refusal } from "../domain/refusals/index.js";
import { verifyChain } from "../domain/ledger.js";
import { ARCHIVE_MAX_BYTES, ARCHIVE_LIFE } from "../domain/repository.js";
import { GITLAB_COM_ISSUER, levelCode, forgeOfWorkload } from "../domain/forge.js";
import { iso, sha256, manifestExports } from "./context.js";

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

  /** An entry of the journal as the dashboard shows it: kind, time, mission, run, the refusal code. No name. */
  const brief = (e) => {
    const d = e.body.detail ?? {};
    return {
      seq: e.seq, what: e.body.what, who: e.body.who.type, forge: e.body.who.type === "workload" ? forgeOfWorkload(e.body.who.id) : null, at: e.body.dates?.received?.at ?? null,
      mission: d.mission ?? null, kind: d.kind ?? null, repository: d.claims?.repository ?? d.name ?? null,
      runNumber: d.runNumber ?? null, refusal: d.refusal ?? null, commit: d.commit ?? null,
    };
  };

  /**
   * One line per declared mission: last accepted upload (with what the verdict comes from), uploads not
   * accepted since and the last code, the repository's consent, and the mission's recent activity; plus the
   * fleet's recent activity and the journal head. The dashboard and a mission's page read this and the
   * index only: no call per mission (architecture §6, the budget of a screen).
   */
  async function status(s) {
    return store.tx(s.tenantId, async (tx) => {
      const repos = await tx.list("repository");
      const forge = await tx.list("forge_repository");
      const missions = (await tx.list("mission")).filter((m) => !m.removedAt);
      const uploads = await tx.list("upload");
      const entries = await tx.ledgerAll();
      const idx = await latestIndex(tx);
      const issuerKeys = forge.some((f) => f.forgeName !== "github" && f.issuerKey !== GITLAB_COM_ISSUER) ? await tx.list("issuer_key") : [];
      /**
       * The level of evidence of a mission (ADR-0029 section 2): the one its current upload reached, with
       * what it rests on; before any upload, the one its repository's uploads will reach. Never absent.
       * `keyRetiredAt`: the key that signed the current upload was retired since, on that date.
       */
      const levelOfLine = (r, f, cur) => {
        const forgeName = f?.forgeName ?? "github";
        const registered = forgeName !== "github" && f.issuerKey !== GITLAB_COM_ISSUER;
        const kept = cur?.claims?.level ?? null;
        const expected = levelCode({ forge: forgeName, issuerKind: registered ? "registered" : "public", protectionRequired: !r.protectionLiftedAt });
        const key = kept?.kid && registered ? issuerKeys.find((k) => k.issuerRef === f.issuerKey && k.kid === kept.kid) ?? null : null;
        // GitHub has one level: an upload of before the levels were journaled reached it too
        return { code: kept?.code ?? expected, reached: Boolean(kept) || (forgeName === "github" && Boolean(cur)), issuer: registered ? "registered" : "public", kid: kept?.kid ?? null, thumbprint: kept?.thumbprint ?? null, protectionRequired: forgeName === "github" ? null : kept ? kept.protectionRequired : !r.protectionLiftedAt, ...(key?.retiredAt ? { keyRetiredAt: iso(key.retiredAt) } : {}) };
      };
      /**
       * GitLab's signal (section 3 rule 7): the last upload ranked historical although its token was issued
       * after the current one's, in the current epoch, with both orders. A member then opens a new epoch.
       */
      const orderSignal = (r, m, cur) => {
        if (!cur) return null;
        const late = uploads.filter((u) => u.mission === m.id && u.kind === cur.kind && u.rank === "historical" && u.epoch === cur.epoch && u.claims?.issuedLater === true && u.seq > cur.seq).pop();
        if (!late) return null;
        const order = (u) => ({ pipelineId: u.runNumber, jobId: u.runAttempt, issuedAt: u.claims?.issuedAt ? iso(u.claims.issuedAt * 1000) : null });
        return { repository: r.id, epoch: cur.epoch, current: order(cur), later: order(late) };
      };
      const lines = [];
      for (const m of missions) {
        const r = repos.find((x) => x.id === m.repositoryRef);
        if (!r || r.removedAt) continue;
        const f = forge.find((x) => x.id === r.id);
        const cur = uploads.filter((u) => u.mission === m.id && u.rank === "current" && u.kind === "check")[0] ?? null;
        const since = entries.filter((e) => ["send-not-accepted", "send-quarantined"].includes(e.body.what) && e.body.detail?.mission === m.id && e.seq > (cur?.seq ?? 0));
        const last = since[since.length - 1];
        const mine = entries.filter((e) => e.body.detail?.mission === m.id || (e.body.object === r.id && e.body.who.type === "human"));
        lines.push({
          mission: m.id, repository: r.name, path: m.path, state: f?.state ?? "pending", consent: r.consent,
          forge: f?.forgeName ?? "github", level: levelOfLine(r, f, cur), orderSignal: orderSignal(r, m, cur),
          accepted: cur ? {
            entry: cur.id, seq: cur.seq, runId: cur.runId, runNumber: cur.runNumber, runAttempt: cur.runAttempt, commit: cur.commit,
            receivedAt: iso(cur.receivedAt), source: "service clock (declared)", kind: cur.kind,
            workflow: f?.forgeName === "gitlab" ? r.workflow : String(cur.claims?.workflowRef ?? "").replace(`${cur.claims?.repository}/`, "").replace(/@refs\/heads\/main$/, ""),
          } : null,
          notAcceptedSince: since.length,
          lastRefusal: last ? last.body.detail.refusal : null,
          lastRefusalSeq: last ? last.seq : null,
          lastRefusalAt: last ? last.body.dates?.received?.at ?? null : null,
          activity: mine.slice(-8).reverse().map(brief),
        });
      }
      const quarantined = uploads.filter((u) => u.rank === "quarantine" && !u.erasedAt).length;
      const head = entries.length ? { seq: entries[entries.length - 1].seq, hash: entries[entries.length - 1].hash } : null;
      return {
        lines, quarantined, head,
        recent: entries.slice(-7).reverse().map(brief),
        index: idx ? { sha256: idx.sha256, version: idx.version, publishedAt: iso(idx.publishedAt), seq: idx.seq, fleetVersion: idx.fleetVersion } : null,
      };
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

  /**
   * Build the archive: fleet.json and index of each version, the exports, the journal, replay.json.
   * Nothing erased comes back through it: a version's index.json is packed only when its bytes were not
   * erased and every export it was built from is still held (the rule of context.js#eraseIndexVersions,
   * read here too, so that an archive never waits for the pass that applies it). Such a version keeps its
   * fleet.json and its digests in replay.json, which says `indexErased`.
   * An export is held once its bytes were read, not on the word of its row (review finding C22 of
   * 2026-11-10): after a restore, the database counts bytes the object store no longer has, and a version
   * built from them is neither packed nor called replayable (`indexWithheld`, `why: "bytes missing"`).
   */
  async function buildArchive(tx) {
    const versions = (await tx.list("fleet_index")).sort((a, b) => a.version - b.version);
    const uploads = (await tx.list("upload")).filter((u) => !u.erasedAt && u.rank !== "pending");
    const pendingKept = (await tx.list("upload", { rank: "pending" })).filter((u) => !u.erasedAt);
    const entries = await tx.ledgerAll();
    const chain = verifyChain(entries);
    const files = [];
    const asked = new Set(), held = new Set();
    let total = 0;
    for (const u of [...uploads, ...pendingKept]) {
      const name = exportPath(u.mission, u.kind, u.sha256);
      if (asked.has(name)) continue;
      asked.add(name);
      const b = await objects.getBytes(tx.tenantId, u.sha256);
      if (!b) continue;
      held.add(name);
      total += b.length;
      if (total > ARCHIVE_MAX_BYTES) throw new Refusal("export-too-large");
      files.push({ name, bytes: b });
    }
    const erased = new Set((await tx.list("upload")).filter((u) => u.erasedAt).map((u) => exportPath(u.mission, u.kind, u.sha256)));
    const indexKept = (v) => !v.erasedAt && v.bytes.length > 0 && manifestExports(v.manifest).every((f) => held.has(f));
    const replay = {
      format: "runward-hosted-replay/0",
      how: "for each version: copy versions/<version>/fleet.json next to exports/, run `runward-fleet build fleet.json` with the runward-fleet version named, and compare the sha256 of index.json",
      head: chain.head ?? null,
      chainOk: chain.ok,
      versions: versions.map((v) => {
        const missing = manifestExports(v.manifest).filter((f) => !held.has(f));
        return { version: v.version, seq: v.seq, indexSha256: v.sha256, manifestSha256: v.manifestSha256, runwardFleet: v.fleetVersion, runwardFleetArchiveSha256: v.fleetArchiveSha256, replayable: missing.length === 0, ...(missing.length ? { why: missing.every((f) => erased.has(f)) ? "content erased" : "bytes missing" } : {}), ...(indexKept(v) ? {} : v.erasedAt || missing.some((f) => erased.has(f)) ? { indexErased: true } : { indexWithheld: true }) };
      }),
    };
    const out = [
      { name: "README.txt", bytes: Buffer.from("runward hosted export. replay.json says, for each published index, which runward-fleet version rebuilds it from versions/<version>/fleet.json and exports/. journal.jsonl is the tenant's chained journal, one canonical entry per line. A version whose content was erased keeps its fleet.json and its digests; its index.json is not in the archive (replay.json: indexErased). Nor is the index.json of a version when the bytes of an export it was built from cannot be read (replay.json: indexWithheld, why: bytes missing).\n") },
      { name: "replay.json", bytes: Buffer.from(`${JSON.stringify(replay, null, 2)}\n`) },
      { name: "journal.jsonl", bytes: Buffer.from(entries.map((e) => JSON.stringify({ seq: e.seq, prev: e.prev, hash: e.hash, body: e.body })).join("\n") + (entries.length ? "\n" : "")) },
      ...versions.flatMap((v) => [{ name: `versions/${v.version}/fleet.json`, bytes: v.manifest }, ...(indexKept(v) ? [{ name: `versions/${v.version}/index.json`, bytes: v.bytes }] : [])]),
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
