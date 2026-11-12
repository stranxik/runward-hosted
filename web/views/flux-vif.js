// The connect flow updates by itself (ADR-0037 point 1): while a screen of « Brancher une application » or the arrival
// is open and the tab is visible, the status is read again every 30 s, as the portfolio does (web/views/piste/vif.js):
// one read (GET /api/v0/fleet/status). When its head changed, the flow's reads are made again (the access view, the
// index and the status: web/views/api.js#loadFlux) and the screen is painted again; a repository whose first upload
// arrived moves from its waiting screen to its confirmation (#/declarer/attente/<id> to #/declarer/confirmer/<id>), and
// the arrival is announced. The router reads them again at each entry too (web/views/router.js, `fresh`), so a tab left
// open since the declaration never shows what it read at its load.
//
// A member busy on the screen is not repainted under their hands: typing in the form, a confirmation box open, a
// passkey being asked. The next read after that does it.
import { S, main, parts } from "./base.js";
import { api, loadFlux, loadAccess } from "./api.js";
import { mots } from "./lexique.js";
import { depotDe, decode } from "./liens.js";
import { empreinte } from "./flux.js";

export const PERIOD = 30_000;
let lecture = false;

/** Is a screen of the flow open? The flow itself, or the arrival (which carries its first steps). */
export const ouvert = () => { const r = parts().route; return r === "declarer" || r === "arrivee"; };
/** Busy: typing in a field of the screen, a confirmation box open, a gesture under way. */
const occupe = () => {
  const a = typeof document !== "undefined" ? document.activeElement : null;
  return Boolean(S.confirming || S.busy || (a && main?.contains?.(a) && a.matches?.("input, textarea, select")));
};
function annonce(msg) { const el = typeof document !== "undefined" ? document.getElementById("annonce") : null; if (!el) return; el.textContent = ""; setTimeout(() => { el.textContent = msg; }, 60); }

/**
 * Where the screen goes after a read: the confirmation of the repository its waiting screen names, once its first
 * upload arrived; else the same address. Pure on its arguments (a test runs it).
 */
export function suite(hash, access) {
  const m = /^#\/declarer\/attente\/([^/?]+)$/.exec(String(hash ?? ""));
  if (!m) return null;
  const key = decode(m[1]);
  const repo = key ? depotDe(access?.repositories, key) : null;
  return repo && repo.state === "pending" && repo.pendingSend ? `#/declarer/confirmer/${encodeURIComponent(repo.id)}` : null;
}

/** One live read: the status, then the flow's reads when it moved. Returns what it did (a test reads it). */
export async function verifier({ force = false } = {}) {
  if (lecture || !S.session || !ouvert() || (typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") || (typeof navigator !== "undefined" && navigator.onLine === false)) return "skipped";
  lecture = true;
  try {
    const r = await api("GET", "/api/v0/fleet/status");
    if (!r.ok || !r.data) return "unread";
    if (!force && S.status && r.data.head?.seq === S.status.head?.seq && r.data.index?.sha256 === S.status.index?.sha256) return "same";
    const before = empreinte(S.access, S.status);
    if (parts().route === "arrivee") { S.status = r.data; await loadAccess(); } else await loadFlux();
    if (empreinte(S.access, S.status) === before) return "same";
    const next = suite(location.hash, S.access);
    if (next) {
      const repo = S.access.repositories.find((x) => `#/declarer/confirmer/${encodeURIComponent(x.id)}` === next);
      annonce(mots().parcours.flux.arrived(repo?.missions?.[0]?.id ?? repo?.name ?? ""));
      location.replace(next);
      return "moved";
    }
    if (occupe()) return "busy";
    const { rerender } = await import("./router.js");
    rerender();
    return "painted";
  } finally { lecture = false; }
}

// ------------------------------------------------------------- started in a browser only (never in a test's bare module)
// (the same guard as web/views/piste/vif.js: a page has a MutationObserver, a test's stubbed document has none, and an
// interval started there would keep the test's process alive)
if (typeof window !== "undefined" && typeof window.MutationObserver === "function" && typeof document?.addEventListener === "function" && typeof matchMedia === "function") {
  window.setInterval(() => { verifier(); }, PERIOD);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verifier(); });
}
