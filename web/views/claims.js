// The verified claims of a workload identity token, claim by claim.
import { esc } from "./base.js";

export function claimsTable(c) {
  if (!c) return "";
  const row = (k, v, note) => `<tr><th scope="row"><code>${esc(k)}</code></th><td><code translate="no">${esc(v)}</code>${note ? `<div class="small soft">${esc(note)}</div>` : ""}</td></tr>`;
  const run = c.repository && c.runId ? `https://github.com/${c.repository}/actions/runs/${c.runId}/attempts/${c.runAttempt}` : "";
  return `<div class="tw" tabindex="0" role="region" aria-label="Revendications vérifiées du jeton, défilable"><table class="t claims"><tbody>
    ${row("repository", c.repository)}${row("repository_id", c.repositoryId, "épinglé à la confirmation")}${row("repository_owner_id", c.repositoryOwnerId, "épinglé à la confirmation")}
    ${row("workflow_ref", c.workflowRef, "le workflow appelant, déclaré")}${row("job_workflow_ref", c.jobWorkflowRef, "le workflow d'envoi du service, épinglé par commit")}
    ${row("event_name", c.eventName)}${row("ref", c.ref)}${row("sha", c.sha)}${row("runner_environment", c.runnerEnvironment)}
    ${row("run_number · run_attempt", `${c.runNumber} · ${c.runAttempt}`, "l'ordre des envois")}${run ? row("run", run) : ""}
  </tbody></table></div>`;
}
