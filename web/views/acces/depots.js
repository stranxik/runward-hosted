// Access, sections: the declared repositories, their consent and their content, on the forge each lives on; and the
// GitLab instances this fleet registered, with their keys (ADR-0029 section 4). The sub-screen that registers an
// instance, or adds a key to one, is here too (#/acces/instance, #/acces/instance/<id>).
import { S, esc } from "../base.js";
import { when } from "../time.js";
import { mk, go, act, head, reqNote, loadingView } from "../marks.js";
import { mots } from "../lexique.js";
import { ask, confirmBox } from "../confirm.js";
import { niveau } from "../claims.js";

/** A value to copy as it is written (an audience): the value, and its button. */
const copied = (id, value, label) => `<code translate="no" id="${esc(id)}">${esc(value)}</code> <button class="lien-btn" type="button" data-do="copy" data-copy-target="${esc(id)}" data-copy-plain data-copy-audience data-label="${esc(label)}">${esc(label)}</button>`;

/** What a GitLab repository adds to its line: its issuer, the audience its pipeline writes, the protection requirement. */
function gitlabLines(r) {
  const G = mots().forge.depots;
  const issuer = r.issuer?.issuer ? `<span translate="no">${esc(r.issuer.issuer)}</span>` : `<span class="soft">${esc(G.instanceGone)}</span>`;
  // the protected-branch requirement is gitlab.com's: lifting it lowers the level to P3b, said before the gesture
  const protection = r.issuer?.kind !== "public" ? ""
    : r.protectionRequired ? `<br>${mk("full", G.protectionRequired)} · ${ask(`liftprot:${r.id}`, G.lift, false)}` : `<br>${mk("half", G.protectionLifted)} · ${ask(`restoreprot:${r.id}`, G.restore, false)}`;
  return { issuer: `<span class="k">${esc(G.issuer)}</span>${issuer}`, audience: r.audience ? `<span class="k">${esc(G.audience)}</span>${copied(`aud-r-${r.id}`, r.audience, G.copyAudience)}` : "", protection };
}

/** The declared repositories. */
export function sectionDepots(a) {
  const W = mots(), D = W.acces.depots, C = W.common, F = W.forge;
  const rp = a.repositories.map((r) => {
    const removed = r.state === "removed", gitlab = r.forge === "gitlab";
    const g = gitlab && !removed ? gitlabLines(r) : { issuer: "", audience: "", protection: "" };
    const missions = r.missions.map((m) => `<code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span>`).join(", ");
    const consentBtn = removed ? "" : r.consent ? ask(`consent:${r.id}`, D.withdraw, false) : ask(`consentir:${r.id}`, D.consent, false);
    const again = r.pendingSend?.reason === "owner-changed" ? `${mk("inv", "owner-changed")} · <a href="#/declarer/confirmer/${esc(r.id)}">${D.confirmOwner}</a><br>`
      : r.pendingSend?.reason === "definition-not-pinned" ? `${mk("inv", "definition-not-pinned")} · <a href="#/declarer/confirmer/${esc(r.id)}">${esc(F.depots.confirmDefinition)}</a><br>` : "";
    const state = removed ? "" : r.state === "pending" ? `${mk("half", C.waitingFirst)}${r.pendingSend ? ` · <a href="#/declarer/confirmer/${esc(r.id)}">${D.confirmFirst}</a>` : ""}<br>` : again;
    // the declared file or branch changed: every upload is refused until a new confirmation, said with its remedy
    const unpinned = !removed && gitlab && r.definitionPinned === false ? `<p class="avert" data-unpinned>${mk("inv", F.depots.unpinnedMark)} ${esc(F.depots.unpinned)}</p>` : "";
    const level = !removed && r.level ? `<details class="prov"><summary>${esc(F.level.summary)}</summary>${niveau(r.level)}</details>` : "";
    return `<div class="arow"><div><div class="nm" data-verbatim translate="no">${esc(r.name)}</div><span class="k">${D.missions}</span>${missions}${r.repositoryId ? `<span class="k">${D.pinnedId}</span><code>${esc(r.repositoryId)}</code>` : ""}${g.issuer}</div>
      <div class="small">${state}<span class="k">${gitlab ? esc(F.definition) : D.workflow}</span><code>${esc(r.workflow)}</code>${D.on}<code>${gitlab ? esc(r.defaultBranch) : "main"}</code>${g.audience}<br>${removed ? "" : r.consent ? mk("full", C.consented) : mk("void", D.notConsented)}${g.protection}<br>${consentBtn}${removed ? "" : ` · ${ask(`purge:${r.id}`, D.erase, false)} · <button class="lien-btn" type="button" data-go="#/declarer/modifier/${esc(r.id)}">${D.modify}</button>`}</div>
      ${removed ? `<div>${mk("void", D.removed)} ${ask(`restorerepo:${r.id}`, C.restore)}<div class="small soft">${C.until(when(r.restorableUntil, { sec: false }))}</div></div>` : `<div>${ask(`repo:${r.id}`, C.remove)}</div>`}
      ${unpinned}${level}
      ${confirmBox(`repo:${r.id}`)}${confirmBox(`restorerepo:${r.id}`)}${confirmBox(`consent:${r.id}`)}${confirmBox(`consentir:${r.id}`)}${confirmBox(`purge:${r.id}`)}${confirmBox(`liftprot:${r.id}`)}${confirmBox(`restoreprot:${r.id}`)}</div>`;
  }).join("") || `<p class="small soft">${D.none}</p>`;
  return `<section class="blk"><h2>${D.h2}</h2>${rp}<div class="actions" style="margin-top:12px">${go("#/declarer", C.declare, { q: true })}</div></section>`;
}

/**
 * The registered GitLab instances: the issuer as its tokens write it, the audience its pipelines write, each key
 * with its thumbprint, its state and its expiry. A registration with no live key receives nothing, and says so.
 */
export function sectionInstances(a) {
  const W = mots(), I = W.forge.instances;
  const list = a.issuers ?? [], max = a.limits?.issuers ?? 5;
  const rows = list.map((i) => {
    const keys = i.keys.map((k) => {
      const kk = `keyretire:${i.id}.${k.id}`;
      const dates = k.state === "retired" ? I.retiredOn(when(k.retiredAt, { sec: false })) : `${I.addedOn(when(k.addedAt, { sec: false }))} · ${I.expiresOn(when(k.expiresAt, { sec: false }))}`;
      return `<div class="cle" data-key-state="${esc(k.state)}"><div><span class="k">kid</span><code translate="no">${esc(k.kid)}</code><span class="k">${esc(I.thumbprint)}</span><code translate="no">${esc(k.thumbprint)}</code></div>
        <div class="small">${mk(k.state === "live" ? "full" : "void", Object.hasOwn(I.state, k.state) ? I.state[k.state] : k.state)} · ${dates}${k.state === "retired" ? "" : ` · ${ask(kk, I.retire, false)}`}</div>
        ${k.expiresSoon && k.state === "live" ? `<p class="avert">${esc(I.expiresSoon)}</p>` : ""}${confirmBox(kk)}</div>`;
    }).join("");
    return `<div class="arow"><div><div class="nm" data-verbatim translate="no">${esc(i.issuer)}</div><span class="k">${I.registeredOn(when(i.addedAt, { sec: false }))}</span></div>
      <div class="small"><span class="k">${esc(I.audience)}</span>${copied(`aud-i-${i.id}`, i.audience, I.copy)}${i.receiving ? "" : `<br>${mk("inv", I.receivesNothing)} ${esc(I.receivesNothingText)}`}</div>
      <div><button class="btn btn-q" type="button" data-go="#/acces/instance/${esc(i.id)}">${esc(I.addKey)}</button> ${ask(`issuerremove:${i.id}`, I.remove)}</div>
      <div class="cles">${keys}</div>${confirmBox(`issuerremove:${i.id}`)}</div>`;
  }).join("") || `<p class="small soft">${esc(I.none)}</p>`;
  const more = list.length < max ? `<div class="actions" style="margin-top:12px">${go("#/acces/instance", I.register, { q: true })}</div>` : `<p class="small soft">${I.limit(esc(max))}</p>`;
  return `<section class="blk"><h2>${esc(I.h2)}</h2><p class="small soft">${esc(I.lede)}</p>${rows}${more}</section>`;
}

/**
 * Register an instance (`id` empty), or add a key to one: the issuer exactly as the tokens' iss reads, the instance's
 * key set, pasted (the service never calls the instance), and the kid of a CI token's header. The service's answer is
 * shown before the gesture, which is bound to it: the issuer, the kid, the key's RFC 7638 thumbprint.
 */
export function viewInstance(id) {
  const W = mots(), I = W.forge.instance, C = W.common, L = W.forge.level;
  const a = S.access;
  if (!a) return loadingView(I.title);
  const reg = id ? (a.issuers ?? []).find((i) => i.id === id) ?? null : null;
  if (id && !reg) return null;
  const f = S.issuer && S.issuer.id === id ? S.issuer : { id, values: { issuer: "", keys: "", kid: "" }, preview: null, error: null };
  const err = f.error, v = f.values, p = f.preview;
  const why = err?.why ? `<div class="small soft"><span class="k">${esc(I.why)}</span><code lang="en">${esc(err.why)}</code></div>` : "";
  const e = (field) => (err && err.field === field ? ` aria-invalid="true" aria-describedby="e-${field}"` : "");
  const em = (field) => (err && err.field === field ? `<span class="err" id="e-${field}">${esc(err.message)} ${esc(err.action)}${why}</span>` : "");
  const top = err && !err.field ? `<p class="erreur" role="alert" id="e-top">${mk("inv", id ? I.notRead : I.notRegistered)} ${esc(err.message)} <span class="soft">${esc(err.action)}</span>${reqNote(err)}</p>${why}` : "";
  const name = reg ? `<span translate="no">${esc(reg.issuer)}</span>` : "";
  const body = p
    ? `<section class="pins" aria-labelledby="h-vu"><h2 id="h-vu">${esc(I.shown)}</h2><p class="small soft">${esc(I.shownText)}</p>
        <dl class="cl2"><dt>${esc(I.issuerShown)}</dt><dd><code translate="no">${esc(p.issuer ?? reg?.issuer ?? "")}</code></dd><dt>${esc(I.kidShown)}</dt><dd><code translate="no">${esc(p.kid)}</code></dd>
          <dt>${esc(W.forge.instances.thumbprint)}</dt><dd><code translate="no" data-thumbprint>${esc(p.thumbprint)}</code></dd><dt>${esc(I.key)}</dt><dd>${I.bits(esc(p.bits))}</dd></dl></section>
      ${top}
      <div class="actions">${act("gesture", id ? I.addAct : I.registerAct, { k: "issuer" })}${act("issuer-edit", I.edit, { q: true })}</div>
      <p class="note">${esc(C.askedForGesture)}</p>`
    : `<form id="issuer" data-id="${esc(id)}" novalidate>${top}
      ${id ? "" : `<label class="f"><span class="k">${esc(I.issuer)}</span><input class="in" name="issuer" value="${esc(v.issuer)}" placeholder="https://gitlab.example.org" autocomplete="off" spellcheck="false" translate="no"${e("issuer")}>${em("issuer")}</label>
      <p class="small soft">${esc(I.issuerNote)}</p>`}
      <label class="f"><span class="k">${esc(I.keys)}</span><textarea class="in" name="keys" rows="8" autocomplete="off" spellcheck="false" translate="no"${e("keys")}>${esc(v.keys)}</textarea>${em("keys")}</label>
      <p class="small soft">${I.keysNote}</p>
      <label class="f"><span class="k">${esc(I.kid)}</span><input class="in" name="kid" value="${esc(v.kid)}" autocomplete="off" spellcheck="false" translate="no"></label>
      <p class="small soft">${esc(I.kidNote)}</p>
      <div class="actions"><button class="btn" type="submit">${esc(I.preview)}</button>${go("#/acces", C.cancel, { q: true })}</div>
      <p class="note">${I.after}</p></form>`;
  return { title: id ? I.titleKey : I.title, key: "acces", signed: "in", focus: err ? (err.field ? `#e-${err.field}` : "#e-top") : null, html: `${head(I.head, C.gestureCheck)}
    <h1 class="v">${id ? I.h1Key(name) : esc(I.h1)}</h1>
    <p class="face lede">${esc(id ? I.ledeKey : I.lede)}</p>
    <div class="niveau-d"><p class="small soft">${L.lead}</p>${niveau("P4")}</div>
    ${body}` };
}
