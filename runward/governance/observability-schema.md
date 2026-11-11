# Observability Schema: runward hosted

**Date**: 2026-11-06

## 1. The three levels

- **Logs**: one JSON line per event on standard output (`src/adapters/system/log.js#jsonLog`), fields from a closed list: level, at, event, requestId, route, method, status, ms, refusal, tenant (a digest), detail, error. Never a body, a token, a name or a path.
- **Events**: the tenant's journal (`rw.ledger`), append only and chained (ADR-0007); the operator's journal (`rw.operator_journal`).
- **Measures**: the six of the framing note; the request budget per screen.

## 2. Propagated request ID

Created by the server for each request (`r-` and 12 hex), returned in `Runward-Request-Id`, written in the log line and in the journal entry, shown in every error state of the screen, and written by the send job in the job summary.

## 3. Provenance

Each upload's entry keeps the verified claims of its token (repository and owner by id, calling and called workflows with their SHA, event, ref, commit, runner; for GitLab: the project and its namespace by id, the pipeline definition and its commit, the pipeline's source, the ref and whether it is protected, the pipeline and job numbers, and, informative only, the user's access level and the runner; never a login or an e-mail address), the level of evidence the upload reached with what it rests on (`level`: its code, the issuer key and whether the issuer is public or registered, the `kid` and the thumbprint of the key that signed, whether a protected branch was required: ADR-0029 section 2), the run, attempt and order epoch, and each publication the runward-fleet version and the digests of the archive, the inventory and the index.

## 4. Unfolding a consolidated memory (audit)

No memory. The audit is the journal page (`GET /api/v0/journal`) and the export's `journal.jsonl`.

## 5. Cost ceilings

Budget 20 EUR excluding tax a month, billing alert at 15 EUR (author's decision); max scale 1; the probe hourly, not every 5 minutes; 30 runs an hour per repository.

## 6. Retention and the operational view

Decided on 2026-11-10 (the independent review of a4ede14 found both left "to confirm").

**Where the lines go, and for how long.** The standard output of both containers (the service and the operator's gateway) is collected by the hoster's Cockpit, in the project `runward`, region fr-par: no agent, no exporter, nothing leaves the hoster (`topology-trace-export-decision`). Cockpit keeps the logs of Scaleway products **7 days** by default (settable from 1 day to 1,825 days) and their metrics 31 days, and the logs and metrics of Serverless Containers at that default retention are free of charge. The default is kept: a line carries internal data only (the schema of §1, its free fields bounded and scrubbed), 7 days cover the probe's alert and its diagnosis by request id, and the durable records are elsewhere: the tenants' journal in the database (chained; daily backups kept 7 days by the hoster, `infra/scaleway/main.tf`) and in each export, the security log in the object store. A longer retention is a decision of its own (it would cost 0.002 EUR per GB and day beyond the 7 free days).

Sources, read on 2026-11-10 in the hoster's documentation, from its public source repository (the site answers 403 to a script): `scaleway/docs-content`, `pages/cockpit/concepts.mdx` § Retention ("Default retention … Scaleway logs: 7 days"; minimum 1 day, maximum 1825 days), `pages/serverless-containers/how-to/monitor-container.mdx` ("Logs and metrics for Serverless Containers with default retention (31 days for metrics / 7 days for logs & traces) are free of charge"), `pages/cockpit/reference-content/cockpit-pricing.mdx` (extended retention 0.002 EUR per GB and day); published at https://www.scaleway.com/en/docs/cockpit/concepts/ and https://www.scaleway.com/en/docs/serverless-containers/how-to/monitor-container/.

**The operational view, minimal and real.** Three readings, none of them built for the occasion:

| Question | Where it is read | What it shows |
|---|---|---|
| Is the service up, and is it erring? | `GET https://app.runward.dev/api/health` (public, no data), judged hourly by `.github/workflows/probe.yml`, whose run summaries are its history | the database, the object store, maintenance, the error rate of the last five minutes, the last run of each daily job and whether it completed, and over the last 130 minutes the calls the two budgets of failures counted with their prefix or served untracked (`limits`; untracked raises the probe's alert, and the service logs `limits.untracked` once a minute while it lasts, without an address) |
| What do the containers do? | Cockpit → Access Grafana → Scaleway Dashboards → **Serverless Containers Overview** (and **Serverless Containers logs**), filtered on `runward-hosted` or `runward-hosted-operator`; or the Metrics and Logging tabs of a container in the console | the hoster's own metrics: status, instances, CPU and memory, requests per second, the share of each status code; the lines of §1 |
| What happened to one request or one gesture? | the request id of the answer or of the job summary, searched in **Serverless Containers logs**; the tenant's journal page (`GET /api/v0/journal`) | the log line and the journal entry that carry the same request id |

The hoster's dashboards exist for every container without any setting; they are opened for the first time on the first deploy (runbook §12, step 5), which is when this view stops being only documented.

## References

ADR-0007, ADR-0010, ADR-0016.
