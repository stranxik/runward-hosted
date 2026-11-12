// The journal's filters (ADR-0037 point 2), as pure rules: what a member may ask of GET /api/v0/journal beside its
// cursor (an application, a kind of entry, a period), how the query is read, and which entries a filter keeps. A
// filter only selects among the tenant's own entries: it never changes an entry, the head, or the chain, and the
// answer without a filter stays the one it always was (src/application/reading.js#journal).
import { Refusal } from "./refusals/index.js";

/**
 * The kinds of entry a member filters by, each the journal's `what` it gathers. Every `what` the service writes
 * belongs to exactly one kind (test/unit/journal-filter.test.js holds it against the lexicon's list of acts).
 */
export const JOURNAL_KINDS = Object.freeze({
  "sends-accepted": ["send-accepted", "send-historical", "send-pending"],
  "sends-refused": ["send-not-accepted", "send-quarantined"],
  declarations: ["repository-declared", "repository-changed", "repository-removed", "repository-restored", "repository-expired", "consent-given", "consent-withdrawn", "content-erased", "protection-lifted", "protection-restored", "order-epoch-opened"],
  confirmations: ["repository-confirmed"],
  "sign-ins": ["signed-in", "signed-out", "session-closed", "sessions-closed-others", "member-founded", "member-recovered"],
  account: ["passkey-added", "passkey-removed", "passkey-restored", "passkey-single-chosen", "recovery-opened", "recovery-cancelled", "access-reset", "bootstrap-opened", "export-prepared", "settings-changed", "reader-authorized", "reader-withdrawn", "reader-read", "restore-replayed", "issuer-registered", "issuer-key-added", "issuer-key-confirmed", "issuer-key-retired", "issuer-removed"],
});
/** The periods, in days back from the service's clock. */
export const JOURNAL_DAYS = Object.freeze([1, 7, 30, 90, 365]);
const MISSION = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DAY = 86_400_000;

/**
 * The filter a query asks, or null when it asks none: `mission` (an application, by its mission id), `kind` (one of
 * JOURNAL_KINDS), `days` (one of JOURNAL_DAYS). A value that is present and not one of these is refused
 * (`journal-filter-invalid`), never ignored: a link that names a filter the service does not know says so.
 */
export function readJournalFilter(params) {
  const get = (k) => { const v = params?.get?.(k); return v === null || v === undefined || v === "" ? null : String(v); };
  const mission = get("mission"), kind = get("kind"), days = get("days");
  if (mission !== null && !MISSION.test(mission)) throw new Refusal("journal-filter-invalid");
  if (kind !== null && !Object.hasOwn(JOURNAL_KINDS, kind)) throw new Refusal("journal-filter-invalid");
  if (days !== null && !JOURNAL_DAYS.includes(Number(days))) throw new Refusal("journal-filter-invalid");
  if (mission === null && kind === null && days === null) return null;
  return { mission, kind, days: days === null ? null : Number(days) };
}

/**
 * Whether an entry is kept by a filter. `app`, when the filter names a mission: its repository's id, its name and
 * its missions (the declared repository the application belongs to, removed missions included). An entry belongs to
 * it when a human or the operator acted on that repository (its `object`), or when a workload sent for one of its
 * missions or from that repository (an upload not accepted names the repository in its claims). `since`: the
 * earliest received time kept, in milliseconds.
 */
export function entryMatches(entry, filter, { app = null, since = null } = {}) {
  const b = entry?.body ?? {}, d = b.detail ?? {};
  if (filter.kind && !JOURNAL_KINDS[filter.kind].includes(b.what)) return false;
  if (since !== null) { const at = Date.parse(b.dates?.received?.at ?? ""); if (!(at >= since)) return false; }
  if (filter.mission) {
    if (!app) return false;
    const mine = b.object === app.id
      || (b.who?.type === "workload" && (app.missions.includes(d.mission) || String(d.claims?.repository ?? "").toLowerCase() === app.name.toLowerCase()));
    if (!mine) return false;
  }
  return true;
}

/** The earliest received time a period keeps, from the service's clock. */
export const sinceOf = (filter, nowMs) => (filter?.days ? nowMs - filter.days * DAY : null);
