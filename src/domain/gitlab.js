// GitLab's rules for an upload (ADR-0029 section 3), as pure decisions. The same for gitlab.com and for an
// instance a tenant registered: only the level differs (src/domain/forge.js#levelCode).
//
// What a real token carries was read on a self-managed GitLab CE 17.11.1 (ADR-0029, Context; the fixtures
// of test/fixtures/gitlab/): `project_id`, `namespace_id`, `pipeline_id` and `job_id` are strings of
// digits, `ref_protected` is the string "true" or "false", `ci_config_ref_uri` and `ci_config_sha` are
// absent when the pipeline definition lives in another project. Every claim is typed before it is compared
// and an absent claim refuses (section 6 point 4): nothing here reads a claim through a default.
import { Refusal } from "./refusals/index.js";
import { refuse } from "./forge.js";

const FORGE = "gitlab";
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");
const DIGITS = /^[0-9]{1,20}$/;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;
const segments = (v, min, max) => { const s = typeof v === "string" ? v.split("/") : []; return s.length >= min && s.length <= max && s.every((x) => SEGMENT.test(x)); };
/** A project's full path: two segments or more, GitLab's characters. */
export const PROJECT_PATH = { test: (v) => segments(v, 2, 20) };
/** The declared pipeline definition: letters, digits, `.`, `_`, `-` and single `/`; no `@`, no `//` (rule 3). */
export const DEFINITION_FILE = { test: (v) => segments(v, 1, 10) };
export const DEFAULT_DEFINITION = ".gitlab-ci.yml";

/** A claim as a bounded string, or null: a value of another type, too long, or with a control character is absent. */
function text(v, max) {
  if (typeof v !== "string" || !v || v.length > max || CONTROL.test(v)) return null;
  return v;
}

/**
 * The claims the service keeps. Returns null when a claim every upload needs is absent or malformed,
 * which the caller answers `token-unreadable`. `user_login` and `user_email` are never read: no e-mail
 * address is kept (ADR-0005). The two claims of the definition may be absent here: that is rule 3's refusal.
 */
export function readClaims(raw) {
  const c = {
    projectId: text(raw.project_id, 20), namespaceId: text(raw.namespace_id, 20), projectPath: text(raw.project_path, 400),
    pipelineId: text(raw.pipeline_id, 20), jobId: text(raw.job_id, 20), pipelineSource: text(raw.pipeline_source, 40),
    ref: text(raw.ref, 200), refType: text(raw.ref_type, 20), refProtected: text(raw.ref_protected, 10), sha: text(raw.sha, 64),
    definitionRef: text(raw.ci_config_ref_uri, 700), definitionSha: text(raw.ci_config_sha, 64),
    userAccessLevel: text(raw.user_access_level, 40), runnerEnvironment: text(raw.runner_environment, 40),
    runnerId: Number.isSafeInteger(raw.runner_id) && raw.runner_id >= 0 ? String(raw.runner_id) : text(raw.runner_id, 20),
    jti: text(raw.jti, 200),
    iat: Number.isSafeInteger(raw.iat) ? raw.iat : null,
    exp: Number.isSafeInteger(raw.exp) ? raw.exp : null,
  };
  for (const k of ["projectId", "namespaceId", "pipelineId", "jobId"]) if (!c[k] || !DIGITS.test(c[k])) return null;
  if (!c.projectPath || !PROJECT_PATH.test(c.projectPath)) return null;
  if (!c.jti || c.iat === null || c.exp === null) return null;
  if (!c.sha || !SHA.test(c.sha)) return null;
  if (c.runnerId !== null && !DIGITS.test(c.runnerId)) return null;
  return c;
}

/** The one identity every forge's claims are read into (ADR-0029 section 1). */
export function normalize(c, issuerKey) {
  return {
    forge: FORGE, issuerKey, repositoryId: c.projectId, ownerId: c.namespaceId, path: c.projectPath,
    ref: c.ref, refType: c.refType, refProtected: c.refProtected === "true", commit: c.sha,
    definition: { ref: c.definitionRef, sha: c.definitionSha },
    // pipeline_id then job_id are the whole order; `at` is kept for the signal only, never to order (rule 7)
    order: { major: c.pipelineId, minor: c.jobId, at: c.iat },
    replayId: c.jti, issuedAt: c.iat, expiresAt: c.exp,
    informative: { userAccessLevel: c.userAccessLevel, runnerId: c.runnerId, runnerEnvironment: c.runnerEnvironment },
  };
}

/** What the journal keeps of an upload's claims: the pins, the order, and the informative claims (rule 6). */
export function claimsKept(c) {
  return {
    repository: c.projectPath, repositoryId: c.projectId, repositoryOwnerId: c.namespaceId,
    definitionRef: c.definitionRef, definitionSha: c.definitionSha, pipelineSource: c.pipelineSource,
    ref: c.ref, refType: c.refType, refProtected: c.refProtected, sha: c.sha,
    pipelineId: c.pipelineId, jobId: c.jobId, userAccessLevel: c.userAccessLevel, runnerId: c.runnerId, runnerEnvironment: c.runnerEnvironment,
    runId: c.pipelineId, runNumber: c.pipelineId, runAttempt: c.jobId,
  };
}

/**
 * Does this definition claim name the declared file, on the declared branch, of the token's own project?
 * String suffixes only, never an address parser (section 6 point 5): the value must end with
 * `//<declared file>@refs/heads/<declared branch>`, and what precedes must end with `/<project_path>`
 * (the host, which the service does not know for a public issuer, comes before that slash).
 */
export function definitionMatches(definitionRef, { projectPath, file, branch }) {
  if (typeof definitionRef !== "string" || !DEFINITION_FILE.test(String(file ?? "")) || typeof branch !== "string" || !branch) return false;
  const tail = `//${file}@refs/heads/${branch}`;
  if (!definitionRef.endsWith(tail)) return false;
  const head = definitionRef.slice(0, -tail.length);
  return head.endsWith(`/${projectPath}`) && head.length > projectPath.length + 1;
}

/**
 * The rules against the resolved repository, in the order of ADR-0029 section 3, fail closed:
 * { state, ownerId, definitionRef (the pinned value), workflow (the declared file), defaultBranch,
 *   protectionLifted, missions }. Returns { pending }.
 */
export function check(c, repo, { mission }) {
  const pinned = repo.state === "pinned";
  // 2. the repository: project_id resolved it; namespace_id is its owner
  if (pinned && repo.ownerId && c.namespaceId !== repo.ownerId) throw refuse("owner-changed", FORGE);
  // 3. the definition
  if (!c.definitionRef || !c.definitionSha) throw refuse("definition-absent", FORGE);
  if (pinned && (!repo.definitionRef || c.definitionRef !== repo.definitionRef)) throw refuse("definition-not-pinned", FORGE);
  if (c.definitionSha !== c.sha) throw refuse("commit-mismatch", FORGE);
  // 4. the branch
  if (c.refType !== "branch" || !c.ref || c.ref !== repo.defaultBranch) throw refuse("ref-not-declared", FORGE);
  if (!repo.protectionLifted && c.refProtected !== "true") throw refuse("ref-not-protected", FORGE);
  // 5. the source
  if (c.pipelineSource !== "push") throw refuse("source-not-admitted", FORGE);
  if (!repo.missions.includes(mission)) throw new Refusal("mission-not-declared");
  return { pending: !pinned };
}

/** The values a confirmation pins and its screen shows (section 1), from the kept send's claims. */
export function pinValues(claims, issuerKey) {
  return { forge: FORGE, issuerKey, projectId: claims.repositoryId, namespaceId: claims.repositoryOwnerId, projectPath: claims.repository, definitionRef: claims.definitionRef ?? null };
}

/**
 * Where an upload stands against the current one of its (mission, kind): pipeline_id, then job_id, within
 * an epoch. The service never opens an epoch for GitLab (rule 7): `issuedLater` says that an upload ranked
 * historical was issued after the current one, which the screen shows so that a member can open one.
 */
export function placeUpload(current, incoming, repoEpoch = 0) {
  const epoch = Math.max(repoEpoch, current?.epoch ?? 0);
  if (!current || epoch > current.epoch) return { rank: "current", epoch, epochOpened: false, issuedLater: false };
  const a = [BigInt(incoming.pipelineId), BigInt(incoming.jobId)];
  const b = [BigInt(current.runNumber), BigInt(current.runAttempt)];
  const newer = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const issuedLater = !newer && Number.isSafeInteger(current.issuedAt) && incoming.iat > current.issuedAt;
  return { rank: newer ? "current" : "historical", epoch, epochOpened: false, issuedLater };
}
