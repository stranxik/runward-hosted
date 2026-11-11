// The verified claims of a workload identity token, claim by claim.
import { esc } from "./base.js";
import { mots } from "./lexique.js";

export function claimsTable(c) {
  if (!c) return "";
  const T = mots().claims;
  const row = (k, v, note) => `<tr><th scope="row"><code>${esc(k)}</code></th><td><code translate="no">${esc(v)}</code>${note ? `<div class="small soft">${esc(note)}</div>` : ""}</td></tr>`;
  const run = c.repository && c.runId ? `https://github.com/${c.repository}/actions/runs/${c.runId}/attempts/${c.runAttempt}` : "";
  return `<div class="tw" tabindex="0" role="region" aria-label="${esc(T.table)}"><table class="t claims"><tbody>
    ${row("repository", c.repository)}${row("repository_id", c.repositoryId, T.pinned)}${row("repository_owner_id", c.repositoryOwnerId, T.pinned)}
    ${row("workflow_ref", c.workflowRef, T.calling)}${row("job_workflow_ref", c.jobWorkflowRef, T.send)}
    ${row("event_name", c.eventName)}${row("ref", c.ref)}${row("sha", c.sha)}${row("runner_environment", c.runnerEnvironment)}
    ${row("run_number · run_attempt", `${c.runNumber} · ${c.runAttempt}`, T.order)}${run ? row("run", run) : ""}
  </tbody></table></div>`;
}
