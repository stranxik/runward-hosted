// POST /api/v0/exports: an upload carried by the workload identity token of its CI: GitHub's send workflow,
// or a GitLab pipeline (PADR-0010 and its note; PADR-0011 points 1, 3, 1 bis; PADR-0017 point 8; ADR-0029).
// Order (T18): headers and token, then the repository, then the body. A refusal before the repository is
// resolved writes nothing to any tenant's journal; it goes to the global counter of refused tokens.
import { Refusal } from "../domain/refusals/index.js";
import { readClaims, checkGenericClaims, checkRepositoryClaims, checkUploadHeaders, placeUpload, rateWindow, RUNS_PER_HOUR } from "../domain/workload.js";
import * as gitlab from "../domain/gitlab.js";
import { workloadId, levelOf, MAX_TOKEN_AGE_S } from "../domain/forge.js";
import { sha256, iso } from "./context.js";
import { StoreConflict, VerifierUnavailable } from "../ports/errors.js";

// The forge's rules behind one shape (ADR-0029 section 1). GitHub's are the functions of
// src/domain/workload.js, called as before the port, in the same order; GitLab's are src/domain/gitlab.js.
//   read(raw)                 the claims kept, typed, or null (token-unreadable)
//   ids(c)                    what is the same for every forge: the repository's id and path, the order, the commit
//   kept(c)                   the claims an entry of the journal keeps
//   generic(c, config)        the rules that need no repository (GitHub's only: GitLab's order puts the repository first)
//   check(c, repo, ctx)       the rules against the resolved repository; returns { pending }
//   place(current, c, epoch)  where the upload stands against the current one
const GITHUB = {
  forge: "github",
  read: readClaims,
  ids: (c) => ({ repositoryId: c.repositoryId, path: c.repository, runId: c.runId, runNumber: c.runNumber, runAttempt: c.runAttempt, commit: c.sha }),
  kept: (c) => ({
    repository: c.repository, repositoryId: c.repositoryId, repositoryOwnerId: c.repositoryOwnerId, workflowRef: c.workflowRef,
    jobWorkflowRef: c.jobWorkflowRef, jobWorkflowSha: c.jobWorkflowSha, eventName: c.eventName, ref: c.ref, sha: c.sha,
    runnerEnvironment: c.runnerEnvironment, runId: c.runId, runNumber: c.runNumber, runAttempt: c.runAttempt,
  }),
  generic: (c, config) => checkGenericClaims(c, { sendWorkflow: config.sendWorkflow }),
  check: checkRepositoryClaims,
  place: placeUpload,
};
const GITLAB = {
  forge: "gitlab",
  read: gitlab.readClaims,
  ids: (c) => ({ repositoryId: c.projectId, path: c.projectPath, runId: c.pipelineId, runNumber: c.pipelineId, runAttempt: c.jobId, commit: c.sha }),
  kept: gitlab.claimsKept,
  generic: () => null,
  check: gitlab.check,
  place: (current, c, epoch) => gitlab.placeUpload(current ? { ...current, issuedAt: current.claims?.issuedAt ?? null } : null, c, epoch),
};
const RULES = { github: GITHUB, gitlab: GITLAB };

export function ingestCases(ctx) {
  const { store, clock, append, objects, assemble, publish, latestIndex } = ctx;
  const { verifier, log } = ctx.ports;
  const now = () => clock.now();
  /** The words of a refusal are the forge's; GitHub's answers carry nothing more than before the port. */
  const words = (forge, extra = {}) => (forge && forge !== "github" ? { forge, ...extra } : extra);

  /**
   * A token whose signature held under a key since retired, or expired (ADR-0029 section 3): said in the
   * journal of the registration's tenant, which is known only because that signature held. At most
   * RUNS_PER_HOUR entries an hour for a registration's key: whoever holds a retired key writes no more
   * than that into the tenant's journal.
   */
  async function keyRetired(d, requestId) {
    // the verifier held the token to its times before it said key-retired: its iat is within ten minutes.
    // Claims that cannot be read name no workload, and a token already seen was already said: neither is
    // written. The replay id is used once, as an accepted token's is.
    const c = gitlab.readClaims(d.claims);
    if (!c) return;
    const fresh = await store.tx(null, (tx) => tx.useJti(c.jti, (Math.min(c.exp, c.iat + MAX_TOKEN_AGE_S) + 60) * 1000, d.issuer.key));
    if (!fresh) return;
    const within = await store.tx(null, (tx) => tx.takeRate(`key-retired:${d.kid}`, rateWindow(now()).bucket, requestId ?? store.newId(), RUNS_PER_HOUR, d.issuer.key));
    if (!within) return;
    await store.tx(d.issuer.tenantId, (tx) => append(tx, {
      who: { type: "workload", id: workloadId(d.forge, d.issuer.key, c.projectId) }, what: "send-not-accepted", object: null, requestId,
      issued: iso(c.iat * 1000),
      detail: { refusal: "key-retired", mission: "", kind: "", key: { kid: d.kid, thumbprint: d.thumbprint, state: d.state, since: iso(d.since) }, claims: gitlab.claimsKept(c) },
    }));
  }

  /**
   * Verify the bearer token and use its replay id once, within its issuer key. `purpose`: "send" (any
   * issuer of the registry) or "read" (the witness reader, GitHub alone, `audience` given). Returns
   * { c, rules, forge, issuer: { key, kind, tenantId? }, kid, thumbprint }.
   */
  async function verifyToken(authorization, { purpose = "send", audience = ctx.config.origin, requestId = null } = {}) {
    const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(String(authorization ?? ""));
    if (!m) throw new Refusal("token-missing");
    let v;
    try { v = await verifier.verify(m[1], { purpose, audience }); } catch (e) {
      if (e.code === "key-retired" && e.detail) { await keyRetired(e.detail, requestId); throw new Refusal("key-retired", words(e.detail.forge)); }
      if (e.code) throw new Refusal(e.code, words(e.forge, e.code === "token-audience" && e.forge ? { audience: ctx.config.origin } : {}));
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
    const rules = RULES[v.forge];
    const c = rules ? rules.read(v.claims) : null;
    if (!c) throw new Refusal("token-unreadable");
    // kept until the token can no longer be accepted: its exp, and for GitLab its tenth minute when that
    // comes first (past it the token is refused token-too-old whatever the store holds; an exp is its
    // signer's to choose, and a registered key's holder must not grow a table every tenant shares: ADR-0031 i)
    const until = v.forge === "github" ? v.claims.exp : Math.min(v.claims.exp, v.claims.iat + MAX_TOKEN_AGE_S);
    const fresh = await store.tx(null, (tx) => tx.useJti(c.jti, (until + 60) * 1000, v.issuer.key));
    if (!fresh) throw new Refusal("token-replayed", words(v.forge));
    return { c, rules, forge: v.forge, issuer: v.issuer, kid: v.kid ?? null, thumbprint: v.thumbprint ?? null };
  }

  /**
   * `headers`: authorization, runward-mission, runward-export-kind, content-length, content-digest.
   * `readBody(limit)`: reads at most `limit` bytes, or throws Refusal("too-large").
   */
  async function upload({ headers, readBody, requestId }) {
    const maint = await store.tx(null, (tx) => tx.maintenance());
    if (maint) throw new Refusal("maintenance", { retryAfter: 600 });
    const t = await verifyToken(headers.authorization, { requestId });
    const { c, rules, forge, issuer } = t;
    const u = rules.ids(c);
    const kept = rules.kept(c);
    const workload = { type: "workload", id: workloadId(forge, issuer.key, u.repositoryId) };
    const issued = c.iat ? iso(c.iat * 1000) : null;
    const mission = headers["runward-mission"];
    const kind = headers["runward-export-kind"];
    const bucket = rateWindow(now()).bucket;
    /** A refusal for a repository of this tenant is written to its own journal; it never reaches another. */
    const notAccepted = (tenantId, code) => store.tx(tenantId, (tx) => append(tx, { who: workload, what: "send-not-accepted", object: null, requestId, issued, detail: { refusal: code, mission: mission ?? "", kind: kind ?? "", runId: u.runId, runNumber: u.runNumber, runAttempt: u.runAttempt, claims: kept } }));
    let head, generic;
    try {
      head = checkUploadHeaders({ kind, mission, contentLength: headers["content-length"], contentDigest: headers["content-digest"] });
      generic = rules.generic(c, ctx.config);
    } catch (e) {
      if (e instanceof Refusal) await store.tx(null, (tx) => tx.countRefused(u.repositoryId, bucket, issuer.key));
      throw e;
    }
    // within the issuer key: a registration's repositories are its tenant's alone, and the tenant the
    // signature named is the only one this upload may reach (ADR-0029 section 6 point 6)
    const res = await store.tx(null, (tx) => tx.resolveRepository({ forge, issuerKey: issuer.key, repositoryId: u.repositoryId, nameKey: u.path.toLowerCase() }));
    if (!res || (issuer.tenantId && res.tenantId !== issuer.tenantId)) { await store.tx(null, (tx) => tx.countRefused(u.repositoryId, bucket, issuer.key)); throw new Refusal("repository-not-declared"); }
    const tenantId = res.tenantId;
    if (res.removed) { await notAccepted(tenantId, "repository-not-declared"); throw new Refusal("repository-not-declared"); }

    // ---- the repository's pins
    const repo = await store.tx(tenantId, async (tx) => {
      const r = await tx.get("repository", { id: res.id });
      const f = await tx.get("forge_repository", { id: res.id });
      const t = await tx.get("tenant", { id: tenantId });
      const missions = (await tx.list("mission", { repositoryRef: res.id })).filter((m) => !m.removedAt).map((m) => m.id);
      return { ...r, state: f.state, repositoryId: f.repositoryId, ownerId: f.ownerId, definitionRef: f.definitionRef, forgeName: f.forgeName, issuerKey: f.issuerKey, protectionLifted: Boolean(r.protectionLiftedAt), missions, tenantWitness: t.witness };
    });
    if (repo.forgeName !== forge || repo.issuerKey !== issuer.key) { log.error("ingest.issuer-mismatch", { requestId }); throw new Refusal("repository-not-declared"); }
    // GitLab: an instance restored from a backup counts its pipelines and jobs again, so the numbers of an
    // upload already received come back. The run a send is counted and kept under carries the order epoch
    // once a member opened one (`order-epoch-open`): the send of the new epoch is then another run, not a
    // `duplicate-in-run` of the old one. Epoch 0, and GitHub, keep the bare number.
    if (forge !== "github" && repo.epoch > 0) u.runId = `${u.runId}@${repo.epoch}`;
    try { rules.check(c, repo, { generic, mission }); } catch (e) {
      if (e instanceof Refusal) {
        // what a new confirmation would pin is kept for the member to read: a new owner, or a definition
        // that names the declared file and branch (a renamed or moved project, a declaration changed)
        const again = e.code === "owner-changed" || (e.code === "definition-not-pinned" && gitlab.definitionMatches(c.definitionRef, { projectPath: c.projectPath, file: repo.workflow, branch: repo.defaultBranch }));
        if (again) await store.tx(tenantId, (tx) => tx.update("repository", { id: repo.id }, { pendingSend: { reason: e.code, claims: kept, receivedAt: now() } }));
        await notAccepted(tenantId, e.code);
      }
      throw e;
    }
    // the level this upload reaches, computed from its verified token, with what it rests on (section 2)
    const level = levelOf({ forge, issuer, kid: t.kid, thumbprint: t.thumbprint, protectionRequired: !repo.protectionLifted });
    const within = await store.tx(null, (tx) => tx.takeRate(u.repositoryId, bucket, u.runId, RUNS_PER_HOUR, issuer.key));
    if (!within) { await notAccepted(tenantId, "rate-limited"); throw new Refusal("rate-limited", { retryAfter: rateWindow(now()).retryAfterS }); }

    // ---- the body, last
    const body = await readBody(head.length);
    if (body.length !== head.length || sha256(body) !== head.sha256) { await notAccepted(tenantId, "digest-mismatch"); throw new Refusal("digest-mismatch"); }
    const digest = head.sha256;

    // ---- consent: everything is content until runward.dev/record/v1 exists (PADR-0010 point 4)
    if (!repo.consent) {
      if (repo.state === "pending") await store.tx(tenantId, (tx) => tx.update("repository", { id: repo.id }, { pendingSend: { claims: kept, sha256: digest, commit: u.commit, receivedAt: now(), uploadId: null, bytesKept: false } }));
      await notAccepted(tenantId, "content-not-consented");
      throw new Refusal("content-not-consented", repo.state === "pending" ? { pending: true } : {});
    }

    // bytes first (addressed by content, idempotent), then the database
    await objects.putBytes(tenantId, digest, body);
    try {
      return await store.tx(tenantId, async (tx) => {
        await tx.lockTenant();
        const same = (await tx.list("upload", { runId: u.runId, runAttempt: u.runAttempt, mission, kind }))[0];
        if (same) {
          if (same.sha256 !== digest) throw new Refusal("duplicate-in-run");
          return { status: same.rank === "pending" ? 202 : same.rank === "quarantine" ? 422 : 201, body: same.claims.response, replayed: true, ...(same.rank === "pending" ? { refusal: "repository-pending" } : same.claims.response.refusal ? { refusal: same.claims.response.refusal } : {}) };
        }
        const blob = await tx.get("blob", { sha256: digest });
        if (blob) await tx.update("blob", { sha256: digest }, { refs: blob.refs + 1, erasedAt: null }); else await tx.insert("blob", { sha256: digest, refs: 1 });
        const id = store.newId();
        const base = { id, repositoryRef: repo.id, mission, kind, runId: u.runId, runNumber: u.runNumber, runAttempt: u.runAttempt, sha256: digest, size: body.length, commit: u.commit, receivedAt: now() };
        const detailBase = { mission, kind, sha256: digest, runId: u.runId, runNumber: u.runNumber, runAttempt: u.runAttempt, commit: u.commit, claims: kept, level };
        // what the row keeps beside the journal's claims: the level, and the token's date for GitLab's signal
        const keptRow = { ...kept, level, issuedAt: c.iat ?? null };
        // GitHub's answers are those of before the port; another forge's also name the level reached
        const said = forge === "github" ? {} : { level: level.code };

        if (repo.state === "pending") {
          const e = await append(tx, { who: workload, what: "send-pending", object: id, requestId, issued, detail: detailBase });
          const response = { entry: id, seq: e.seq, head: e.hash, pending: true, ...said };
          await tx.insert("upload", { ...base, epoch: repo.epoch, rank: "pending", seq: e.seq, claims: { ...keptRow, response } });
          await tx.update("repository", { id: repo.id }, { pendingSend: { claims: kept, sha256: digest, commit: u.commit, receivedAt: now(), uploadId: id, bytesKept: true, seq: e.seq } });
          return { status: 202, body: response, refusal: "repository-pending" };
        }

        const current = (await tx.list("upload", { mission, kind, rank: "current", repositoryRef: repo.id }))[0] ?? null;
        const place = rules.place(current, c, repo.epoch);
        if (place.rank === "historical") {
          const e = await append(tx, { who: workload, what: "send-historical", object: id, requestId, issued, detail: { ...detailBase, epoch: place.epoch, currentRunNumber: current.runNumber, ...(place.issuedLater ? { issuedLater: true, currentRunAttempt: current.runAttempt, currentIssuedAt: iso(current.claims.issuedAt * 1000) } : {}) } });
          const idx = await latestIndex(tx);
          const response = { entry: id, seq: e.seq, head: e.hash, indexSha256: idx?.sha256 ?? null, current: false, ...said };
          await tx.insert("upload", { ...base, epoch: place.epoch, rank: "historical", seq: e.seq, claims: { ...keptRow, ...(place.issuedLater ? { issuedLater: true } : {}), response } });
          return { status: 201, body: response };
        }

        const built = await assemble(tx, { mission, repositoryRef: repo.id, kind, sha256: digest, commit: u.commit, receivedAt: base.receivedAt }, body);
        if (!built.ok) {
          const code = built.refusal === "index-build-refused" && /private filesystem path/.test(built.field) ? "private-path" : built.refusal;
          const e = await append(tx, { who: workload, what: "send-quarantined", object: id, requestId, issued, detail: { ...detailBase, refusal: code, field: built.field } });
          const response = { entry: id, seq: e.seq, head: e.hash, refusal: code, field: built.field };
          await tx.insert("upload", { ...base, epoch: place.epoch, rank: "quarantine", seq: e.seq, claims: { ...keptRow, response } });
          return { status: 422, body: response, refusal: code };
        }
        const hd = await tx.ledgerHead();
        const seq = (hd?.seq ?? 0) + 1;
        const pub = await publish(tx, built, seq);
        if (current) await tx.update("upload", { id: current.id }, { rank: "superseded" });
        const e = await append(tx, { who: workload, what: "send-accepted", object: id, requestId, issued, detail: { ...detailBase, epoch: place.epoch, epochOpened: place.epochOpened, indexSha256: built.sha256, manifestSha256: built.manifestSha256, indexVersion: pub.version, fleetVersion: ctx.ports.assembler.pin.version, fleetArchiveSha256: ctx.ports.assembler.pin.archiveSha256 } });
        const response = { entry: id, seq: e.seq, head: e.hash, indexSha256: built.sha256, current: true, ...said };
        await tx.insert("upload", { ...base, epoch: place.epoch, rank: "current", seq: e.seq, claims: { ...keptRow, response } });
        return { status: 201, body: response };
      });
    } catch (e) {
      if (e instanceof StoreConflict) throw new Refusal("duplicate-in-run");
      if (e instanceof Refusal && e.code === "duplicate-in-run") await notAccepted(tenantId, "duplicate-in-run");
      throw e;
    }
  }

  return { upload, verifyToken };
}
