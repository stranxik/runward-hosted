// Declare, confirm, modify a repository, on the forge it lives on (ADR-0029): GitHub, gitlab.com, or a GitLab
// instance this fleet registered. The level of evidence the choice reaches is said before the member adds a pipeline;
// the values a confirmation pins are shown before the gesture, which is bound to them.
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { mk, reqNote, loadingView, head, go, act } from "./marks.js";
import { mots } from "./lexique.js";
import { confirmBox } from "./confirm.js";
import { snippet } from "./workflow.js";
import { claimsTable, pinsTable, niveau } from "./claims.js";

/** The file a declaration names by default, per forge: the calling workflow (GitHub), the pipeline definition (GitLab). */
export const DEFAULT_FILE = { github: ".github/workflows/runward.yml", gitlab: ".gitlab-ci.yml" };
/** The level a declaration's uploads will reach, by the forge chosen: GitHub, gitlab.com (protection required), a registered instance. */
const levelOfChoice = (choice) => (choice === "github" ? "P1" : choice === "gitlab.com" ? "P3" : "P4");
/** The level, said where a repository is declared or awaited: what its uploads will prove, and what they will not. */
const levelAtDeclaration = (code) => { const L = mots().forge.level; return `<div class="niveau-d"><p><b>${esc(L.declaration)}</b></p><p class="small soft">${L.lead}</p>${niveau(code, { state: L.willReach })}</div>`; };

export function declareForm() {
  const W = mots(), D = W.declarer, G = W.forge.declare;
  const err = S.formError;
  const e = (field) => (err && err.field === field ? ` aria-invalid="true" aria-describedby="e-${field}"` : "");
  const em = (field) => (err && err.field === field ? `<span class="err" id="e-${field}">${esc(err.message)} ${esc(err.action)}</span>` : "");
  const top = err && !err.field ? `<p class="erreur" role="alert" id="e-top">${mk("inv", D.notDeclared)} ${esc(err.message)} <span class="soft">${esc(err.action)}</span>${reqNote(err)}</p>` : "";
  const v = S.formValues ?? { forge: "github", repo: "", wf: DEFAULT_FILE.github, mission: "", path: ".", branch: "main" };
  const issuers = S.access?.issuers ?? [];
  // the forge: GitHub, gitlab.com, or one of the instances this fleet registered (by its identifier)
  const choice = v.forge === "gitlab.com" || issuers.some((i) => i.id === v.forge) ? v.forge : "github", gitlab = choice !== "github";
  const opt = (value, label) => `<label class="check"><input type="radio" name="forge" value="${esc(value)}"${value === choice ? " checked" : ""} data-focus-key="forge:${esc(value)}"><span>${label}</span></label>`;
  const forges = `<fieldset class="choix"><legend class="k">${esc(G.forge)}</legend>${opt("github", esc(G.github))}${opt("gitlab.com", esc(G.gitlabCom))}${issuers.map((i) => opt(i.id, G.instance(`<span translate="no">${esc(i.issuer)}</span>`))).join("")}${em("forge")}</fieldset>
      ${issuers.length ? "" : `<p class="small soft">${G.noInstance}</p>`}`;
  return `<form id="declare" novalidate>${top}
      ${forges}
      ${levelAtDeclaration(levelOfChoice(choice))}
      <label class="f"><span class="k">${gitlab ? esc(G.project) : D.repo}</span><input class="in" name="repo" value="${esc(v.repo)}" placeholder="${gitlab ? "group/project" : "stranxik/dropyour"}" autocomplete="off" spellcheck="false" translate="no"${e("repo")}>${em("repo")}</label>
      ${gitlab ? `<p class="small soft">${esc(G.pathLimit)}</p>` : ""}
      <label class="f"><span class="k">${gitlab ? esc(G.definitionFile) : D.workflow}</span><input class="in" name="wf" value="${esc(v.wf)}" autocomplete="off" spellcheck="false" translate="no"${e("wf")}>${em("wf")}</label>
      <div class="mis"><label class="f"><span class="k">${D.mission}</span><input class="in" name="mission" value="${esc(v.mission)}" placeholder="dropyour" autocomplete="off" spellcheck="false" translate="no"${e("mission")}>${em("mission")}</label>
        <label class="f"><span class="k">${D.path}</span><input class="in" name="path" value="${esc(v.path)}" autocomplete="off" spellcheck="false" translate="no"></label></div>
      <label class="f"><span class="k">${gitlab ? esc(G.branch) : D.branch}</span><input class="in" name="branch" value="${esc(v.branch ?? "main")}" autocomplete="off" spellcheck="false" translate="no"${e("branch")}>${em("branch")}</label>
      <p class="small soft">${gitlab ? esc(G.branchNote) : D.branchNote}</p>
      <label class="check"><input type="checkbox" name="content"><span>${D.consent}</span></label>
      <div class="actions"><button class="btn" type="submit">${D.submit}</button></div>
      <p class="note">${D.formNote}</p>
    </form>`;
}
export const FIELD_OF = { "repository-malformed": "repo", "repository-path-unsupported": "repo", "workflow-malformed": "wf", "mission-malformed": "mission", "mission-exists": "mission", "branch-malformed": "branch", "issuer-unknown": "forge" };

export function viewDeclarer(sub) {
  const W = mots(), D = W.declarer, C = W.common, G = W.forge;
  const a = S.access;
  if (!a) return loadingView(D.loading);
  const [what, id] = sub.split("/");
  const repo = id ? a.repositories.find((r) => r.id === id) : null;
  const name = repo ? esc(repo.name) : "";
  const gitlab = repo?.forge === "gitlab";
  if (what === "attente" && repo) return { title: D.pending.title, key: "declarer", signed: "in", focus: "h1", html: `${head(D.head, C.waitingFirst)}
    <h1 class="v" tabindex="-1">${D.pending.h1(name)}</h1>
    <p class="face lede">${mk("half", C.waitingFirst)} ${gitlab ? G.declare.pendingLede(esc(repo.workflow), esc(repo.defaultBranch)) : D.pending.lede}</p>
    <p class="small">${D.pending.expires(when(repo.expiresAt, { sec: false }))}</p>
    ${repo.level ? levelAtDeclaration(repo.level) : ""}
    ${snippet(repo)}<div class="actions">${go("#/acces", C.backToAccess, { q: true })}</div>` };
  if (what === "confirmer" && repo) {
    if (!repo.pendingSend || repo.pendingSend.reason === "owner-changed" && repo.state !== "pinned") {
      const N = D.nothing;
      return { title: N.title, key: "declarer", signed: "in", html: `${head(N.head, "")}<h1 class="v">${N.h1}</h1><p class="face">${repo.state === "pinned" ? `${mk("full", N.pinned)} ${N.confirmedOn(name, when(repo.confirmedAt, { sec: false }))}` : `${mk("half", C.waitingFirst)} ${N.none(name)}`}</p><div class="actions">${go("#/acces", C.seeAccess)}</div>` };
    }
    const K = D.confirm, P = G.pins, k = `confirm:${repo.id}`;
    // what is asked: a new owner, a definition that changed (GitLab), or the first upload
    const owner = repo.pendingSend.reason === "owner-changed", definition = repo.pendingSend.reason === "definition-not-pinned";
    const c = repo.pendingSend.claims, p = repo.pending ?? null;
    const lede = owner ? `${mk("inv", "owner-changed")} ${K.owner(esc(c.repositoryId), esc(c.repositoryOwnerId), esc(repo.ownerId))}`
      : definition ? `${mk("inv", "definition-not-pinned")} ${esc(P.definitionChanged)}` : gitlab ? esc(P.checkGitlab) : K.check;
    // the values the confirmation pins, shown before the gesture, which is bound to their digest; when the definition
    // is not the declared file on the declared branch, they are shown with the reason, and cannot be confirmed
    const pins = p ? `<section class="pins" aria-labelledby="h-pins"><h2 id="h-pins">${esc(P.h2)}</h2><p class="small soft">${esc(P.lead)}</p>${pinsTable(p.values, a.issuers ?? [])}
        ${p.confirmable ? "" : `<p class="avert" data-not-confirmable>${mk("inv", P.notConfirmableMark)} ${P.notConfirmable(esc(repo.workflow), esc(repo.defaultBranch))}</p>`}</section>` : "";
    const failed = S.failed === k ? `<p class="erreur" role="alert">${mk("inv", C.notVerified)} ${esc(S.stale === repo.id ? P.stale : S.failedText ?? C.verifyFailed)}</p>` : "";
    return { title: owner ? K.titleOwner : definition ? P.titleDefinition : K.title, key: "declarer", signed: "in", html: `${head(D.nothing.head, C.gestureCheck)}
      <h1 class="v">${owner ? K.h1Owner(name) : definition ? P.h1Definition(name) : K.h1(name)}</h1>
      <p class="face lede">${lede}</p>
      ${pins}
      ${claimsTable(c)}
      ${failed}
      <div class="actions">${p?.confirmable ? act("gesture", owner ? K.confirmOwner : definition ? P.confirmDefinition : K.confirmRepo, { k }) : ""}${act("ask", gitlab ? P.notMineProject : K.notMine, { q: true, k: `repo:${repo.id}` })}</div>
      ${confirmBox(`repo:${repo.id}`)}
      <p class="note">${K.note}</p>` };
  }
  if (what === "modifier" && repo) {
    const M = D.modify;
    const ms = repo.missions;
    return { title: M.title, key: "declarer", signed: "in", html: `${head(M.head, M.headR)}<h1 class="v">${M.h1(name)}</h1>
      <form id="modify" data-id="${esc(repo.id)}" novalidate>${S.formError ? `<p class="erreur" role="alert">${mk("inv", M.notSaved)} ${esc(S.formError.message)} <span class="soft">${esc(S.formError.action)}</span></p>` : ""}
      <label class="f"><span class="k">${gitlab ? esc(G.declare.definitionFile) : M.workflow}</span><input class="in" name="wf" value="${esc(repo.workflow)}" autocomplete="off" spellcheck="false" translate="no"></label>
      <label class="f"><span class="k">${gitlab ? esc(G.declare.branch) : D.branch}</span><input class="in" name="branch" value="${esc(repo.defaultBranch ?? "main")}" autocomplete="off" spellcheck="false" translate="no"></label>
      ${gitlab ? `<p class="avert">${esc(G.declare.modifyNote)}</p>` : `<p class="small soft">${M.series}</p>`}
      ${ms.map((m) => `<p class="small"><code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span> · <label><input type="checkbox" name="remove" value="${esc(m.id)}"> ${M.removeMission}</label></p>`).join("")}
      <div class="mis"><label class="f"><span class="k">${M.addMission}</span><input class="in" name="mission" autocomplete="off" spellcheck="false" translate="no"></label><label class="f"><span class="k">${D.path}</span><input class="in" name="path" value="." autocomplete="off" spellcheck="false" translate="no"></label></div>
      <p class="note">${M.pathNote}</p>
      <div class="actions"><button class="btn" type="submit">${M.save}</button>${go("#/acces", C.cancel, { q: true })}</div></form>` };
  }
  if (id && !repo) return null;
  return { title: S.formError ? D.refused : C.declare, key: "declarer", signed: "in", focus: S.formError ? (S.formError.field ? `#e-${S.formError.field}` : "#e-top") : null, html: `${head(D.head, D.count(a.repositories.filter((r) => r.state !== "removed").length))}
    <h1 class="v">${D.h1}</h1>
    <p class="face lede">${D.lede}</p>${declareForm()}` };
}
