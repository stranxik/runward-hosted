// What a workload identity token says, and what it proves: its verified claims, claim by claim (GitHub's, or
// GitLab's as the journal keeps them); the values a confirmation pins, shown before the gesture; and the level of
// evidence the token's path reaches (ADR-0029 section 2), said by its sentence first and its code after it, with
// what it does not prove. The level describes the path the file took, never its content: nothing here raises it.
import { esc } from "./base.js";
import { when } from "./time.js";
import { mk } from "./marks.js";
import { mots } from "./lexique.js";
import { ask, confirmBox } from "./confirm.js";

const row = (k, v, note) => `<tr><th scope="row"><code>${esc(k)}</code></th><td><code translate="no">${esc(v)}</code>${note ? `<div class="small soft">${esc(note)}</div>` : ""}</td></tr>`;
const table = (label, rows) => `<div class="tw" tabindex="0" role="region" aria-label="${esc(label)}"><table class="t claims"><tbody>
    ${rows}
  </tbody></table></div>`;
/** The claims kept of a GitLab token carry its pipeline and its definition (src/domain/gitlab.js#claimsKept); GitHub's carry neither. */
const fromGitlab = (c) => c.pipelineId !== undefined || c.definitionRef !== undefined || c.pipelineSource !== undefined;

export function claimsTable(c) {
  if (!c) return "";
  const T = mots().claims;
  if (fromGitlab(c)) {
    const G = mots().forge.claims;
    return table(T.table, `${row("project_path", c.repository)}${row("project_id", c.repositoryId, T.pinned)}${row("namespace_id", c.repositoryOwnerId, T.pinned)}
    ${row("ci_config_ref_uri", c.definitionRef, G.definition)}${row("ci_config_sha", c.definitionSha, G.definitionSha)}
    ${row("pipeline_source", c.pipelineSource, G.source)}${row("ref", c.ref, G.ref)}${row("ref_type", c.refType)}${row("ref_protected", c.refProtected, G.refProtected)}${row("sha", c.sha)}
    ${row("pipeline_id · job_id", `${c.pipelineId} · ${c.jobId}`, G.order)}
    ${row("user_access_level", c.userAccessLevel, G.informative)}${row("runner_id", c.runnerId, G.informative)}${row("runner_environment", c.runnerEnvironment, G.informative)}`);
  }
  const run = c.repository && c.runId ? `https://github.com/${c.repository}/actions/runs/${c.runId}/attempts/${c.runAttempt}` : "";
  return table(T.table, `${row("repository", c.repository)}${row("repository_id", c.repositoryId, T.pinned)}${row("repository_owner_id", c.repositoryOwnerId, T.pinned)}
    ${row("workflow_ref", c.workflowRef, T.calling)}${row("job_workflow_ref", c.jobWorkflowRef, T.send)}
    ${row("event_name", c.eventName)}${row("ref", c.ref)}${row("sha", c.sha)}${row("runner_environment", c.runnerEnvironment)}
    ${row("run_number · run_attempt", `${c.runNumber} · ${c.runAttempt}`, T.order)}${run ? row("run", run) : ""}`);
}

/**
 * The values a confirmation pins (`pending.values` of GET /api/v0/access), each under its name: what the member reads
 * before the gesture, which is bound to their digest. A registered instance is named by its issuer beside its key.
 */
export function pinsTable(values, issuers = []) {
  const P = mots().forge.pins;
  const rows = Object.keys(values ?? {}).map((k) => {
    const v = values[k];
    const reg = k === "issuerKey" ? issuers.find((i) => i.id === v) : null;
    const shown = v === null || v === undefined ? `<span class="soft">${esc(P.none)}</span>` : `<code translate="no">${esc(v)}</code>${reg ? `<div class="small soft">${P.registered(`<span translate="no">${esc(reg.issuer)}</span>`)}</div>` : ""}`;
    return `<tr><th scope="row">${esc(Object.hasOwn(P, k) && typeof P[k] === "string" ? P[k] : k)}</th><td>${shown}</td></tr>`;
  }).join("");
  return `<div class="tw" tabindex="0" role="region" aria-label="${esc(P.table)}"><table class="t claims" data-pins><tbody>${rows}</tbody></table></div>`;
}

// ------------------------------------------------------------- the level of evidence
/** P3b's « not proven » opens with « the line above », which is P3's: the screen says P3's first. */
const ABOVE = { P3b: "P3" };
const known = (L, code) => Object.hasOwn(L, code) && typeof L[code] === "object" && typeof L[code].proves === "string";

/**
 * A level, as the screen says it: what the token proves, what is not proven, then the code (and `state`: whether an
 * upload reached it). `extra` is HTML placed under it. A code this page does not know is shown as written, and said so.
 */
export function niveau(code, { state = "", extra = "" } = {}) {
  const L = mots().forge.level;
  if (!known(L, code)) return `<div class="niveau" data-level="${esc(code)}"><p>${esc(L.unknown)}</p><p class="small soft"><code translate="no">${esc(code)}</code></p>${extra}</div>`;
  const t = L[code], above = ABOVE[code] ? `${esc(L[ABOVE[code]].not)} ` : "";
  return `<div class="niveau" data-level="${esc(code)}">
    <p><span class="k">${esc(L.proves)}</span>${esc(t.proves)}</p>
    <p><span class="k">${esc(L.notProven)}</span>${above}${esc(t.not)}</p>
    <p class="small soft" data-level-code>${esc(L.code(code))}${state ? ` · ${esc(state)}` : ""}</p>${extra}</div>`;
}

/** The level of a mission's line (GET /api/v0/fleet/status): reached or to come, what it rests on, a key since retired. */
export function niveauLigne(l) {
  const L = mots().forge.level, v = l?.level;
  if (!v) return "";
  const rests = v.kid && v.thumbprint ? `<p class="small soft">${L.restsOn(esc(v.kid), esc(v.thumbprint))}</p>` : "";
  const retired = v.keyRetiredAt ? `<p class="avert">${mk("inv", L.retiredMark)} ${L.keyRetired(when(v.keyRetiredAt, { sec: false }))}</p>` : "";
  return niveau(v.code, { state: v.reached ? L.reached : L.willReach, extra: `${rests}${retired}` });
}

/**
 * GitLab's order signal: an upload issued later than the current one was ranked as older. Both orders are shown, and
 * the member opens a new epoch by a gesture bound to the repository (`order-epoch-open`); the service never does.
 */
export function ordre(l) {
  const o = l?.orderSignal;
  if (!o) return "";
  const O = mots().forge.order, k = `epoch:${o.repository}`;
  const one = (x) => O.one(`<b>${esc(x.pipelineId)}</b>`, `<b>${esc(x.jobId)}</b>`, when(x.issuedAt));
  return `<div class="ordre" data-order><p class="avert">${mk("inv", O.mark)} ${O.text(one(o.current), one(o.later))}</p>
    <div class="actions">${ask(k, O.open)}</div>${confirmBox(k)}</div>`;
}
