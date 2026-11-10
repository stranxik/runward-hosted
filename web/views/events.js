// What the page listens to: one click handler for every button of the shell (data-go opens an address,
// data-do names a gesture), and the two forms.
import { S, mobEl, main, parts } from "./base.js";
import { api, loadSession } from "./api.js";
import { say } from "./shell.js";
import { FIELD_OF } from "./declarer.js";
import { show, forgetReads, rerender, refreshScreen } from "./router.js";
import { signIn, redeem, addPasskey, confirmGesture, write } from "./gestures.js";

document.addEventListener("click", async (e) => {
  const g = e.target.closest("[data-go]");
  if (g) { e.preventDefault(); S.formError = null; const to = g.dataset.go; if (location.hash === to) show(); else location.hash = to; return; }
  const b = e.target.closest("[data-do]");
  if (!b) return;
  const k = b.dataset.k, what = b.dataset.do;
  if (what === "signin") return signIn(k);
  if (what === "redeem") return redeem(k);
  if (what === "addpk") return addPasskey(k);
  if (what === "logout") { await api("POST", "/api/v0/auth/logout", {}); S.session = null; S.index = null; forgetReads(); location.hash = "#/entree/sortie"; say("Vous êtes déconnecté."); return; }
  if (what === "reload") { location.reload(); return; }
  if (what === "reload-screen") { S.error = null; S.session = undefined; forgetReads(); location.hash = location.hash.startsWith("#/panne") ? "#/" : location.hash; return show(); }
  if (what === "copy") {
    const pre = document.getElementById(b.dataset.copyTarget), out = document.getElementById("copie-etat");
    try { await navigator.clipboard.writeText(pre.textContent + "\n"); b.textContent = "Copié"; if (out) out.textContent = "L'extrait est dans votre presse-papiers."; }
    catch { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); if (out) out.textContent = "Extrait sélectionné : copiez-le avec ⌘C ou Ctrl+C."; }
    setTimeout(() => { b.textContent = "Copier l'extrait"; }, 2400);
    return;
  }
  if (what === "scroll") { mobEl.open = false; document.getElementById(k)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); return; }
  if (what === "ask") { S.confirming = k; S.busy = null; S.failed = null; S.focusKey = k; return rerender(); }
  if (what === "cancel") { const was = S.confirming; S.confirming = null; S.failed = null; S.focusKey = was; return rerender(); }
  if (what === "confirm") return confirmGesture(k);
  if (what === "single") {
    const r = await write("POST", "/api/v0/passkeys/single", {}, { gesture: "passkey-single", object: "" });
    if (r.ok) say("Choix écrit au journal : une seule passkey. Les étapes suivantes sont ouvertes.");
    await refreshScreen(); location.hash = "#/arrivee"; return;
  }
  if (what === "gesture" && k.startsWith("confirm:")) {
    const id = k.slice(8);
    const r = await write("POST", `/api/v0/repositories/${id}/confirm`, {}, { gesture: "repository-confirm", object: id });
    if (!r.ok) { S.failed = k; return rerender(); }
    say(r.data?.quarantine ? "Dépôt confirmé. Son premier envoi reste en quarantaine." : "Dépôt confirmé. La mission est publiée.");
    await loadSession(); forgetReads(); location.hash = S.session.arrivalDone ? "#/" : "#/arrivee"; return;
  }
  if (what === "export") {
    S.export = { busy: true }; rerender();
    const r = await write("POST", "/api/v0/export", {}, { gesture: "export", object: "" });
    S.export = r.ok ? { ready: r.data } : { error: r.r ?? r.verify?.r ?? r };
    return rerender();
  }
});

main.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const val = (n) => f.elements[n]?.value?.trim() ?? "";
  if (f.id === "declare") {
    S.formValues = { repo: val("repo"), wf: val("wf"), mission: val("mission"), path: val("path") || ".", branch: val("branch") || "main" };
    const consent = f.elements.content.checked;
    const body = { name: S.formValues.repo, workflow: S.formValues.wf, defaultBranch: S.formValues.branch, missions: S.formValues.mission ? [{ id: S.formValues.mission, path: S.formValues.path }] : [], consent };
    const r = await write("POST", "/api/v0/repositories", body, consent ? { gesture: "declare-with-consent", object: S.formValues.repo.toLowerCase() } : {});
    if (!r.ok) { const x = r.data ? r : r.verify?.r ?? { message: "La vérification n'a pas abouti. Rien n'a changé.", action: "" }; S.formError = { field: FIELD_OF[x.refusal] ?? null, message: x.message, action: x.action, requestId: x.requestId }; return rerender(); }
    S.formError = null; S.formValues = null; say("Dépôt déclaré, en attente du premier envoi.");
    const onArrival = parts().route === "arrivee";
    await refreshScreen();
    location.hash = onArrival ? "#/arrivee" : `#/declarer/attente/${r.data.id}`;
  }
  if (f.id === "modify") {
    const id = f.dataset.id;
    const remove = [...f.querySelectorAll('input[name="remove"]:checked')].map((x) => x.value);
    const body = { workflow: val("wf"), defaultBranch: val("branch") || "main", addMissions: val("mission") ? [{ id: val("mission"), path: val("path") || "." }] : [], removeMissions: remove, knowingSendsStay: remove.length > 0 };
    const r = await write("PATCH", `/api/v0/repositories/${id}`, body);
    if (!r.ok) { const x = r.data ? r : { message: "La vérification n'a pas abouti. Rien n'a changé.", action: "" }; S.formError = { message: x.message, action: x.action }; return rerender(); }
    S.formError = null; say("Dépôt modifié."); await refreshScreen(); location.hash = "#/acces";
  }
});
