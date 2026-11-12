// « Brancher une application » as five gestures (ADR-0037 point 1): where a declared repository stands among them,
// read from what the service says of it, never from what the member said. The five: (1) declare it, (2) add the step to
// its chain, (3) deliver, the first check awaited, (4) confirm the first check, (5) read the first verdict.
//
// The only thing the member says is « C'est fait, j'ai fusionné » (step 2 to 3): a marker of this screen, kept in this
// browser, that moves the screen from the extract to the waiting state. It is never sent to the service, it proves
// nothing, and the service never reads it: what is pinned and what is published still waits for the first upload and the
// member's confirmation by passkey (web/views/gestures.js#confirmRepository). An upload that arrives moves the screen on
// by itself, marker or not. Pure: it imports nothing.

/** The marker « c'est fait », per repository id, kept per viewer (a convenience: without it, step 2 shows again). */
const KEY = "rw-flux-fusionne";
function lu() {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
export const fusionne = (id) => lu().includes(id);
export function marquerFusionne(id, on = true) {
  const v = lu().filter((x) => x !== id);
  if (on) v.push(id);
  try { localStorage.setItem(KEY, JSON.stringify(v.slice(-50))); } catch { /* a per-viewer convenience only */ }
}

/** The status lines of a repository's missions (GET /api/v0/fleet/status), by its id, else by its name. */
export const lignesDe = (repo, lines) => (Array.isArray(lines) ? lines.filter((l) => (l.repositoryRef ? l.repositoryRef === repo?.id : String(l.repository).toLowerCase() === String(repo?.name).toLowerCase())) : []);

/**
 * Where a repository stands: `step` (1 to 5), `variant` (null; `refused`, an upload arrived and was not accepted;
 * `expired`, the declaration expired with nothing received; `removed`, the member removed it; `owner`, the repository
 * arrives under another owner; `definition`, a GitLab definition to confirm again), `refusal` (the last one's code, its
 * date and its entry, from the status line), `mission` (its first mission, the application the verdict opens).
 * `merged`: the marker « c'est fait » (step 3 instead of 2 when nothing arrived yet).
 */
export function etape(repo, lines = [], { merged = false } = {}) {
  if (!repo) return { step: 1, variant: null, refusal: null, mission: null };
  const mission = repo.missions?.[0]?.id ?? null;
  const mine = lignesDe(repo, lines);
  const refused = mine.filter((l) => l.lastRefusal && l.notAcceptedSince > 0 && !l.accepted).sort((a, b) => (b.lastRefusalSeq ?? 0) - (a.lastRefusalSeq ?? 0))[0];
  const refusal = refused ? { code: refused.lastRefusal, at: refused.lastRefusalAt ?? null, seq: refused.lastRefusalSeq ?? null } : null;
  const base = { mission, refusal };
  if (repo.state === "removed") {
    // a declaration the daily pass removed: 7 days with nothing received (src/application/operator.js#retention)
    const expired = Boolean(repo.expiresAt && repo.removedAt && Date.parse(repo.removedAt) >= Date.parse(repo.expiresAt) && !repo.pendingSend);
    return { ...base, step: 3, variant: expired ? "expired" : "removed" };
  }
  if (repo.pendingSend?.reason === "owner-changed") return { ...base, step: 4, variant: "owner" };
  if (repo.pendingSend?.reason === "definition-not-pinned") return { ...base, step: 4, variant: "definition" };
  if (repo.state === "pending" && repo.pendingSend) return { ...base, step: 4, variant: null };
  if (repo.state === "pending") return { ...base, step: refusal || merged ? 3 : 2, variant: refusal ? "refused" : null };
  return { ...base, step: 5, variant: null, refusal: null };
}

/** The address of a repository's place in the flow, as the app has always written it. */
export function adresse(repo, e) {
  const key = encodeURIComponent(repo.id);
  return e.step === 4 || e.step === 5 ? `#/declarer/confirmer/${key}` : `#/declarer/attente/${key}`;
}

/**
 * The repositories the flow's list shows: those in progress (declared, not yet confirmed, or expired within the days
 * the service still lists them), then those connected in the last 7 days. Removed by the member: not listed.
 */
export function enCours(repositories = [], lines = [], nowMs = Date.now()) {
  const rows = (repositories ?? []).map((r) => ({ repo: r, e: etape(r, lines, { merged: fusionne(r.id) }) }));
  const progress = rows.filter(({ e }) => e.step < 5 && e.variant !== "removed");
  const recent = rows.filter(({ repo, e }) => e.step === 5 && repo.confirmedAt && nowMs - Date.parse(repo.confirmedAt) < 7 * 86_400_000);
  const at = (r) => Date.parse(r.repo.declaredAt ?? "") || 0;
  return { progress: progress.sort((a, b) => at(b) - at(a)), recent: recent.sort((a, b) => (Date.parse(b.repo.confirmedAt) || 0) - (Date.parse(a.repo.confirmedAt) || 0)) };
}

/** The fingerprint of what the flow shows: the live re-read paints again only when it changed. */
export const empreinte = (access, status) => JSON.stringify([(access?.repositories ?? []).map((r) => [r.id, r.state, Boolean(r.pendingSend), r.pendingSend?.receivedAt ?? null, r.pending?.digest ?? null, r.confirmedAt]), status?.head?.seq ?? null, status?.index?.sha256 ?? null]);
