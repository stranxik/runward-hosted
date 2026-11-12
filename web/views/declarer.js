// « Brancher une application » (ADR-0037 point 1, which refines ADR-0034 and ADR-0035): declare, add the step, deliver,
// confirm the first check, read the first verdict, as five gestures, one action per step, in the panes of the fixed
// shell (web/views/volets.js): the repositories in progress on the left, the step on the right. On the routes the app
// always had: #/declarer (the form; #/declarer/nouveau on a phone, where #/declarer is the list),
// #/declarer/attente/<key> (the step to add, then the waiting), #/declarer/confirmer/<key> (the confirmation, then the
// first verdict), #/declarer/modifier/<key> (a task of its own). Where a repository stands is read from the service
// (web/views/flux.js), and read again while the screen is shown (web/views/flux-vif.js).
//
// What does not change (the rules, ADR-0029 and ADR-0031): on the forge the repository lives on (GitHub, gitlab.com, or
// a GitLab instance this fleet registered), the level of evidence the choice reaches is said before the member adds a
// pipeline; the consent is a box the member ticks, never ticked for them, and ticking it asks the passkey for that
// gesture (declare-with-consent); the values a confirmation pins are shown before the gesture, which is bound to their
// digest (repository-confirm), and a change of them since is refused (confirmation-stale) and shows the new ones. The
// one word the member says, « C'est fait, j'ai fusionné », only moves this screen: it is never sent.
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { mk, reqNote, head, go, act } from "./marks.js";
import { mots } from "./lexique.js";
import { confirmBox } from "./confirm.js";
import { snippet } from "./workflow.js";
import { claimsTable, pinsTable, niveau } from "./claims.js";
import { depotDe, decode, retour, retourMot, versDepot, versSection } from "./liens.js";
import { firstRail, rail, chip } from "./piste/rail.js";
import { piste } from "./piste/mots.js";
import { rowSentence, shortName } from "./piste/portefeuille.js";
import { verdictOf } from "./piste/donnees.js";
import { fenetre, barre, rangee, liste, tete, entete, corps, feuille, pli, etat, squelette, VOLET_FOCUS } from "./volets.js";
import { etape, adresse, enCours, fusionne } from "./flux.js";
import { versJournal } from "./journal-filtres.js";

/** Back where the member came from, else to `home`, said by where it leads. */
const back = (home, label = null) => { const to = retour(home); return go(to, label ?? retourMot(to), { q: true }); };

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
  // gitlab.com is offered only once the service opened it (the access view says so)
  const com = S.access?.gitlabCom === true;
  const choice = (com && v.forge === "gitlab.com") || issuers.some((i) => i.id === v.forge) ? v.forge : "github", gitlab = choice !== "github";
  const opt = (value, label) => `<label class="check"><input type="radio" name="forge" value="${esc(value)}"${value === choice ? " checked" : ""} data-focus-key="forge:${esc(value)}"><span>${label}</span></label>`;
  const forges = `<fieldset class="choix"><legend class="k">${esc(G.forge)}</legend>${opt("github", esc(G.github))}${com ? opt("gitlab.com", esc(G.gitlabCom)) : ""}${issuers.map((i) => opt(i.id, G.instance(`<span translate="no">${esc(i.issuer)}</span>`))).join("")}${em("forge")}</fieldset>
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

// ------------------------------------------------------------- the five gestures, one panel each
/** The mission a repository's name gives by default, as the service writes it (src/domain/repository.js). */
export const missionParDefaut = (name) => String(name ?? "").split("/").pop().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 63);
/** A live line: what the service has said so far, and that the page reads it again by itself. */
const vivant = (kind, html) => `<p class="vivant ${kind}" role="status"><i aria-hidden="true"></i><span>${html}</span></p>`;
/** Where a repository stands, said in one short line (its mark, then its word). */
function statut(repo, e) {
  const F = mots().parcours.flux.status;
  if (e.variant === "expired") return [mk("void", F.expire), "void"];
  if (e.variant === "owner") return [mk("inv", F.owner), "inv"];
  if (e.variant === "definition") return [mk("inv", F.definition), "inv"];
  if (e.step === 5) return [mk("full", F.fait), "full"];
  if (e.step === 4) return [`${mk("half", F.recu(when(repo.pendingSend?.receivedAt, { sec: false })))}`, "half"];
  if (e.variant === "refused") return [mk("inv", F.refuse), "inv"];
  return [mk("half", e.step === 3 ? F.attend : F.rien), "half"];
}

/** Step 1: the short form. The forge, the repository and the consent; mission, path, branch and workflow folded. */
export function formulaire() {
  const W = mots(), D = W.declarer, G = W.forge.declare, F = W.parcours.flux;
  const err = S.formError;
  const e = (field) => (err && err.field === field ? ` aria-invalid="true" aria-describedby="e-${field}"` : "");
  const em = (field) => (err && err.field === field ? `<span class="err" id="e-${field}">${esc(err.message)} ${esc(err.action)}</span>` : "");
  const top = err && !err.field ? `<p class="erreur" role="alert" id="e-top">${mk("inv", D.notDeclared)} ${esc(err.message)} <span class="soft">${esc(err.action)}</span>${reqNote(err)}</p>` : "";
  const v = S.formValues ?? { forge: "github", repo: "", wf: DEFAULT_FILE.github, mission: "", path: ".", branch: "main" };
  const issuers = S.access?.issuers ?? [];
  const com = S.access?.gitlabCom === true;
  const choice = (com && v.forge === "gitlab.com") || issuers.some((i) => i.id === v.forge) ? v.forge : "github", gitlab = choice !== "github";
  const opt = (value, label) => `<label><input type="radio" name="forge" value="${esc(value)}"${value === choice ? " checked" : ""} data-focus-key="forge:${esc(value)}"><span>${label}</span></label>`;
  // the fold opens by itself on a value the member changed, or on one the service refused
  const plusOuvert = Boolean(err && ["mission", "wf", "branch"].includes(err.field)) || Boolean(v.mission) || (v.path && v.path !== ".") || (v.branch && v.branch !== "main") || (v.wf && v.wf !== DEFAULT_FILE[gitlab ? "gitlab" : "github"]);
  const plus = `<div class="grille-c">
      <label class="champ"><span>${D.mission}</span><input name="mission" value="${esc(v.mission)}" placeholder="${esc(missionParDefaut(v.repo) || "dropyour")}" autocomplete="off" spellcheck="false" translate="no"${e("mission")}>${em("mission")}</label>
      <label class="champ"><span>${D.path}</span><input name="path" value="${esc(v.path)}" autocomplete="off" spellcheck="false" translate="no"></label>
      <label class="champ"><span>${gitlab ? esc(G.branch) : D.branch}</span><input name="branch" value="${esc(v.branch ?? "main")}" autocomplete="off" spellcheck="false" translate="no"${e("branch")}>${em("branch")}</label>
      <label class="champ"><span>${gitlab ? esc(G.definitionFile) : D.workflow}</span><input name="wf" value="${esc(v.wf)}" autocomplete="off" spellcheck="false" translate="no"${e("wf")}>${em("wf")}</label></div>
      <p class="fx-n">${esc(F.s1.moreNote(missionParDefaut(v.repo)))}</p><p class="fx-n">${gitlab ? esc(G.branchNote) : D.branchNote}</p>`;
  return `<form class="fx" id="declare" novalidate><h2 class="fx-h">${esc(F.s1.h)}</h2><p class="fx-l">${D.lede}</p>${top}
      <fieldset class="seg"><legend>${esc(G.forge)}</legend>${opt("github", esc(G.github))}${com ? opt("gitlab.com", esc(G.gitlabCom)) : ""}${issuers.map((i) => opt(i.id, G.instance(`<span translate="no">${esc(i.issuer)}</span>`))).join("")}${em("forge")}</fieldset>
      ${issuers.length ? "" : `<p class="fx-n">${G.noInstance}</p>`}
      ${levelAtDeclaration(levelOfChoice(choice))}
      <label class="champ"><span>${gitlab ? esc(G.project) : D.repo}</span><input name="repo" value="${esc(v.repo)}" placeholder="${gitlab ? "group/project" : "stranxik/dropyour"}" autocomplete="off" spellcheck="false" translate="no"${e("repo")}>${em("repo")}</label>
      ${gitlab ? `<p class="fx-n">${esc(G.pathLimit)}</p>` : ""}
      ${pli({ cle: "plus", titre: esc(F.s1.more), corps: plus, ouvert: plusOuvert })}
      <label class="coche"><input type="checkbox" name="content"${v.content ? " checked" : ""}><span>${D.consent}</span></label>
      <div class="fx-act"><button class="btn" type="submit">${D.submit}</button>${back(versSection("depots"), W.common.cancel)}</div>
      <p class="fx-n">${D.formNote}</p></form>`;
}

/** Step 2: the step to add to the chain, compact, its copy, its link, and « c'est fait », a marker of this screen only. */
function etape2(repo) {
  const W = mots(), D = W.declarer, F = W.parcours.flux, G = W.forge.declare;
  const name = esc(repo.missions?.[0]?.id ?? repo.name);
  return `<div class="fx"><h2 class="fx-h">${F.s2.h(name)}</h2><p class="fx-l">${repo.forge === "gitlab" ? G.pendingLede(esc(repo.workflow), esc(repo.defaultBranch)) : D.pending.lede}</p>
    ${repo.level ? levelAtDeclaration(repo.level) : ""}
    <div class="extrait">${snippet(repo)}</div>
    ${vivant("attente", esc(F.s2.live))}
    <p class="fx-n">${D.pending.expires(when(repo.expiresAt, { sec: false }))}</p>
    <div class="fx-act">${act("flux-fait", F.s2.done, { k: repo.id })}</div><p class="fx-n">${esc(F.s2.doneNote)}</p></div>`;
}
/** Step 3: the waiting, which the page reads again by itself; its variants from the real states. */
function etape3(repo, e) {
  const W = mots(), F = W.parcours.flux, D = W.declarer;
  const name = esc(repo.missions?.[0]?.id ?? repo.name);
  if (e.variant === "expired") return `<div class="fx"><h2 class="fx-h">${esc(F.expired.h)}</h2><p class="fx-l">${esc(F.expired.text)}</p><div class="fx-act">${go("#/declarer/nouveau", F.expired.again)}</div></div>`;
  if (e.variant === "removed") return `<div class="fx"><h2 class="fx-h">${esc(F.removed.h)}</h2><p class="fx-l">${F.removed.text(when(repo.restorableUntil, { sec: false }))}</p><div class="fx-act">${go(versDepot(repo.id), F.removed.open)}</div></div>`;
  const refused = e.variant === "refused" && e.refusal
    ? `<p class="erreur" role="alert">${mk("inv", F.status.refuse)} ${F.s3.refused(esc(Object.hasOwn(W.refusal, e.refusal.code) ? W.refusal[e.refusal.code] : e.refusal.code), e.refusal.at ? when(e.refusal.at, { sec: false }) : "")}</p>
      <p class="fx-l">${esc(F.s3.refusedFix)}</p>${e.mission ? `<p class="fx-n"><a class="lien" href="${esc(versJournal({ app: e.mission, quoi: "envois-refuses", entree: e.refusal.seq }))}">${esc(F.s3.seeEntry)}</a></p>` : ""}` : "";
  return `<div class="fx"><h2 class="fx-h">${esc(F.s3.h)}</h2>${refused}
    ${vivant("live", F.s3.waiting(name))}
    <p class="fx-l">${esc(F.s3.auto)} ${esc(F.s3.text)}</p><p class="fx-n">${esc(F.s3.ci)}</p>
    <p class="fx-n">${D.pending.expires(when(repo.expiresAt, { sec: false }))}</p>
    <div class="fx-act">${act("flux-vue", F.s3.back, { q: true, k: `${repo.id}:2` })}</div></div>`;
}
/** Step 4: the confirmation, the values it pins shown before the gesture; the token's claims folded. */
function etape4(repo, e) {
  const W = mots(), D = W.declarer, C = W.common, G = W.forge, F = W.parcours.flux;
  const K = D.confirm, P = G.pins, k = `confirm:${repo.id}`, name = esc(repo.name), gitlab = repo.forge === "gitlab";
  const owner = e.variant === "owner", definition = e.variant === "definition";
  const c = repo.pendingSend.claims, p = repo.pending ?? null;
  const lede = owner ? `${mk("inv", "owner-changed")} ${K.owner(esc(c.repositoryId), esc(c.repositoryOwnerId), esc(repo.ownerId))}`
    : definition ? `${mk("inv", "definition-not-pinned")} ${esc(P.definitionChanged)}` : gitlab ? esc(P.checkGitlab) : K.check;
  const pins = p ? feuille({ titre: esc(P.h2), id: "flux-pins", corps: `<div class="sh-b"><p class="fx-n">${esc(P.lead)}</p>${pinsTable(p.values, S.access?.issuers ?? [])}
      ${p.confirmable ? "" : `<p class="avert" data-not-confirmable>${mk("inv", P.notConfirmableMark)} ${P.notConfirmable(esc(repo.workflow), esc(repo.defaultBranch))}</p>`}</div>` }) : "";
  const failed = S.failed === k ? `<p class="erreur" role="alert">${mk("inv", C.notVerified)} ${esc(S.stale === repo.id ? P.stale : S.failedText ?? C.verifyFailed)}</p>` : "";
  return `<div class="fx"><h2 class="fx-h">${owner ? K.h1Owner(name) : definition ? P.h1Definition(name) : K.h1(name)}</h2>
    ${vivant("recu", F.s4.received(when(repo.pendingSend.receivedAt, { sec: false })))}
    <p class="fx-l">${lede}</p>
    ${pins}
    ${pli({ cle: "claims", titre: esc(F.s4.claims), corps: claimsTable(c) })}
    ${failed}
    <div class="fx-act">${p?.confirmable ? act("gesture", owner ? K.confirmOwner : definition ? P.confirmDefinition : K.confirmRepo, { k }) : ""}${act("ask", gitlab ? P.notMineProject : K.notMine, { q: true, k: `repo:${repo.id}` })}</div>
    ${confirmBox(`repo:${repo.id}`)}
    <p class="fx-n">${K.note}</p></div>`;
}
/** Step 5: the first verdict, published at the confirmation, and the way to its application. */
function etape5(repo, e) {
  const F = mots().parcours.flux, P = piste();
  const m = (S.index?.missions ?? []).find((x) => x.id === e.mission) ?? null;
  const n = m ? shortName(m) : e.mission ?? repo.name;
  const reasons = (c) => esc(Object.hasOwn(mots().refusal, c) ? mots().refusal[c] : c);
  const line = (S.status?.lines ?? []).find((l) => l.mission === e.mission) ?? null;
  const card = m ? `<div class="fx-verdict"><div class="pi-qui"><span class="pi-nm" translate="no">${esc(n)}</span>${chip(verdictOf(m))}</div>${rail(m, n)}<p>${rowSentence(m, line, reasons)}</p></div>`
    : `<p class="fx-n">${esc(F.s5.none)}</p>`;
  return `<div class="fx"><h2 class="fx-h">${F.s5.h(esc(n))}</h2><p class="fx-l">${P.first.verdict(esc(n))}</p>${card}
    ${e.mission ? `<div class="fx-act"><a class="btn" href="#/decision/${esc(encodeURIComponent(e.mission))}" data-flux-premier="${esc(e.mission)}">${esc(F.s5.open)}</a></div>` : ""}</div>`;
}
/** A gesture done, read again: what was declared (1), the step added (2), what was pinned (4). */
function revoir(repo, n) {
  const W = mots(), D = W.acces.depots;
  if (n === 2) return etape2(repo).replace(/<div class="fx-act">[\s\S]*$/, "</div>");
  const missions = repo.missions.map((m) => `<code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span>`).join(", ");
  const rows = n === 1
    ? [[W.declarer.repo, `<code translate="no">${esc(repo.name)}</code>`], [D.missions, missions], [D.workflow, `<code>${esc(repo.workflow)}</code>${D.on}<code>${esc(repo.defaultBranch ?? "main")}</code>`], [W.common.consented, repo.consent ? mk("full", W.common.consented) : mk("void", D.notConsented)]]
    : [[D.pinnedId, `<code>${esc(repo.repositoryId ?? "")}</code>`], [D.confirmed, when(repo.confirmedAt, { sec: false })]];
  return `<div class="fx"><dl class="champs">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl></div>`;
}

/** The rail of the five gestures: those done can be read again, the current one is where the page stands. */
function railFlux(cur, repo, vue) {
  const F = piste().first;
  // step 3 (deliver) has nothing to read again once it is passed: its trace is the journal's entry
  const chips = repo ? F.steps.map((p, i) => i + 1).filter((n) => (n < cur && n !== 3) || n === cur) : [];
  const done = chips.length > 1 ? `<div class="fx-revoir" role="group" aria-label="${esc(mots().parcours.flux.reread)}">${chips.map((n) => `<button class="chip" type="button" data-do="flux-vue" data-k="${esc(repo.id)}:${n === cur ? 0 : n}" aria-pressed="${vue === n}">${esc(F.steps[n - 1])}</button>`).join("")}</div>` : "";
  return `${firstRail(cur - 1)}${done}`;
}

/** The connect flow, in its panes: the list of what is in progress, and the step of the one shown. */
function flux(what, repo) {
  const W = mots(), F = W.parcours.flux, P = piste().first;
  const a = S.access;
  const { progress, recent } = enCours(a.repositories, S.status?.lines ?? []);
  const sel = repo ? repo.id : "nouveau";
  const row = ({ repo: r, e }) => {
    const [st] = statut(r, e);
    return rangee({ href: adresse(r, e), cle: `flux:${r.id}`, courant: repo?.id === r.id, cls: "frow", html: `<b translate="no">${esc(r.name)}</b><span>${esc(F.stepOf(e.step))} · ${esc(P.steps[e.step - 1])}</span><span class="fr-st">${st}</span>` });
  };
  const rows = [
    rangee({ href: "#/declarer/nouveau", cle: "flux:nouveau", courant: what === "nouveau", choisie: !repo && what !== "nouveau", cls: "frow nouveau", html: `<b>${esc(F.nouveau)}</b><span>${esc(F.nouveauSub)}</span>` }),
    progress.length ? `<p class="sec">${esc(F.enCours)}</p>${progress.map(row).join("")}` : "",
    recent.length ? `<p class="sec">${esc(F.faits)}</p>${recent.map(row).join("")}` : "",
  ].join("");
  const e = repo ? etape(repo, S.status?.lines ?? [], { merged: fusionne(repo.id) }) : { step: 1, variant: null };
  // a gesture done can be read again; the one to do is where the page stands
  // #/declarer/attente/<key> is « what the team adds » (web/views/liens.js#versAttente): for a repository already
  // connected, the step it added, read again (its level first, then the extract)
  const asked = repo && S.fluxVue?.id === repo.id && S.fluxVue.n < e.step ? S.fluxVue.n : repo && what === "attente" && e.step === 5 ? 2 : null;
  const vue = asked ?? e.step;
  const panel = !repo ? formulaire() : asked ? revoir(repo, asked) : e.step === 2 ? etape2(repo) : e.step === 3 ? etape3(repo, e) : e.step === 4 ? etape4(repo, e) : etape5(repo, e);
  const prog = `<span class="prog" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<i class="${n < e.step ? "ok" : n === e.step ? "ici" : ""}"></i>`).join("")}</span>`;
  const meta = `${prog}<span class="soft">${esc(F.stepOf(vue))}</span>${repo ? `<span class="soft" translate="no">${esc(repo.name)}</span>` : ""}`;
  // on a phone the step's one action stays at the bottom, under the thumb (web/parcours.css)
  const bas = asked ? "" : e.step === 2 ? act("flux-fait", F.s2.done, { k: repo.id }) : e.step === 4 && repo.pending?.confirmable ? act("gesture", W.declarer.confirm.confirmRepo, { k: `confirm:${repo.id}` })
    : e.step === 5 && e.mission ? `<a class="btn" href="#/decision/${esc(encodeURIComponent(e.mission))}" data-flux-premier="${esc(e.mission)}">${esc(F.s5.open)}</a>` : "";
  const [stHtml, stKind] = repo ? statut(repo, e) : ["", ""];
  const detail = `${entete({ meta, titre: esc(P.steps[vue - 1]) })}${corps(`${feuille({ cls: "sheet-rail", label: P.rail, corps: railFlux(e.step, repo, vue) })}${feuille({ corps: panel, cls: "sheet-step" })}`)}${bas ? `<div class="d-bas">${bas}</div>` : ""}`;
  const bar = barre({ titre: `${esc(F.title)}${repo ? ` <span class="mono" translate="no">· ${esc(repo.name)}</span>` : ""}`, direct: repo ? `<p class="direct${stKind === "half" && e.step === 3 ? "" : " perime"}">${stHtml}</p>` : "" });
  const ecran = repo || what === "nouveau" || !progress.length ? "detail" : "liste";
  const crumb = repo ? [[F.title, "#/declarer"], [repo.name, null, true]] : null;
  // the screen's title says the step (the confirmation's own titles, as before: a new owner, a definition to confirm)
  const K = W.declarer.confirm;
  const title = !repo ? F.title : e.step === 4 ? (e.variant === "owner" ? K.titleOwner : e.variant === "definition" ? W.forge.pins.titleDefinition : K.title) : e.step < 4 && !e.variant ? W.declarer.pending.title : repo.name;
  return {
    title, key: "declarer", signed: "in", main: "volets", ecran, cle: "declarer", sel, crumb,
    focus: S.formError ? (S.formError.field ? `#e-${S.formError.field}` : "#e-top") : VOLET_FOCUS,
    html: fenetre({ bar, liste: `${tete(esc(F.title))}${liste(rows, F.list)}`, detail, label: P.steps[vue - 1] }),
  };
}

export function viewDeclarer(sub) {
  const W = mots(), D = W.declarer, C = W.common, G = W.forge;
  const a = S.access;
  if (!a) return { title: W.parcours.flux.title, key: "declarer", signed: "in", main: "volets", ecran: "liste", cle: "declarer", html: squelette(4, W.marks.loading) };
  // a repository is named by its id, or by its name where only the name is known (web/views/liens.js)
  const [what, key, ...rest] = sub.split("/");
  const id = key === undefined ? undefined : decode(key);
  if (rest.length || id === null) return null;
  const repo = id ? depotDe(a.repositories, id) : null;
  const name = repo ? esc(repo.name) : "";
  const gitlab = repo?.forge === "gitlab";
  if ((what === "attente" || what === "confirmer") && repo) return flux(what, repo);
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
      <div class="actions"><button class="btn" type="submit">${M.save}</button>${back(versDepot(repo.id), C.cancel)}</div></form>` };
  }
  if (id && !repo) return null;
  if (what === "" || (what === "nouveau" && id === undefined)) return flux(what, null);
  return null;
}
