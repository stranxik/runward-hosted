// Declare, confirm, modify a repository.
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { mk, reqNote, loadingView, head, go, act } from "./marks.js";
import { confirmBox } from "./confirm.js";
import { snippet } from "./workflow.js";
import { claimsTable } from "./claims.js";

export function declareForm() {
  const err = S.formError;
  const e = (field) => (err && err.field === field ? ` aria-invalid="true" aria-describedby="e-${field}"` : "");
  const em = (field) => (err && err.field === field ? `<span class="err" id="e-${field}">${esc(err.message)} ${esc(err.action)}</span>` : "");
  const top = err && !err.field ? `<p class="erreur" role="alert" id="e-top">${mk("inv", "non déclaré")} ${esc(err.message)} <span class="soft">${esc(err.action)}</span>${reqNote(err)}</p>` : "";
  const v = S.formValues ?? { repo: "", wf: ".github/workflows/runward.yml", mission: "", path: ".", branch: "main" };
  return `<form id="declare" novalidate>${top}
      <label class="f"><span class="k">Dépôt (propriétaire/dépôt)</span><input class="in" name="repo" value="${esc(v.repo)}" placeholder="stranxik/dropyour" autocomplete="off" spellcheck="false" translate="no"${e("repo")}>${em("repo")}</label>
      <label class="f"><span class="k">Workflow appelant, celui qui appelle le workflow d'envoi</span><input class="in" name="wf" value="${esc(v.wf)}" autocomplete="off" spellcheck="false" translate="no"${e("wf")}>${em("wf")}</label>
      <div class="mis"><label class="f"><span class="k">Mission</span><input class="in" name="mission" value="${esc(v.mission)}" placeholder="dropyour" autocomplete="off" spellcheck="false" translate="no"${e("mission")}>${em("mission")}</label>
        <label class="f"><span class="k">Chemin dans le dépôt</span><input class="in" name="path" value="${esc(v.path)}" autocomplete="off" spellcheck="false" translate="no"></label></div>
      <label class="f"><span class="k">Branche par défaut du dépôt</span><input class="in" name="branch" value="${esc(v.branch ?? "main")}" autocomplete="off" spellcheck="false" translate="no"${e("branch")}>${em("branch")}</label>
      <p class="small soft">Vous la déclarez : GitHub ne la donne pas sans jeton pour un dépôt privé, et ce service n'en tient aucun. Elle sert au bouton qui ouvre la page de création du workflow. Aujourd'hui, seul <code>main</code> envoie.</p>
      <label class="check"><input type="checkbox" name="content"><span>J'accepte que ce service reçoive le contenu des exports de ce dépôt : verdict, écarts, livrables et noms déclarés par la charte. Sans cet accord, aucun envoi de ce dépôt n'est accepté, attestation comprise. Je peux le retirer à tout moment dans Accès. Cocher cette case vous redemande votre passkey pour ce geste.</span></label>
      <div class="actions"><button class="btn" type="submit">Déclarer ce dépôt</button></div>
      <p class="note">Votre passkey vous est redemandée si votre dernière vérification date de plus de 5 minutes. Le dépôt reste en attente jusqu'à son premier envoi, que vous confirmerez.</p>
    </form>`;
}
export const FIELD_OF = { "repository-malformed": "repo", "workflow-malformed": "wf", "mission-malformed": "mission", "mission-exists": "mission", "branch-malformed": "branch" };

export function viewDeclarer(sub) {
  const a = S.access;
  if (!a) return loadingView("Déclarer");
  const [what, id] = sub.split("/");
  const repo = id ? a.repositories.find((r) => r.id === id) : null;
  if (what === "attente" && repo) return { title: "Dépôt en attente", key: "declarer", signed: "in", focus: "h1", html: `${head("déclarer", "en attente du premier envoi")}
    <h1 class="v" tabindex="-1">${esc(repo.name)} est déclaré.</h1>
    <p class="face lede">${mk("half", "en attente du premier envoi")} Ajoutez l'appel du workflow d'envoi, puis fusionnez sur <code>main</code>. Le premier envoi sera gardé sans être publié jusqu'à ce que vous le confirmiez ici.</p>
    <p class="small">Cette déclaration expire le ${when(repo.expiresAt, { sec: false })} si aucun envoi n'arrive. Sans consentement au contenu, le premier envoi sert seulement à confirmer le dépôt : ses octets ne sont pas gardés.</p>
    ${snippet(repo)}<div class="actions">${go("#/acces", "Revenir à Accès", { q: true })}</div>` };
  if (what === "confirmer" && repo) {
    if (!repo.pendingSend || repo.pendingSend.reason === "owner-changed" && repo.state !== "pinned") {
      return { title: "Rien à confirmer", key: "declarer", signed: "in", html: `${head("déclarer · confirmer", "")}<h1 class="v">Il n'y a rien à confirmer.</h1><p class="face">${repo.state === "pinned" ? `${mk("full", "déjà épinglé")} ${esc(repo.name)} a été confirmé le ${when(repo.confirmedAt, { sec: false })}. Rien n'a changé.` : `${mk("half", "en attente du premier envoi")} Aucun envoi n'est encore arrivé de ${esc(repo.name)}.`}</p><div class="actions">${go("#/acces", "Voir Accès")}</div>` };
    }
    const owner = repo.pendingSend.reason === "owner-changed";
    const c = repo.pendingSend.claims;
    return { title: owner ? "Nouveau propriétaire à confirmer" : "Confirmer le premier envoi", key: "declarer", signed: "in", html: `${head("déclarer · confirmer", "vérification par geste")}
      <h1 class="v">${owner ? `${esc(repo.name)} a changé de propriétaire.` : `Le premier envoi de ${esc(repo.name)} est arrivé.`}</h1>
      <p class="face lede">${owner ? `${mk("inv", "owner-changed")} Le même dépôt (identifiant ${esc(c.repositoryId)}) arrive maintenant sous le propriétaire ${esc(c.repositoryOwnerId)}, au lieu de ${esc(repo.ownerId)}. Si vous avez transféré ce dépôt, confirmez le nouveau propriétaire. Sinon, retirez le dépôt.` : "Vérifiez qu'il vient bien de votre dépôt. En le confirmant, le service retient l'identifiant du dépôt et celui de son propriétaire : un dépôt recréé sous le même nom, ou transféré, ne pourra plus écrire dans votre flotte."}</p>
      ${claimsTable(c)}
      ${S.failed === `confirm:${repo.id}` ? `<p class="erreur" role="alert">${mk("inv", "non vérifié")} La vérification n'a pas abouti. Rien n'a changé.</p>` : ""}
      <div class="actions">${act("gesture", owner ? "Confirmer le nouveau propriétaire" : "Confirmer ce dépôt", { k: `confirm:${repo.id}` })}${act("ask", "Ce n'est pas mon dépôt : retirer la déclaration", { q: true, k: `repo:${repo.id}` })}</div>
      ${confirmBox(`repo:${repo.id}`)}
      <p class="note">Votre passkey vous est demandée pour ce geste. Rien n'est publié avant.</p>` };
  }
  if (what === "modifier" && repo) {
    const ms = repo.missions;
    return { title: "Modifier un dépôt", key: "declarer", signed: "in", html: `${head("déclarer · modifier", "passkey récente")}<h1 class="v">Modifier ${esc(repo.name)}.</h1>
      <form id="modify" data-id="${esc(repo.id)}" novalidate>${S.formError ? `<p class="erreur" role="alert">${mk("inv", "non enregistré")} ${esc(S.formError.message)} <span class="soft">${esc(S.formError.action)}</span></p>` : ""}
      <label class="f"><span class="k">Workflow appelant</span><input class="in" name="wf" value="${esc(repo.workflow)}" autocomplete="off" spellcheck="false" translate="no"></label>
      <label class="f"><span class="k">Branche par défaut du dépôt</span><input class="in" name="branch" value="${esc(repo.defaultBranch ?? "main")}" autocomplete="off" spellcheck="false" translate="no"></label>
      <p class="small soft">Changer de workflow ouvre une nouvelle série dans l'ordre des envois ; les envois de l'ancien restent au journal.</p>
      ${ms.map((m) => `<p class="small"><code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span> · <label><input type="checkbox" name="remove" value="${esc(m.id)}"> retirer (ses envois restent au journal)</label></p>`).join("")}
      <div class="mis"><label class="f"><span class="k">Ajouter une mission</span><input class="in" name="mission" autocomplete="off" spellcheck="false" translate="no"></label><label class="f"><span class="k">Chemin dans le dépôt</span><input class="in" name="path" value="." autocomplete="off" spellcheck="false" translate="no"></label></div>
      <p class="note">Le chemin est une déclaration : le jeton de la CI ne le porte pas.</p>
      <div class="actions"><button class="btn" type="submit">Enregistrer</button>${go("#/acces", "Annuler", { q: true })}</div></form>` };
  }
  if (id && !repo) return null;
  return { title: S.formError ? "Déclaration refusée" : "Déclarer un dépôt", key: "declarer", signed: "in", focus: S.formError ? (S.formError.field ? `#e-${S.formError.field}` : "#e-top") : null, html: `${head("déclarer", `${a.repositories.filter((r) => r.state !== "removed").length} dépôt(s) déclaré(s)`)}
    <h1 class="v">Déclarez un dépôt.</h1>
    <p class="face lede">Un dépôt déclaré est le seul à pouvoir écrire dans votre flotte, depuis son workflow appelant, sur <code>main</code>.</p>${declareForm()}` };
}
