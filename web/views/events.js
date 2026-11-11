// What the page listens to: one click handler for every button of the shell (data-go opens an address,
// data-do names a gesture), and the two forms.
import { S, main, parts, colonneEl } from "./base.js";
import { api, loadSession } from "./api.js";
import { say, menu } from "./shell.js";
import { FIELD_OF } from "./declarer.js";
import { setLang, mots } from "./lexique.js";
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
  if (what === "logout") { await api("POST", "/api/v0/auth/logout", {}); S.session = null; S.index = null; forgetReads(); location.hash = "#/entree/sortie"; say(mots().done.signedOut); return; }
  if (what === "reload") { location.reload(); return; }
  // the reader's language, kept per viewer: the screen and its frame are painted again from what they already read
  if (what === "lecture-lang") { setLang(k); S.focusKey = `lecture-lang:${k}`; return rerender(); }
  if (what === "reload-screen") { S.error = null; S.session = undefined; forgetReads(); location.hash = location.hash.startsWith("#/panne") ? "#/" : location.hash; return show(); }
  if (what === "copy") {
    // the extract of a workflow (with its line end, a status beside the button) or the command of « Vérifier par
    // vous-même » (as written: a pasted line end would run it; its status is announced)
    const W = mots(), pre = document.getElementById(b.dataset.copyTarget), out = document.getElementById("copie-etat");
    const plain = b.hasAttribute("data-copy-plain"), label = b.dataset.label ?? W.workflow.copy;
    try { await navigator.clipboard.writeText(plain ? pre.textContent : pre.textContent + "\n"); b.textContent = W.done.copied; if (out) out.textContent = W.done.inClipboard; else say(W.done.commandCopied); }
    catch { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); if (out) out.textContent = W.done.selected; else say(W.done.commandSelected); }
    setTimeout(() => { if (b.isConnected) b.textContent = label; }, 2400);
    return;
  }
  // the phone menu: its button, its veil; a link inside it closes it with the screen it opens (the shell's paint)
  if (what === "menu") { menu(); return; }
  if (what === "menu-close") { menu(false); return; }
  if (what === "ask") { S.confirming = k; S.busy = null; S.failed = null; S.focusKey = k; return rerender(); }
  if (what === "cancel") { const was = S.confirming; S.confirming = null; S.failed = null; S.focusKey = was; return rerender(); }
  if (what === "confirm") return confirmGesture(k);
  if (what === "single") {
    const r = await write("POST", "/api/v0/passkeys/single", {}, { gesture: "passkey-single", object: "" });
    if (r.ok) say(mots().done.single);
    await refreshScreen(); location.hash = "#/arrivee"; return;
  }
  if (what === "gesture" && k.startsWith("confirm:")) {
    const id = k.slice(8);
    const r = await write("POST", `/api/v0/repositories/${id}/confirm`, {}, { gesture: "repository-confirm", object: id });
    if (!r.ok) { S.failed = k; return rerender(); }
    say(r.data?.quarantine ? mots().done.confirmedQuarantine : mots().done.confirmed);
    await loadSession(); forgetReads(); location.hash = S.session.arrivalDone ? "#/" : "#/arrivee"; return;
  }
  if (what === "export") {
    S.export = { busy: true }; rerender();
    const r = await write("POST", "/api/v0/export", {}, { gesture: "export", object: "" });
    S.export = r.ok ? { ready: r.data } : { error: r.r ?? r.verify?.r ?? r };
    return rerender();
  }
});

// the keyboard: Escape closes the phone menu
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && colonneEl.classList.contains("menu-ouvert")) { menu(false); document.getElementById("menub")?.focus(); }
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
    if (!r.ok) { const x = r.data ? r : r.verify?.r ?? { message: mots().common.verifyFailed, action: "" }; S.formError = { field: FIELD_OF[x.refusal] ?? null, message: x.message, action: x.action, requestId: x.requestId }; return rerender(); }
    S.formError = null; S.formValues = null; say(mots().done.declared);
    const onArrival = parts().route === "arrivee";
    await refreshScreen();
    location.hash = onArrival ? "#/arrivee" : `#/declarer/attente/${r.data.id}`;
  }
  if (f.id === "modify") {
    const id = f.dataset.id;
    const remove = [...f.querySelectorAll('input[name="remove"]:checked')].map((x) => x.value);
    const body = { workflow: val("wf"), defaultBranch: val("branch") || "main", addMissions: val("mission") ? [{ id: val("mission"), path: val("path") || "." }] : [], removeMissions: remove, knowingSendsStay: remove.length > 0 };
    const r = await write("PATCH", `/api/v0/repositories/${id}`, body);
    if (!r.ok) { const x = r.data ? r : { message: mots().common.verifyFailed, action: "" }; S.formError = { message: x.message, action: x.action }; return rerender(); }
    S.formError = null; say(mots().done.modified); await refreshScreen(); location.hash = "#/acces";
  }
});
