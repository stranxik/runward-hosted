// Declare, confirm, modify a repository.
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { mk, reqNote, loadingView, head, go, act } from "./marks.js";
import { mots } from "./lexique.js";
import { confirmBox } from "./confirm.js";
import { snippet } from "./workflow.js";
import { claimsTable } from "./claims.js";
import { depotDe, decode, retour, retourMot, versDepot, versSection } from "./liens.js";

/** Back where the member came from, else to `home`, said by where it leads. */
const back = (home, label = null) => { const to = retour(home); return go(to, label ?? retourMot(to), { q: true }); };

export function declareForm() {
  const D = mots().declarer;
  const err = S.formError;
  const e = (field) => (err && err.field === field ? ` aria-invalid="true" aria-describedby="e-${field}"` : "");
  const em = (field) => (err && err.field === field ? `<span class="err" id="e-${field}">${esc(err.message)} ${esc(err.action)}</span>` : "");
  const top = err && !err.field ? `<p class="erreur" role="alert" id="e-top">${mk("inv", D.notDeclared)} ${esc(err.message)} <span class="soft">${esc(err.action)}</span>${reqNote(err)}</p>` : "";
  const v = S.formValues ?? { repo: "", wf: ".github/workflows/runward.yml", mission: "", path: ".", branch: "main" };
  return `<form id="declare" novalidate>${top}
      <label class="f"><span class="k">${D.repo}</span><input class="in" name="repo" value="${esc(v.repo)}" placeholder="stranxik/dropyour" autocomplete="off" spellcheck="false" translate="no"${e("repo")}>${em("repo")}</label>
      <label class="f"><span class="k">${D.workflow}</span><input class="in" name="wf" value="${esc(v.wf)}" autocomplete="off" spellcheck="false" translate="no"${e("wf")}>${em("wf")}</label>
      <div class="mis"><label class="f"><span class="k">${D.mission}</span><input class="in" name="mission" value="${esc(v.mission)}" placeholder="dropyour" autocomplete="off" spellcheck="false" translate="no"${e("mission")}>${em("mission")}</label>
        <label class="f"><span class="k">${D.path}</span><input class="in" name="path" value="${esc(v.path)}" autocomplete="off" spellcheck="false" translate="no"></label></div>
      <label class="f"><span class="k">${D.branch}</span><input class="in" name="branch" value="${esc(v.branch ?? "main")}" autocomplete="off" spellcheck="false" translate="no"${e("branch")}>${em("branch")}</label>
      <p class="small soft">${D.branchNote}</p>
      <label class="check"><input type="checkbox" name="content"><span>${D.consent}</span></label>
      <div class="actions"><button class="btn" type="submit">${D.submit}</button></div>
      <p class="note">${D.formNote}</p>
    </form>`;
}
export const FIELD_OF = { "repository-malformed": "repo", "workflow-malformed": "wf", "mission-malformed": "mission", "mission-exists": "mission", "branch-malformed": "branch" };

export function viewDeclarer(sub) {
  const W = mots(), D = W.declarer, C = W.common;
  const a = S.access;
  if (!a) return loadingView(D.loading);
  // a repository is named by its id, or by its name where only the name is known (web/views/liens.js)
  const [what, key, ...rest] = sub.split("/");
  const id = key === undefined ? undefined : decode(key);
  if (rest.length || id === null) return null;
  const repo = id ? depotDe(a.repositories, id) : null;
  const name = repo ? esc(repo.name) : "";
  if (what === "attente" && repo) return { title: D.pending.title, key: "declarer", signed: "in", focus: "h1", html: `${head(D.head, C.waitingFirst)}
    <h1 class="v" tabindex="-1">${D.pending.h1(name)}</h1>
    <p class="face lede">${mk("half", C.waitingFirst)} ${D.pending.lede}</p>
    <p class="small">${D.pending.expires(when(repo.expiresAt, { sec: false }))}</p>
    ${snippet(repo)}<div class="actions">${back(versDepot(repo.id))}</div>` };
  if (what === "confirmer" && repo) {
    if (!repo.pendingSend || repo.pendingSend.reason === "owner-changed" && repo.state !== "pinned") {
      const N = D.nothing;
      return { title: N.title, key: "declarer", signed: "in", html: `${head(N.head, "")}<h1 class="v">${N.h1}</h1><p class="face">${repo.state === "pinned" ? `${mk("full", N.pinned)} ${N.confirmedOn(name, when(repo.confirmedAt, { sec: false }))}` : `${mk("half", C.waitingFirst)} ${N.none(name)}`}</p><div class="actions">${go(versDepot(repo.id), W.common.back.depot)}</div>` };
    }
    const K = D.confirm;
    const owner = repo.pendingSend.reason === "owner-changed";
    const c = repo.pendingSend.claims;
    return { title: owner ? K.titleOwner : K.title, key: "declarer", signed: "in", html: `${head(D.nothing.head, C.gestureCheck)}
      <h1 class="v">${owner ? K.h1Owner(name) : K.h1(name)}</h1>
      <p class="face lede">${owner ? `${mk("inv", "owner-changed")} ${K.owner(esc(c.repositoryId), esc(c.repositoryOwnerId), esc(repo.ownerId))}` : K.check}</p>
      ${claimsTable(c)}
      ${S.failed === `confirm:${repo.id}` ? `<p class="erreur" role="alert">${mk("inv", C.notVerified)} ${C.verifyFailed}</p>` : ""}
      <div class="actions">${act("gesture", owner ? K.confirmOwner : K.confirmRepo, { k: `confirm:${repo.id}` })}${act("ask", K.notMine, { q: true, k: `repo:${repo.id}` })}</div>
      ${confirmBox(`repo:${repo.id}`)}
      <p class="note">${K.note}</p>` };
  }
  if (what === "modifier" && repo) {
    const M = D.modify;
    const ms = repo.missions;
    return { title: M.title, key: "declarer", signed: "in", html: `${head(M.head, M.headR)}<h1 class="v">${M.h1(name)}</h1>
      <form id="modify" data-id="${esc(repo.id)}" novalidate>${S.formError ? `<p class="erreur" role="alert">${mk("inv", M.notSaved)} ${esc(S.formError.message)} <span class="soft">${esc(S.formError.action)}</span></p>` : ""}
      <label class="f"><span class="k">${M.workflow}</span><input class="in" name="wf" value="${esc(repo.workflow)}" autocomplete="off" spellcheck="false" translate="no"></label>
      <label class="f"><span class="k">${D.branch}</span><input class="in" name="branch" value="${esc(repo.defaultBranch ?? "main")}" autocomplete="off" spellcheck="false" translate="no"></label>
      <p class="small soft">${M.series}</p>
      ${ms.map((m) => `<p class="small"><code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span> · <label><input type="checkbox" name="remove" value="${esc(m.id)}"> ${M.removeMission}</label></p>`).join("")}
      <div class="mis"><label class="f"><span class="k">${M.addMission}</span><input class="in" name="mission" autocomplete="off" spellcheck="false" translate="no"></label><label class="f"><span class="k">${D.path}</span><input class="in" name="path" value="." autocomplete="off" spellcheck="false" translate="no"></label></div>
      <p class="note">${M.pathNote}</p>
      <div class="actions"><button class="btn" type="submit">${M.save}</button>${back(versDepot(repo.id), C.cancel)}</div></form>` };
  }
  if (id && !repo) return null;
  return { title: S.formError ? D.refused : C.declare, key: "declarer", signed: "in", focus: S.formError ? (S.formError.field ? `#e-${S.formError.field}` : "#e-top") : null, html: `${head(D.head, D.count(a.repositories.filter((r) => r.state !== "removed").length))}
    <h1 class="v">${D.h1}</h1>
    <p class="face lede">${D.lede}</p>${declareForm()}<div class="actions">${back(versSection("depots"), C.cancel)}</div>` };
}
