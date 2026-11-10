// POST /api/v0/exports: an upload carried by the workload identity token of the send workflow
// (PADR-0010 and its note; PADR-0011 points 1, 3, 1 bis; PADR-0017 point 8).
// Order (T18): headers and token, then the repository, then the body. A refusal before the repository is
// resolved writes nothing to any tenant's journal; it goes to the global counter of refused tokens.
import { Refusal } from "../domain/refusals/index.js";
import { readClaims, checkGenericClaims, checkRepositoryClaims, checkUploadHeaders, placeUpload, rateWindow, RUNS_PER_HOUR } from "../domain/workload.js";
import { sha256, iso } from "./context.js";
import { StoreConflict, VerifierUnavailable } from "../ports/errors.js";

export function ingestCases(ctx) {
  const { store, clock, append, objects, assemble, publish, latestIndex } = ctx;
  const { verifier, log } = ctx.ports;
  const now = () => clock.now();

  const workload = (c) => ({ type: "workload", id: `github:${c.repositoryId}` });
  const claimsKept = (c) => ({
    repository: c.repository, repositoryId: c.repositoryId, repositoryOwnerId: c.repositoryOwnerId, workflowRef: c.workflowRef,
    jobWorkflowRef: c.jobWorkflowRef, jobWorkflowSha: c.jobWorkflowSha, eventName: c.eventName, ref: c.ref, sha: c.sha,
    runnerEnvironment: c.runnerEnvironment, runId: c.runId, runNumber: c.runNumber, runAttempt: c.runAttempt,
  });

  async function verifyToken(authorization, audience) {
    const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(String(authorization ?? ""));
    if (!m) throw new Refusal("token-missing");
    let raw;
    try { raw = await verifier.verify(m[1], { audience }); } catch (e) {
      if (e.code) throw new Refusal(e.code);
      // only the verifier saying it could not work is the service's failure (503, retried by the sender);
      // anything else it throws on a caller's token is a token it could not read (review finding of
      // 2026-11-10: every codeless error was answered 503 and logged as a key outage)
      if (e instanceof VerifierUnavailable) {
        log.warn("oidc.keys-unavailable", { error: String(e.message).slice(0, 120) });
        throw new Refusal("service-unavailable");
      }
      log.error("oidc.verifier-error", { error: String(e?.message ?? e).slice(0, 120) });
      throw new Refusal("token-unreadable");
    }
    const c = readClaims(raw);
    if (!c) throw new Refusal("token-unreadable");
    const fresh = await store.tx(null, (tx) => tx.useJti(c.jti, (raw.exp + 60) * 1000));
    if (!fresh) throw new Refusal("token-replayed");
    return c;
  }

  /** A refusal for a repository of this tenant is written to its own journal; it never reaches another. */
  async function notAccepted(tenantId, c, code, mission, kind, requestId) {
    await store.tx(tenantId, (tx) => append(tx, { who: workload(c), what: "send-not-accepted", object: null, requestId, issued: c.iat ? iso(c.iat * 1000) : null, detail: { refusal: code, mission: mission ?? "", kind: kind ?? "", runId: c.runId, runNumber: c.runNumber, runAttempt: c.runAttempt, claims: claimsKept(c) } }));
  }

  /**
   * `headers`: authorization, runward-mission, runward-export-kind, content-length, content-digest.
   * `readBody(limit)`: reads at most `limit` bytes, or throws Refusal("too-large").
   */
  async function upload({ headers, readBody, requestId }) {
    const maint = await store.tx(null, (tx) => tx.maintenance());
    if (maint) throw new Refusal("maintenance", { retryAfter: 600 });
    const c = await verifyToken(headers.authorization, ctx.config.origin);
    const mission = headers["runward-mission"];
    const kind = headers["runward-export-kind"];
    const bucket = rateWindow(now()).bucket;
    let head, generic;
    try {
      head = checkUploadHeaders({ kind, mission, contentLength: headers["content-length"], contentDigest: headers["content-digest"] });
      generic = checkGenericClaims(c, { sendWorkflow: ctx.config.sendWorkflow });
    } catch (e) {
      if (e instanceof Refusal) await store.tx(null, (tx) => tx.countRefused(c.repositoryId, bucket));
      throw e;
    }
    const res = await store.tx(null, (tx) => tx.resolveRepository({ forge: "github", repositoryId: c.repositoryId, nameKey: c.repository.toLowerCase() }));
    if (!res) { await store.tx(null, (tx) => tx.countRefused(c.repositoryId, bucket)); throw new Refusal("repository-not-declared"); }
    const tenantId = res.tenantId;
    if (res.removed) { await notAccepted(tenantId, c, "repository-not-declared", mission, kind, requestId); throw new Refusal("repository-not-declared"); }

    // ---- the repository's pins
    const repo = await store.tx(tenantId, async (tx) => {
      const r = await tx.get("repository", { id: res.id });
      const f = await tx.get("forge_repository", { id: res.id });
      const t = await tx.get("tenant", { id: tenantId });
      const missions = (await tx.list("mission", { repositoryRef: res.id })).filter((m) => !m.removedAt).map((m) => m.id);
      return { ...r, state: f.state, repositoryId: f.repositoryId, ownerId: f.ownerId, missions, tenantWitness: t.witness };
    });
    try { checkRepositoryClaims(c, repo, { generic, mission }); } catch (e) {
      if (e instanceof Refusal) {
        if (e.code === "owner-changed") await store.tx(tenantId, (tx) => tx.update("repository", { id: repo.id }, { pendingSend: { reason: "owner-changed", claims: claimsKept(c), receivedAt: now() } }));
        await notAccepted(tenantId, c, e.code, mission, kind, requestId);
      }
      throw e;
    }
    const within = await store.tx(null, (tx) => tx.takeRate(c.repositoryId, bucket, c.runId, RUNS_PER_HOUR));
    if (!within) { await notAccepted(tenantId, c, "rate-limited", mission, kind, requestId); throw new Refusal("rate-limited", { retryAfter: rateWindow(now()).retryAfterS }); }

    // ---- the body, last
    const body = await readBody(head.length);
    if (body.length !== head.length || sha256(body) !== head.sha256) { await notAccepted(tenantId, c, "digest-mismatch", mission, kind, requestId); throw new Refusal("digest-mismatch"); }
    const digest = head.sha256;

    // ---- consent: everything is content until runward.dev/record/v1 exists (PADR-0010 point 4)
    if (!repo.consent) {
      if (repo.state === "pending") await store.tx(tenantId, (tx) => tx.update("repository", { id: repo.id }, { pendingSend: { claims: claimsKept(c), sha256: digest, commit: c.sha, receivedAt: now(), uploadId: null, bytesKept: false } }));
      await notAccepted(tenantId, c, "content-not-consented", mission, kind, requestId);
      throw new Refusal("content-not-consented", repo.state === "pending" ? { pending: true } : {});
    }

    // bytes first (addressed by content, idempotent), then the database
    await objects.putBytes(tenantId, digest, body);
    try {
      return await store.tx(tenantId, async (tx) => {
        await tx.lockTenant();
        const same = (await tx.list("upload", { runId: c.runId, runAttempt: c.runAttempt, mission, kind }))[0];
        if (same) {
          if (same.sha256 !== digest) throw new Refusal("duplicate-in-run");
          return { status: same.rank === "pending" ? 202 : same.rank === "quarantine" ? 422 : 201, body: same.claims.response, replayed: true, ...(same.rank === "pending" ? { refusal: "repository-pending" } : same.claims.response.refusal ? { refusal: same.claims.response.refusal } : {}) };
        }
        const blob = await tx.get("blob", { sha256: digest });
        if (blob) await tx.update("blob", { sha256: digest }, { refs: blob.refs + 1, erasedAt: null }); else await tx.insert("blob", { sha256: digest, refs: 1 });
        const id = store.newId();
        const base = { id, repositoryRef: repo.id, mission, kind, runId: c.runId, runNumber: c.runNumber, runAttempt: c.runAttempt, sha256: digest, size: body.length, commit: c.sha, receivedAt: now() };
        const issued = c.iat ? iso(c.iat * 1000) : null;
        const detailBase = { mission, kind, sha256: digest, runId: c.runId, runNumber: c.runNumber, runAttempt: c.runAttempt, commit: c.sha, claims: claimsKept(c) };

        if (repo.state === "pending") {
          const e = await append(tx, { who: workload(c), what: "send-pending", object: id, requestId, issued, detail: detailBase });
          const response = { entry: id, seq: e.seq, head: e.hash, pending: true };
          await tx.insert("upload", { ...base, epoch: repo.epoch, rank: "pending", seq: e.seq, claims: { ...claimsKept(c), response } });
          await tx.update("repository", { id: repo.id }, { pendingSend: { claims: claimsKept(c), sha256: digest, commit: c.sha, receivedAt: now(), uploadId: id, bytesKept: true, seq: e.seq } });
          return { status: 202, body: response, refusal: "repository-pending" };
        }

        const current = (await tx.list("upload", { mission, kind, rank: "current", repositoryRef: repo.id }))[0] ?? null;
        const place = placeUpload(current, c, repo.epoch);
        if (place.rank === "historical") {
          const e = await append(tx, { who: workload(c), what: "send-historical", object: id, requestId, issued, detail: { ...detailBase, epoch: place.epoch, currentRunNumber: current.runNumber } });
          const idx = await latestIndex(tx);
          const response = { entry: id, seq: e.seq, head: e.hash, indexSha256: idx?.sha256 ?? null, current: false };
          await tx.insert("upload", { ...base, epoch: place.epoch, rank: "historical", seq: e.seq, claims: { ...claimsKept(c), response } });
          return { status: 201, body: response };
        }

        const built = await assemble(tx, { mission, repositoryRef: repo.id, kind, sha256: digest, commit: c.sha }, body);
        if (!built.ok) {
          const code = built.refusal === "index-build-refused" && /private filesystem path/.test(built.field) ? "private-path" : built.refusal;
          const e = await append(tx, { who: workload(c), what: "send-quarantined", object: id, requestId, issued, detail: { ...detailBase, refusal: code, field: built.field } });
          const response = { entry: id, seq: e.seq, head: e.hash, refusal: code, field: built.field };
          await tx.insert("upload", { ...base, epoch: place.epoch, rank: "quarantine", seq: e.seq, claims: { ...claimsKept(c), response } });
          return { status: 422, body: response, refusal: code };
        }
        const hd = await tx.ledgerHead();
        const seq = (hd?.seq ?? 0) + 1;
        const pub = await publish(tx, built, seq);
        if (current) await tx.update("upload", { id: current.id }, { rank: "superseded" });
        const e = await append(tx, { who: workload(c), what: "send-accepted", object: id, requestId, issued, detail: { ...detailBase, epoch: place.epoch, epochOpened: place.epochOpened, indexSha256: built.sha256, manifestSha256: built.manifestSha256, indexVersion: pub.version, fleetVersion: ctx.ports.assembler.pin.version, fleetArchiveSha256: ctx.ports.assembler.pin.archiveSha256 } });
        const response = { entry: id, seq: e.seq, head: e.hash, indexSha256: built.sha256, current: true };
        await tx.insert("upload", { ...base, epoch: place.epoch, rank: "current", seq: e.seq, claims: { ...claimsKept(c), response } });
        return { status: 201, body: response };
      });
    } catch (e) {
      if (e instanceof StoreConflict) throw new Refusal("duplicate-in-run");
      if (e instanceof Refusal && e.code === "duplicate-in-run") await notAccepted(tenantId, c, "duplicate-in-run", mission, kind, requestId);
      throw e;
    }
  }

  return { upload, verifyToken };
}
