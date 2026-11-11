// What a repository adds to its CI to send, as the app shows it: GitHub's call of the product's send workflow, pinned
// by its commit; GitLab's jobs, offered for convenience and never presented as pinned (ADR-0029 section 3).
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
/** The runward version GitLab's jobs name: the default of the product's send workflow (.github/workflows/send.yml). */
export const RUNWARD_VERSION = "0.46.0";
// The jobs are written from the declaration and from the access view: a value is written only when it passes a
// strict pattern, so that nothing declared can end a quoted string of the extract; else its place is left to fill.
const SAFE = /^[A-Za-z0-9._/-]{1,200}$/;
const MISSION = /^[a-z0-9][a-z0-9-]{0,62}$/;
const AUDIENCE = /^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/send\/[0-9a-f]{32})?$/;
/**
 * GitLab's jobs (ADR-0029 section 3 rule 1), as .github/workflows/send.yml does it for GitHub: one job computes and
 * keeps runward's file and its exit code; a job apart sends it, with no clone of the repository, a light image, the
 * token GitLab signs for the repository's exact audience, on a push on the declared branch only, four attempts and a
 * named refusal never tried again, the token never printed, the pipeline never failed by the upload; a last job gives
 * the pipeline runward's colour. `audience` is the access view's: the service's origin for gitlab.com, the
 * registration's own address (/send/<id>) for a registered instance; the upload goes to that origin.
 */
export function gitlabText(repo) {
  const m = repo?.missions?.[0];
  const mission = MISSION.test(String(m?.id ?? "")) ? m.id : "<mission>";
  const dir = String(m?.path ?? ".");
  const path = SAFE.test(dir) && !dir.startsWith("/") && !dir.split("/").includes("..") ? dir : "<path>";
  const branch = SAFE.test(String(repo?.defaultBranch ?? "")) ? repo.defaultBranch : "<branch>";
  const audience = AUDIENCE.test(String(repo?.audience ?? "")) ? repo.audience : "<audience>";
  const origin = audience === "<audience>" ? "<service>" : audience.replace(/\/send\/[0-9a-f]{32}$/, "");
  return { branch, audience, mission, text: `# runward hosted. A job of the same name in this file overrides these.
runward-check:
  image: node:22
  script:
    # runward's exit code is kept, not the job's: a refusal is sent too
    - |
      code=0
      (cd "${path}" && npx -y runward@${RUNWARD_VERSION} check --strict --json) > "$CI_PROJECT_DIR/check.json" || code=$?
      echo "$code" > "$CI_PROJECT_DIR/runward-exit"
  artifacts:
    paths: [check.json, runward-exit]
    expire_in: 3 days

runward-send:
  image: node:22-alpine
  needs: [{ job: runward-check, artifacts: true }]
  variables: { GIT_STRATEGY: none }
  id_tokens:
    RUNWARD_ID_TOKEN: { aud: "${audience}" }
  rules:
    - if: '$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "${branch}"'
  script:
    - |
      node --input-type=module <<'JS'
      import { readFileSync } from "node:fs";
      import { createHash } from "node:crypto";
      const bytes = readFileSync("check.json");
      const headers = {
        authorization: "Bearer " + process.env.RUNWARD_ID_TOKEN,
        "runward-mission": "${mission}", "runward-export-kind": "check", "content-type": "application/json",
        "content-digest": "sha-256=:" + createHash("sha256").update(bytes).digest("base64") + ":",
      };
      let out = null;
      // four attempts: at once, then after 2 s, 8 s, 30 s; a named refusal (4xx) is never tried again
      for (const wait of [0, 2000, 8000, 30000]) {
        await new Promise((r) => setTimeout(r, wait));
        try {
          const r = await fetch("${origin}/api/v0/exports", { method: "POST", headers, body: bytes, signal: AbortSignal.timeout(30000) });
          if (r.status < 500 && r.status !== 429) { out = { status: r.status, body: await r.json().catch(() => ({})), request: r.headers.get("runward-request-id") }; break; }
        } catch { /* an attempt that failed is tried again */ }
      }
      const b = out?.body ?? {};
      if (out && (out.status === 201 || out.status === 202)) console.log("runward hosted: " + (out.status === 202 ? "kept, awaiting confirmation in the app" : b.current === false ? "sent (older than the current upload: kept as history)" : "sent") + " · entry " + b.entry + " · seq " + b.seq + " · head " + b.head + " · request " + out.request);
      else if (out) console.log("runward hosted: not accepted · " + b.refusal + " · " + b.message + " " + b.action + " · request " + out.request);
      else console.log("runward hosted: not sent: service unavailable after 4 attempts; retry this job to send it");
      JS

runward-verdict:
  image: node:22-alpine
  needs: [{ job: runward-check, artifacts: true }]
  variables: { GIT_STRATEGY: none }
  script:
    - exit "$(cat runward-exit)"
` };
}
/** GitLab's extract: the jobs, a copy button, the exact audience, and that nothing pins them. */
function gitlabSnippet(repo) {
  const W = mots(), T = W.workflow, G = W.forge.snippet;
  const w = gitlabText(repo);
  return `<pre class="term" tabindex="0" id="extrait" aria-label="${esc(G.extract)}" lang="en">${esc(w.text.trimEnd())}</pre>
<div class="actions install"><button class="btn btn-q" type="button" data-do="copy" data-copy-target="extrait" aria-describedby="copie-etat">${T.copy}</button>
  <span class="small soft" id="copie-etat" role="status" aria-live="polite"></span></div>
<p class="note">${G.audience(esc(w.audience))}</p>
<p class="avert" data-not-pinned>${esc(G.notPinned)}</p>
<p class="note">${G.about(esc(repo.workflow ?? ".gitlab-ci.yml"))}</p>
<p class="note">${G.stages}</p>
<p class="note">${esc(G.tenMinutes)}</p>`;
}
export function snippet(repo) {
  if (repo?.forge === "gitlab") return gitlabSnippet(repo);
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
