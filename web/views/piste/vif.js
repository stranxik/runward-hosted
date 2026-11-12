// « La piste » (ADR-0035): what moves on the portfolio and on an application's reading, and nothing else.
//   - The line draws itself on arrival (a transition of its width, or its height on a phone), once per address; under
//     reduced motion it is drawn at once. Every drawing ends: the classes that hold it are taken off after 2.6 s
//     whatever happens to the transition, and the line stays drawn (the rule « toute animation se termine »).
//   - A station of the large rail opens its panel without painting the screen again.
//   - The live update: while the portfolio or a reading is open and the tab is visible, the status is read again
//     every 30 s (one read, GET /api/v0/fleet/status; the budget of architecture §6 holds at the opening, and the
//     read allowance is 120 a minute per address, src/http/limits.js). When its head or its index changed, the index
//     and the status are read again (two reads), the screen is painted again, the row or the timeline entry of a new
//     check comes in calmly, and what moved is computed between the check this page showed and the new one
//     (donnees.js#moved): the service serves no earlier check, so nothing older is compared. A member busy on the
//     screen (the focus on one of its controls) is not repainted under their hands: a line says a check arrived, with
//     a button that shows it (since ADR-0036: typing in a field or answering a confirmation; a repaint keeps the panes'
//     scroll, folds and focus). The arrival is announced to assistive technologies either way.
import { S, main, parts } from "../base.js";
import { api, loadFleet } from "../api.js";
import { moved } from "./donnees.js";
import { piste } from "./mots.js";
import { shortName } from "./portefeuille.js";

export const PERIOD = 30_000;
const FAILSAFE = 2600;

/** The state of « la piste » kept for the page: what moved per application, the open station, the first verdict, the open folds. */
export function etat() {
  S.piste = { moved: {}, neuf: {}, sel: null, premier: null, open: [], attend: false, ...(S.piste ?? {}) };
  return S.piste;
}
const reduit = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const later = (f) => window.requestAnimationFrame(() => window.requestAnimationFrame(f));

/** The rails draw themselves: their solid part grows from nothing to how far it goes, then the classes come off. */
function trace(rails) {
  if (reduit()) return;
  [...rails].forEach((p, i) => {
    p.classList.add("trace");
    p.querySelectorAll(".pi-rempli, .pi-rempli-v").forEach((f) => { f.style.transitionDelay = `${Math.min(i, 6) * 70}ms`; });
    later(() => p.classList.add("go"));
    setTimeout(() => p.classList.remove("trace", "go"), FAILSAFE + Math.min(i, 6) * 70);
  });
}
/** What came in with a live read glows for a moment, then rests; the class comes off whatever happens. */
function arrive(els) {
  for (const el of els) {
    if (!reduit()) later(() => el.classList.add("pose"));
    setTimeout(() => el.classList.remove("neuf", "pose"), FAILSAFE);
  }
}

// ------------------------------------------------------------- after each paint of the screen
let peinte = null;
function apresPeinture() {
  if (!main.querySelector?.(".pi-piste, [data-volets]")) { peinte = location.hash; return; }
  const E = etat();
  const h = location.hash, arrivee = h !== peinte;
  peinte = h;
  // the folds the member had open stay open across a live repaint
  for (const k of E.open) main.querySelector(`details[data-pli="${CSS.escape(k)}"]`)?.setAttribute("open", "");
  E.open = [];
  trace(arrivee ? main.querySelectorAll(".pi-piste") : main.querySelectorAll(".neuf .pi-piste"));
  arrive(main.querySelectorAll(".neuf"));
  E.neuf = {};
}

// ------------------------------------------------------------- a station of the large rail
function station(n) {
  // the application shown: the one its address names, or on a desk the one shown by default (decision.js sets it)
  const E = etat(), id = E.montre ?? decodeURIComponent(parts().sub || "");
  E.sel = E.sel && E.sel.id === id && E.sel.n === n ? null : { id, n };
  const cur = E.sel ? E.sel.n : 0;
  main.querySelectorAll("#pi-grand [data-pi-station]").forEach((b) => {
    const on = Number(b.dataset.piStation) === cur;
    b.setAttribute("aria-pressed", String(on));
    b.closest(".pi-st")?.classList.toggle("sel", on);
  });
  main.querySelectorAll(".pi-pans > .pi-pan").forEach((p) => { p.hidden = p.id !== `pi-pan-${cur}`; });
  // the required documents of the station kept are marked in their table
  main.querySelectorAll(".pieces > .pc").forEach((li) => li.classList.toggle("sel", Number(li.dataset.pc) === cur));
  const shown = main.querySelector(`#pi-pan-${cur}`);
  if (shown && !reduit()) { shown.classList.add("pose"); setTimeout(() => shown.classList.remove("pose"), 400); }
}

// ------------------------------------------------------------- the live update
let lecture = false;
const ouvert = () => { const r = parts().route; return r === "" || r === "decision"; };
// since the panes (ADR-0036) a repaint keeps each pane's scroll, the open folds and the focus on the row or button it
// was on (web/views/volets.js): only a member typing in a field, or answering a confirmation, is left undisturbed
const occupe = () => { const a = document.activeElement; return Boolean(S.confirming) || Boolean(a && main.contains(a) && a.matches("input, textarea, select")); };
function annonce(msg) { const el = document.getElementById("annonce"); if (!el) return; el.textContent = ""; setTimeout(() => { el.textContent = msg; }, 60); }
async function peindre() {
  const E = etat();
  E.open = [...main.querySelectorAll("details[data-pli][open]")].map((d) => d.dataset.pli);
  document.getElementById("pi-vif")?.remove();
  E.attend = false;
  const { rerender } = await import("../router.js");
  rerender();
}
/** The line that says a check arrived while the member was busy on the screen, with its button; built without HTML. */
function signaler() {
  if (document.getElementById("pi-vif")) return;
  const V = piste().vif;
  const box = document.createElement("div");
  box.id = "pi-vif"; box.className = "bandeau pi-vif"; box.setAttribute("role", "status");
  const p = document.createElement("p"); p.textContent = V.waiting;
  const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-q"; b.dataset.piVif = "1"; b.textContent = V.show;
  const a = document.createElement("div"); a.className = "actions"; a.append(b);
  box.append(p, a);
  // in the window of the panes, the line stands in its bar; elsewhere, first on the screen
  const bar = main.querySelector(".win-bar");
  if (bar) bar.append(box); else main.prepend(box);
}
export async function verifier() {
  const E = etat();
  if (lecture || !S.session || !S.status || !ouvert() || document.visibilityState !== "visible" || navigator.onLine === false) return;
  lecture = true;
  try {
    const r = await api("GET", "/api/v0/fleet/status");
    if (!r.ok || !r.data) return;
    const was = S.status;
    if (r.data.head?.seq === was.head?.seq && r.data.index?.sha256 === was.index?.sha256) return;
    const before = S.index, lines = was.lines;
    await loadFleet();
    if (!S.status) { S.status = was; S.index = before; return; }
    const names = [];
    for (const m of S.index?.missions ?? []) {
      const old = before?.missions?.find((x) => x.id === m.id);
      const line = S.status.lines.find((l) => l.mission === m.id), oldLine = lines.find((l) => l.mission === m.id);
      if (line?.accepted?.seq === oldLine?.accepted?.seq && old) continue;
      E.neuf[m.id] = true;
      const d = old ? moved(old, m) : null;
      if (d) E.moved[m.id] = d;
      names.push(shortName(m));
    }
    for (const n of names) annonce(piste().vif.arrived(n));
    if (occupe()) { E.attend = true; signaler(); return; }
    await peindre();
  } finally { lecture = false; }
}

// ------------------------------------------------------------- started in a browser only (never in a test's bare module)
if (typeof window.MutationObserver === "function" && typeof matchMedia === "function" && main && typeof main.addEventListener === "function") {
  new window.MutationObserver(() => apresPeinture()).observe(main, { childList: true });
  main.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-pi-station]");
    if (b) { e.preventDefault(); station(Number(b.dataset.piStation)); return; }
    if (e.target.closest?.("[data-pi-vif]")) peindre();
  });
  window.setInterval(() => { verifier(); }, PERIOD);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verifier(); });
}
