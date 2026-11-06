// The workload identity of an upload (PADR-0010 and its note of 2026-11-06), as pure decisions.
//
// The OIDC adapter checks the signature, the issuer, the audience and the times, and hands over the
// claims. What is decided here: which claims an upload must carry, against which pins, in which order
// (headers and token, then the repository, then the body: T18), and which upload is the current one
// (PADR-0011 note 1 bis).
import { Refusal } from "./refusals.js";

export const SEND_WORKFLOW_PATH = ".github/workflows/send.yml";
export const PRODUCT_REPOSITORY = "stranxik/runward-hosted";
export const SEND_WORKFLOW_REF_PREFIX = `${PRODUCT_REPOSITORY}/${SEND_WORKFLOW_PATH}@`;
export const READ_WORKFLOW_PATH = ".github/workflows/temoin.yml";
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;
export const RUNS_PER_HOUR = 30;
/** The kinds runward-fleet reads (its EXPORT_KINDS) that an upload may carry. Release v0.1 sends check only. */
export const UPLOAD_KINDS = ["check", "attestation", "verify", "witness", "summary", "history"];

const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "g");
/** A claim is untrusted data: bounded, control characters removed (T20). Escaping is the view's job. */
export function cleanClaim(v, max = 200) {
  if (v === undefined || v === null) return null;
  return String(v).replace(CONTROL, "").slice(0, max);
}

const DIGITS = /^[0-9]{1,20}$/;
/**
 * The claims the service keeps, cleaned. Returns null when a claim every upload needs is absent or
 * malformed, which the caller answers `token-unreadable`.
 */
export function readClaims(raw) {
  const c = {
    repository: cleanClaim(raw.repository),
    repositoryId: cleanClaim(raw.repository_id, 20),
    repositoryOwnerId: cleanClaim(raw.repository_owner_id, 20),
    workflowRef: cleanClaim(raw.workflow_ref, 400),
    jobWorkflowRef: cleanClaim(raw.job_workflow_ref, 400),
    jobWorkflowSha: cleanClaim(raw.job_workflow_sha, 64),
    ref: cleanClaim(raw.ref),
    refType: cleanClaim(raw.ref_type, 20),
    sha: cleanClaim(raw.sha, 64),
    eventName: cleanClaim(raw.event_name, 40),
    runnerEnvironment: cleanClaim(raw.runner_environment, 40),
    runId: cleanClaim(raw.run_id, 20),
    runNumber: cleanClaim(raw.run_number, 20),
    runAttempt: cleanClaim(raw.run_attempt, 20),
    jti: cleanClaim(raw.jti, 200),
    iat: typeof raw.iat === "number" ? raw.iat : null,
    exp: typeof raw.exp === "number" ? raw.exp : null,
  };
  if (!c.repository || !c.repositoryId || !DIGITS.test(c.repositoryId) || !c.jti) return null;
  for (const k of ["runId", "runNumber", "runAttempt"]) if (!c[k] || !DIGITS.test(c[k])) return null;
  if (c.repositoryOwnerId && !DIGITS.test(c.repositoryOwnerId)) return null;
  if (c.sha && !/^[0-9a-f]{40}$/.test(c.sha)) return null;
  return c;
}

/**
 * The checks that need no repository: event, ref, runner, and the called workflow (point 2, 7 bis).
 * `sendWorkflow` is { published: [sha], revoked: [{ sha, upgradeTo }] }. `allowMainOf` names the
 * repository whose main SHAs of send.yml are accepted for the witness tenant only (PADR-0015 note).
 */
export function checkGenericClaims(c, { sendWorkflow }) {
  if (c.eventName !== "push") throw new Refusal("event-not-push");
  if (c.ref !== "refs/heads/main" || c.refType !== "branch") throw new Refusal("ref-not-main");
  if (c.runnerEnvironment !== "github-hosted") throw new Refusal("runner-not-hosted");
  if (!c.jobWorkflowRef || !c.jobWorkflowRef.startsWith(SEND_WORKFLOW_REF_PREFIX) || !c.jobWorkflowSha) throw new Refusal("called-workflow-not-pinned");
  const revoked = (sendWorkflow.revoked ?? []).find((r) => r.sha === c.jobWorkflowSha);
  if (revoked) throw new Refusal("called-workflow-revoked", { upgradeTo: revoked.upgradeTo ?? null });
  const published = (sendWorkflow.published ?? []).includes(c.jobWorkflowSha);
  // The product's own main, for the witness tenant only: decided after the repository is resolved.
  const fromProductMain = c.repository === PRODUCT_REPOSITORY && c.jobWorkflowRef === `${SEND_WORKFLOW_REF_PREFIX}refs/heads/main`;
  if (!published && !fromProductMain) throw new Refusal("called-workflow-not-pinned");
  return { published, fromProductMain };
}

/**
 * The checks against a resolved repository: { tenantWitness, state, repositoryId, ownerId, name,
 * workflow, missions: [id], consent }. Returns { pending: boolean }.
 */
export function checkRepositoryClaims(c, repo, { generic, mission }) {
  if (!generic.published && !(generic.fromProductMain && repo.tenantWitness)) throw new Refusal("called-workflow-not-pinned");
  if (c.workflowRef !== `${c.repository}/${repo.workflow}@refs/heads/main`) throw new Refusal("workflow-not-pinned");
  if (repo.state === "pinned" && repo.ownerId && c.repositoryOwnerId !== repo.ownerId) throw new Refusal("owner-changed");
  if (!repo.missions.includes(mission)) throw new Refusal("mission-not-declared");
  return { pending: repo.state === "pending" };
}

/** Header checks that come before the body is read (point 3; 2 MB announced by Content-Length). */
export function checkUploadHeaders({ kind, mission, contentLength, contentDigest }) {
  if (!UPLOAD_KINDS.includes(kind)) throw new Refusal("kind-unknown");
  if (typeof mission !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(mission)) throw new Refusal("mission-not-declared");
  const n = Number(contentLength);
  if (!Number.isSafeInteger(n) || n < 0) throw new Refusal("body-invalid");
  if (n > MAX_EXPORT_BYTES) throw new Refusal("too-large");
  const m = /^sha-256=:([A-Za-z0-9+/]{43}=):$/.exec(String(contentDigest ?? "").trim());
  if (!m) throw new Refusal("digest-mismatch");
  return { length: n, sha256: Buffer.from(m[1], "base64").toString("hex") };
}

// ------------------------------------------------------------------ order of uploads (B3, T23)
const big = (s) => BigInt(s);

/**
 * Where an incoming upload stands against the current one of its (mission, kind):
 * `current` (it becomes the current), `historical` (kept, never current), and the epoch it belongs to.
 * Order key: epoch, then run_number, then run_attempt. A run_number that goes back while run_id goes
 * forward opens a new epoch on its own (complement: the workflow was recreated) and says so.
 */
export function placeUpload(current, incoming, repoEpoch = 0) {
  let epoch = Math.max(repoEpoch, current?.epoch ?? 0);
  let opened = false;
  if (current && epoch === current.epoch && big(incoming.runId) > big(current.runId) && big(incoming.runNumber) < big(current.runNumber)) {
    epoch += 1;
    opened = true;
  }
  if (!current || epoch > current.epoch) return { rank: "current", epoch, epochOpened: opened };
  const a = [big(incoming.runNumber), big(incoming.runAttempt)];
  const b = [big(current.runNumber), big(current.runAttempt)];
  const newer = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  return { rank: newer ? "current" : "historical", epoch, epochOpened: false };
}

/** The hour bucket of the rate counter, and whether one more run fits (T17). */
export function rateWindow(nowMs) {
  const hour = Math.floor(nowMs / 3_600_000);
  return { bucket: hour, retryAfterS: Math.max(1, Math.ceil(((hour + 1) * 3_600_000 - nowMs) / 1000)) };
}
