// Declared repositories, missions, consent and retention as pure rules (architecture §3.4, PADR-0017,
// PADR-0011 relation repository / workflow / mission).
import { Refusal } from "./refusals/index.js";
import { DAY } from "./identity.js";
import { FORGES, REGISTRATION_ID } from "./forge.js";
import { PROJECT_PATH, DEFINITION_FILE, DEFAULT_DEFINITION, definitionMatches, pinValues } from "./gitlab.js";

export const PENDING_LIFE = 7 * DAY;
export const REMOVED_KEEP = 30 * DAY;
export const ARCHIVE_LIFE = DAY;
export const ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;
export const ARCHIVE_CHUNK_TRIGGER = 256 * 1024 * 1024;

const OWNER_REPO = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})$/;
const WORKFLOW = /^\.github\/workflows\/[A-Za-z0-9_.-]{1,100}\.ya?ml$/;
export const MISSION_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A branch name as git accepts it, conservatively: no "..", no "//", no leading or trailing "/" or ".", no ".lock". */
export function readBranch(v) {
  const b = String(v ?? "main").trim() || "main";
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(b) || b.includes("..") || b.includes("//") || /^[/.]|[/.]$/.test(b) || b.endsWith(".lock") || b.split("/").some((x) => x.startsWith("."))) throw new Refusal("branch-malformed");
  return b;
}

/** The declared pipeline definition of a GitLab repository: a path in the repository (ADR-0029 section 3 rule 3). */
export function readDefinitionFile(v) {
  const file = String(v ?? DEFAULT_DEFINITION).trim() || DEFAULT_DEFINITION;
  if (file.length > 200 || !DEFINITION_FILE.test(file)) throw new Refusal("workflow-malformed", { forge: "gitlab" });
  return file;
}

/**
 * Validate a declaration: { forge, issuer, name, workflow, missions: [{ id, path }], consent }.
 * GitHub (the default): `name` reads owner/repo, `workflow` is the calling workflow. GitLab: `name` is the
 * project's full path, of two segments or more; `workflow` is the pipeline definition, `.gitlab-ci.yml` by
 * default; `issuer` is "gitlab.com" or the identifier of an instance this tenant registered.
 */
export function readDeclaration(input) {
  const forge = input?.forge === undefined ? "github" : input.forge;
  if (!FORGES.includes(forge)) throw new Refusal("body-invalid");
  const name = String(input?.name ?? "").trim();
  let workflow, issuer = null;
  if (forge === "gitlab") {
    if (!PROJECT_PATH.test(name) || name.split("/").some((x) => x === "." || x === "..")) throw new Refusal("repository-malformed", { forge });
    workflow = readDefinitionFile(input?.workflow);
    issuer = String(input?.issuer ?? "gitlab.com");
    if (issuer !== "gitlab.com" && !REGISTRATION_ID.test(issuer)) throw new Refusal("issuer-unknown");
  } else {
    if (!OWNER_REPO.test(name) || name.endsWith("/.") || name.endsWith("/..")) throw new Refusal("repository-malformed");
    workflow = String(input?.workflow ?? ".github/workflows/runward.yml").trim();
    if (!WORKFLOW.test(workflow)) throw new Refusal("workflow-malformed");
  }
  const raw = Array.isArray(input?.missions) && input.missions.length ? input.missions : [{ id: name.split("/").pop().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 63) || "mission", path: "." }];
  const ids = new Set();
  const missions = raw.map((m) => {
    const id = String(m?.id ?? "").trim();
    if (!MISSION_ID.test(id)) throw new Refusal("mission-malformed");
    if (ids.has(id)) throw new Refusal("mission-exists");
    ids.add(id);
    const path = String(m?.path ?? ".").trim() || ".";
    if (path.startsWith("/") || path.split("/").includes("..") || path.length > 200) throw new Refusal("mission-malformed");
    return { id, path };
  });
  return { forge, issuer, name, nameKey: name.toLowerCase(), workflow, missions, consent: input?.consent === true, defaultBranch: readBranch(input?.defaultBranch) };
}

/** The repository's state for a reader: pending (and its expiry), pinned, removed (and its restore window). */
export function repositoryState(r, nowMs) {
  if (r.removedAt) return nowMs - r.removedAt < REMOVED_KEEP ? "removed" : "gone";
  if (r.state === "pending") return nowMs - r.declaredAt >= PENDING_LIFE && !r.pendingSend ? "expired" : "pending";
  return "pinned";
}

export function checkRestoreRepository(r, nowMs) {
  if (!r || !r.removedAt) throw new Refusal("not-found");
  if (nowMs - r.removedAt >= REMOVED_KEEP) throw new Refusal("restore-window-closed");
}

/**
 * What a confirmation pins, read from the kept upload's claims (never its bytes, PADR-0017 point 8), with
 * the values its screen shows and its gesture is bound to (`values`, ADR-0029 section 1). GitHub: the two
 * identifiers. GitLab (`f`: the repository's forge row): the issuer key, the project, its namespace, its
 * path and the pipeline definition, which must name the declared file on the declared branch of that
 * project; `confirmable` is false otherwise, and the values are shown, not pinned.
 */
export function confirmation(r, f = null) {
  if (!r?.pendingSend) throw new Refusal("nothing-to-confirm");
  const c = r.pendingSend.claims;
  const { repositoryId, repositoryOwnerId } = c;
  if (f?.forgeName === "gitlab") {
    const confirmable = definitionMatches(c.definitionRef, { projectPath: c.repository, file: r.workflow, branch: r.defaultBranch });
    return { forge: "gitlab", repositoryId, ownerId: repositoryOwnerId, path: c.repository, definitionRef: c.definitionRef ?? null, confirmable, values: pinValues(c, f.issuerKey) };
  }
  return { repositoryId, ownerId: repositoryOwnerId };
}
/** The values GitHub's confirmation shows and binds: the two identifiers it pins. */
export const githubPinValues = (pin) => ({ forge: "github", repositoryId: pin.repositoryId ?? null, ownerId: pin.ownerId ?? null });

/** Bytes of a removed repository are erased 30 days after removal; an archive lives 24 h. */
export const bytesExpired = (r, nowMs) => Boolean(r.removedAt) && nowMs - r.removedAt >= REMOVED_KEEP;
export const archiveExpired = (a, nowMs) => nowMs - a.preparedAt >= ARCHIVE_LIFE;

/** Members (PADR-0019): roles are read from the role, never from "is the founder". */
export const ROLES = ["owner"];
export function checkMemberRemovable(members, id) {
  const live = members.filter((m) => !m.removedAt);
  const target = live.find((m) => m.id === id);
  if (!target) throw new Refusal("not-found");
  if (target.role === "owner" && live.filter((m) => m.role === "owner").length <= 1) throw new Refusal("last-owner");
  return target;
}
