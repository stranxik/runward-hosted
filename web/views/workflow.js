// The send workflow call, as the app shows it.
import { S, esc } from "./base.js";
import { mk } from "./marks.js";

// The install path without any right (PADR-0021 point 7, proposed): the extract, a button that opens GitHub's
// create-file page for this repository and its default branch with the path and the content prefilled, and a
// copy button. The prefill by query parameter is not documented by GitHub; it was checked for real in Chrome on
// 2026-11-08 (/new/<branch>?filename=…&value=… fills both; /new/HEAD answers 404, hence the declared branch).
// Nothing is sent to GitHub by the service: the browser opens the page, the member commits it, or not.
function workflowText(repo) {
  const sha = (S.session?.sendWorkflow ?? [])[0] ?? null;
  const branch = repo?.defaultBranch ?? "main";
  const mission = repo?.missions?.[0]?.id ?? "<mission>";
  return { sha, branch, text: `name: runward
on:
  push: { branches: [${branch}] }
  pull_request:
permissions: {}
jobs:
  runward:
    permissions: { contents: read, id-token: write }
    uses: stranxik/runward-hosted/.github/workflows/send.yml@${sha ?? "<sha of the first release>"}
    with:
      mission: ${mission}
` };
}
/** GitHub's create-file page for this repository and branch, with the workflow's path and content prefilled. */
function installUrl(repo, text) {
  const [owner, name] = String(repo.name).split("/");
  const branch = String(repo.defaultBranch ?? "main").split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/new/${branch}?filename=${encodeURIComponent(".github/workflows/runward.yml")}&value=${encodeURIComponent(text)}`;
}
export function snippet(repo) {
  const w = workflowText(repo);
  const install = repo?.name ? `<div class="actions install">
      ${w.sha ? `<a class="btn" href="${esc(installUrl(repo, w.text))}" target="_blank" rel="noopener noreferrer" data-install>Ajouter le workflow</a>` : `<button class="btn" type="button" disabled>Ajouter le workflow</button>`}
      <button class="btn btn-q" type="button" data-do="copy" data-copy-target="extrait" aria-describedby="copie-etat">Copier l'extrait</button>
      <span class="small soft" id="copie-etat" role="status" aria-live="polite"></span></div>
    <p class="note">« Ajouter le workflow » ouvre, dans un nouvel onglet, la page de GitHub qui crée <code>.github/workflows/runward.yml</code> sur la branche <code>${esc(w.branch)}</code> de <span translate="no">${esc(repo.name)}</span>, déjà remplie : il ne vous reste qu'à valider le commit. Ce service n'écrit rien dans votre dépôt et n'y demande aucun droit.</p>
    ${w.branch !== "main" ? `<p class="avert">Votre branche par défaut est <code>${esc(w.branch)}</code>. Aujourd'hui, seul un push sur <code>main</code> envoie : le workflow jugera vos commits, l'envoi attend l'acceptation des autres branches par défaut.</p>` : ""}` : "";
  return `<pre class="term" tabindex="0" id="extrait" aria-label="Extrait du workflow à ajouter dans votre dépôt" lang="en">${esc(w.text.trimEnd())}</pre>
${install}
${w.sha ? "" : `<p class="note">${mk("void", "aucune release")} Le workflow d'envoi n'a pas encore de release publiée : l'appel s'écrira avec son commit dès la première, et le bouton s'ouvrira alors.</p>`}
<p class="note">Ce workflow, publié par le service et épinglé par son commit, lance <code>runward check</code> sur votre commit et envoie ce que runward a écrit : aucun fichier de votre dépôt n'est envoyé à sa place, aucun secret n'est rangé. Sur une PR, il juge sans rien envoyer. Un refus de runward est envoyé aussi, et votre CI reste à la couleur de runward. Si le service ne répond pas, votre CI ne casse pas : le résumé du job dit ce qui n'est pas parti.</p>`;
}
