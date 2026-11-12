// First arrival. Kept plain on purpose: its layout is being redesigned by the author (2026-11-06); its
// routes, data and states are complete.
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { loadingView, mk, act, go, head } from "./marks.js";
import { mots, titreFlotte, appareil } from "./lexique.js";
import { snippet } from "./workflow.js";
import { declareForm } from "./declarer.js";

export function viewArrivee(sub) {
  const W = mots(), A = W.arrivee, C = W.common;
  const s = S.session, a = S.access;
  if (!a) return loadingView(A.title);
  const live = a.passkeys.filter((p) => !p.removedAt);
  const open = s.arrivalOpen;
  const pinned = a.repositories.filter((r) => r.state === "pinned");
  // every repository declared and not removed: confirmed, or waiting for its first check (the count of the head said
  // « 2 dépôts déclarés » for an account of 3, one of them waiting: seen in production on 2026-11-12)
  const declares = a.repositories.filter((r) => r.state !== "removed").length;
  const tenant = esc(titreFlotte(s.tenant.title));
  const pkLine = (p) => `${mk("full", [appareil(p.provider ?? p.device) ?? "passkey", p.phone ? C.phoneQr : p.synced === false ? C.boundHere : p.synced ? C.synced : null].filter(Boolean).join(" · "))} <span class="soft">${A.registered}</span>`;
  const msg = sub === "seconde-annulee" ? `<p class="erreur" role="alert">${mk("void", C.nothingAdded)} ${A.cancelled}</p>`
    : sub === "seconde-existe" ? `<p class="erreur" role="alert">${mk("inv", C.alreadyThere)} ${A.exists}</p>` : "";
  const WAYS = `<div class="actions">${act("addpk", A.addKey, { k: "key" })}${act("addpk", A.otherManager, { q: true, k: "device" })}${act("addpk", C.onQr, { q: true, k: "phone" })}</div>
      <p class="note">${A.waysNote}</p>`;
  let step1;
  if (sub === "seule") step1 = `<div class="confirm" role="group" aria-label="${esc(A.single)}"><p>${A.singleAsk}</p>
      <p class="small soft">${C.askedForGesture}</p><div class="actions">${act("single", A.single)}${go("#/arrivee", A.backWays, { q: true })}</div></div>`;
  else if (live.length >= 2) {
    // "two providers" is said only when both providers are known and differ; the AAGUID is declared, often absent
    const known = live.map((p) => p.provider);
    const distinct = known.every(Boolean) && new Set(known).size === known.length;
    step1 = `<p>${live.map(pkLine).join("<br>")}</p>${s.sameProvider ? `<p class="avert">${A.sameKeychain}</p>` : distinct ? `<p class="note">${A.twoProviders}</p>` : `<p class="note">${A.twoUnknown}</p>`}`;
  }
  else if (s.single) step1 = `<p>${live.map(pkLine).join("")} <span class="soft">${A.singleChosen}</span></p>${WAYS}`;
  else step1 = `<p>${live.map(pkLine).join("")}</p>${msg}${WAYS}<p class="small"><button class="lien-btn" type="button" data-go="#/arrivee/seule">${esc(A.noSecond)}</button></p>
      <p class="note">${pinned.length ? A.opensFleet : A.opensSteps}${A.comeBack}</p>`;
  const ferme = `<p class="note ferme-note">${A.closed}</p>`;
  if (pinned.length) {
    return { title: A.welcome, key: "arrivee", signed: "in", html: `${head(A.headBack(tenant), A.countBack(live.length, declares))}
      <h1 class="v">${A.h1Back}</h1><p class="face lede">${A.ledeBack}</p>
      <ol class="steps"><li><div class="body"><h3>${A.stepSecond}</h3>${step1}</div></li>
        <li class="${open ? "" : "ferme"}"><div class="body"><h3>${A.stepOpen}</h3>${open ? `<div class="actions">${go("#/", C.openFleet)}</div>` : ferme}</div></li></ol>` };
  }
  const declared = a.repositories.filter((r) => r.state === "pending")[0];
  const step2 = !open ? ferme : declared
    ? `<p>${declared.pendingSend ? `${mk("half", C.firstReceived)} <span class="soft">${C.toConfirm(when(declared.pendingSend.receivedAt, { sec: false }))}</span>` : mk("half", C.waitingFirst)} <span data-verbatim translate="no">${esc(declared.name)}</span>${A.declared(declared.missions.length, declared.missions.map((m) => `<code>${esc(m.id)}</code>`).join(", "), `<code>${esc(declared.workflow)}</code>`, declared.consent)}</p>
       <p class="note">${A.expires(when(declared.expiresAt, { sec: false }))}</p>`
    : declareForm();
  const step4 = !open ? ferme : declared?.pendingSend
    ? `<p>${mk("half", A.toConfirm)} ${A.arrived(`<span data-verbatim translate="no">${esc(declared.name)}</span>`)}</p><div class="actions">${go(`#/declarer/confirmer/${declared.id}`, A.confirmFirst)}</div>`
    : `<p class="note">${A.appears}</p><div class="actions">${act("reload-screen", A.checkArrival, { q: true })}</div>`;
  return { title: A.title, key: "arrivee", signed: "in", html: `${head(A.head(tenant), A.count(live.length, declares))}
    <h1 class="v">${A.h1}</h1>
    <p class="face lede">${A.lede}</p>
    <ol class="steps">
      <li><div class="body"><h3>${A.stepSecond}</h3>${step1}</div></li>
      <li class="${open ? "" : "ferme"}"><div class="body"><h3>${A.stepDeclare}</h3>${step2}</div></li>
      <li class="${open ? "" : "ferme"}"><div class="body"><h3>${A.stepCall}</h3>${open ? snippet(declared) : ferme}</div></li>
      <li class="${open ? "" : "ferme"}"><div class="body"><h3>${A.stepMerge}</h3>${step4}</div></li>
    </ol>` };
}
