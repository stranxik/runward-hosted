// The send workflow call, as the app shows it.
import { S, esc } from "./base.js";
import { mk } from "./marks.js";
import { mots } from "./lexique.js";

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
  const T = mots().workflow;
  const w = workflowText(repo);
  const install = repo?.name ? `<div class="actions install">
      ${w.sha ? `<a class="btn" href="${esc(installUrl(repo, w.text))}" target="_blank" rel="noopener noreferrer" data-install>${T.add}</a>` : `<button class="btn" type="button" disabled>${T.add}</button>`}
      <button class="btn btn-q" type="button" data-do="copy" data-copy-target="extrait" aria-describedby="copie-etat">${T.copy}</button>
      <span class="small soft" id="copie-etat" role="status" aria-live="polite"></span></div>
    <p class="note">${T.addNote(esc(w.branch), esc(repo.name))}</p>
    ${w.branch !== "main" ? `<p class="avert">${T.branch(esc(w.branch))}</p>` : ""}` : "";
  return `<pre class="term" tabindex="0" id="extrait" aria-label="${esc(T.extract)}" lang="en">${esc(w.text.trimEnd())}</pre>
${install}
${w.sha ? "" : `<p class="note">${mk("void", T.noRelease)} ${T.noReleaseText}</p>`}
<p class="note">${T.about}</p>`;
}
