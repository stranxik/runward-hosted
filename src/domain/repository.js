// Declared repositories, missions, consent and retention as pure rules (architecture §3.4, PADR-0017,
// PADR-0011 relation repository / workflow / mission).
import { Refusal } from "./refusals/index.js";
import { DAY } from "./identity.js";

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

/** Validate a declaration: { name: "owner/repo", workflow, missions: [{ id, path }], consent }. */
export function readDeclaration(input) {
  const name = String(input?.name ?? "").trim();
  if (!OWNER_REPO.test(name) || name.endsWith("/.") || name.endsWith("/..")) throw new Refusal("repository-malformed");
  const workflow = String(input?.workflow ?? ".github/workflows/runward.yml").trim();
  if (!WORKFLOW.test(workflow)) throw new Refusal("workflow-malformed");
  const raw = Array.isArray(input?.missions) && input.missions.length ? input.missions : [{ id: name.split("/")[1].toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 63) || "mission", path: "." }];
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
  return { name, nameKey: name.toLowerCase(), workflow, missions, consent: input?.consent === true, defaultBranch: readBranch(input?.defaultBranch) };
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

/** The two identifiers a confirmation pins, read from the kept upload's claims (never its bytes, PADR-0017 point 8). */
export function confirmation(r) {
  if (!r?.pendingSend) throw new Refusal("nothing-to-confirm");
  const { repositoryId, repositoryOwnerId } = r.pendingSend.claims;
  return { repositoryId, ownerId: repositoryOwnerId };
}

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
