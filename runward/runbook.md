# Runbook: runward hosted

**Version**: v0.2 · **Last review**: 2026-11-10 · **Owner**: Thibault Souris

## 0. The seven gestures, where they are

| Gesture | Where | The command or the path |
|---|---|---|
| Start, stop | §1 | `node src/main.js`; SIGTERM drains (no new request, the ones in flight end, the pool closes, exit within 5 s) |
| Observe | §10 | `curl -s https://app.runward.dev/api/health \| jq .`; the hoster's dashboards (`governance/observability-schema.md` §6) |
| Debug a trajectory | §10 | the request id of the answer or of the job summary, searched in the logs and the journal |
| Resume from a checkpoint | §3 | nothing to replay after a restart; a dropped upload: re-run the client job; after a restore: `restore-replay` (§8) |
| Swap the provider | §6 | no model; the analogue, a re-pin of runward-fleet, and a rollback by digest (§7) |
| Rerun the evaluation | §14 | `npm test`, `npm run test:pg`, `npm run test:reports`; the report lands in `reports/junit.xml` |
| Process a suspended approval | §15 | the waiting runs of the environments `operateur` and `production`, approved by the author |

The whole sequence of a deploy's first gestures, rehearsed on a throwaway stack by someone who did not build this: §13.

## 1. Startup

- **Prerequisites**: Node.js 22 or later; a PostgreSQL with the four roles (`db/roles.sql`) and the database granted to `rw_owner`; an S3 bucket without versioning; the environment below. Secrets are environment variables only, set at the hoster as secret variables, never in a file.
- **Migrate** (as `rw_owner`, never the service): `MIGRATE_URL=postgres://rw_owner@<host>/<db> node scripts/migrate.mjs`. Expansion only: a file that drops, renames, moves to another schema (`set schema`), truncates or changes a column's type is refused, and so is one that runs a statement its text does not hold (an `execute` in a body, code in a quoted string); the script's header lists what is and is not refused.
- **Start**: `node src/main.js`, with `DATABASE_URL` (role `rw_app`), `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `RW_ORIGIN`, `RW_COMMIT`, `RW_IMAGE`, `RW_SEND_WORKFLOW_SHAS`. A missing value stops the start with the list of what is missing (exit 78), never a value.
- **Feature detection at boot**: the start line says the store, the objects, the origin, the commit, the runward-fleet version, the egress list and how many send workflow releases are accepted.
- **Health check**: `GET /api/health` (database and object store, maintenance), `GET /api/version` (commit, image, views, API contract, index format, send workflow).
- **Stop**: SIGTERM (what the hoster sends) or Ctrl-C: the server stops accepting, lets the requests in flight end, closes the database pool, and exits; after 5 s it exits anyway (`src/main.js`). Nothing is lost: every state is in PostgreSQL and the object store (§3).
- **Local witness**: `RW_STORE=memory RW_ORIGIN=http://localhost:8787 PORT=8787 node src/main.js` (memory only, refused in production; nothing survives a restart). On a throwaway PostgreSQL, with the operator's gateway: §13.

## 2. Dependencies and degraded modes

| Dependency | Role | Criticality | Behavior on failure |
|---|---|---|---|
| PostgreSQL | state, journal, isolation | critical | fail-closed on writes (503 `service-unavailable`); reads degraded to a named state; the send job retries 4 times then warns |
| Object store | exports, security log, archives | critical | fail-closed on uploads and access gestures (the security log is written before commit); reads of the index degraded only if the database fails |
| GitHub OIDC keys | upload and reader tokens | critical | fail-closed: `service-unavailable` (503), retried by the send job; a failed or empty read of the keys is never charged to the token, the next read is tried 5 s later (`src/adapters/oidc/github.js`) |
| The browser's passkeys | sign-in | critical | fallback to the phone by QR code, or another browser, named on screen |

**Transverse rule**: degrade reading, never acting.

## 3. Checkpoints and recovery

- **State model**: the chained journal per tenant is the truth and the audit; the published index is derived from it and the current uploads; the security log in the object store survives a database restore.
- **Recovery**: a restart needs nothing replayed: every state is in PostgreSQL and S3; a dropped upload is re-sent by re-running the client job (idempotent per run, attempt, mission and kind).
- **Replication**: one instance; per-tenant advisory locks already serialise journal appends and publications if a second instance comes.
- **Agent suspended awaiting approval**: no agent; an operator workflow waits for its environment approval, then expires (§15).
- **The journal**: `verify-chains` (daily at the hoster, 03:53 Paris, through the gateway) checks every tenant's chain and writes its report to the operator's journal; `/api/health` says whether its last run completed (§10).
- **A restore of the database** (PADR-0014 note, T24): the service stays stopped (minimum and maximum scale 0) from before the restore until the replay has answered 200, because the maintenance flag is a row of the database being restored and reverts with it (code review of 2026-11-10, C10). While the database can still be read, `scripts/operator-call.sh restore-replay '{"anchor":true}'` writes the head of each tenant's journal to that tenant's security log in the object store, once, before the restore. Run after the restore and before the replay, it is refused `restore-not-replayed` and anchors nothing (the gateway answers `ok=false`; the reason is in its log line and in the operator journal's note `restore-anchored`): an anchor taken then would be of the restored head, and the replay would say that nothing was lost (code review C17). Run the replay first; the next anchor is taken after it. Restore the day's backup; then `scripts/operator-call.sh restore-replay '{"since":"<ULID of the backup's time>"}'` (§8). It closes every session of every tenant, replays the gestures from the object store in ULID order, and writes to each tenant's journal an entry `restore-replayed` that says which entries are lost, by their seq: `lost.from` to `lost.to`, with the restored head and the head before the loss (`lost.to` is null when no anchor was written: the range is open, never guessed). The operator journal's note lists, per tenant: `memberless` (open its bootstrap again, `open-bootstrap` with `tenant`), `stranded` (members left without a passkey: `open-recovery`, or `recoveryHash` for the first one) and `failed`. A refusal `security-log-unreadable` wrote nothing, for the anchor as for the replay; a tenant whose replay failed is rolled back whole, and the same gesture run again replays every tenant. Drill it on a throwaway stack, timed: §16.

## 4. Common incidents

| Symptom | Error type | Diagnosis | Action |
|---|---|---|---|
| the send job says "not sent: service unavailable" | transient | `/api/health`, the probe issue | re-run the job; the upload is idempotent per run, attempt, mission and kind |
| the send job says "not sent: this runner has no Node.js 22" | configuration | the caller passed a `runner` of its own, and that machine has no `node` on its PATH, or one older than 22 (the send job installs none) | the caller installs Node.js 22 or later on the runner, then re-runs the job |
| an upload "not accepted" with a code | validation | the code, message and action in the job summary and in Envois | follow the action named |
| an index not published (quarantine) | business | the journal entry names the field | fix the export or wait for the runward-fleet update |
| the probe opened "service unavailable" | unavailable | the hoster console, the container logs by request id | redeploy the last green digest (below) |
| the probe's issue says "the daily job retention (or verify-chains) did not complete" | job | the gateway's log lines `operator.gesture` and `operator.job-note` (reasons `deadline`, `exit`, `busy`: a job killed at its deadline, ended without its status, or refused because another gesture ran, then noted by a second short child) at the hour of the run (Cockpit, Serverless Containers logs, container `runward-hosted-operator`): how many tenants, and the first reason; the tenant itself is named only in the operator journal, in the database | re-run it: `scripts/operator-call.sh retention` (or `verify-chains`), both idempotent; a broken chain is an incident of its own (T10): do not re-run until the entry is understood |
| the probe's issue says "call(s) … were served untracked" | flood | `/api/health` → `limits` (130 minutes: `countedByPrefix`, `untracked`, for the session cookies and for the machine routes); the service's log lines `limits.untracked` give the minutes (one a minute while it lasts, no address); the hoster's dashboard gives the request rate | the two budgets of failures were off for those calls: more than 10,000 prefixes (IPv6 /48, IPv4 /24) called in one minute. Nothing to repair in the service; if it lasts, filter at the hoster's edge, and the alert closes 130 minutes after the last such call |
| the probe's issue says "has not run since" | job | the triggers of the container `runward-hosted-operator` in the console (`retention` 03:23, `verify-chains` 03:53, Europe/Paris) | run it by hand as above, then check the triggers |
| `operator-call` answered `HTTP 409 (error=busy)` | transient | another gesture runs (one at a time) | wait for it, then call again |
| `operator-call` answered `HTTP 400 (error=arguments)` | validation | the gateway's log line `operator.refused` names the argument | compare with the forms of §8 and call again |
| the bill nears 15 EUR | ceiling | the console | check the minimum scale (must be 0) and the probe frequency |

## 5. Contacts

| Role | Person | Channel | Scope |
|---|---|---|---|
| technical on-call | Thibault Souris | issues of stranxik/runward-hosted-ops (private) | operations |
| product owner | Thibault Souris | this repository | business decisions |
| sensitive-action approver | Thibault Souris | the GitHub environments operateur and production | human validation |
| hosting provider | Scaleway support | the Scaleway console | escalation |

## 6. Model provider failover

- **Availability failover (immediate)**: not applicable: the service calls no model.
- **Manual override**: not applicable.
- **Promoting a new model (earned)**: not applicable; the analogue is a new runward-fleet version, pinned by a new ADR and replayed (ADR-0002, ADR-0018): at a commit `<c>` of runward's `main`, `git -C <runward checkout> checkout <c> && npm pack ./packages/runward-fleet` (twice: the same sha256), the tarball into `vendor/runward-fleet-<version>-<c8>.tgz`, `vendor/runward-fleet.lock.json` (commit, tarball, sha256, integrity, `files`: the pack's files each with its sha256, printed by `node scripts/verify-runward-fleet.mjs --files vendor/<tarball>`, and the previous pin with why it moved) and `package.json` / `package-lock.json` (`npm install ./vendor/<tarball>`) changed together; then `node scripts/verify-runward-fleet.mjs` (the tarball holds the pack of that commit and nothing else, every file against GitHub), `node --test test/unit/repositories.test.js` (the export replays byte for byte) and the views' text (`test/unit/http.test.js`); a new ADR that refines ADR-0018.
- **Rollback**: redeploy the previous digest (section 7).

## 7. Deploy and roll back

- Deploy: a push to `main` with `vars.RW_DEPLOY_ENABLED == 'true'`; `.github/workflows/deploy.yml` deploys by digest only after the ci run of that commit is green: first the operator's gateway, which runs `roles`, `migrate`, then `grants` (ADR-0016, and ADR-0023, proposed; §11: the rights of `rw_app` and `rw_maint` on the migrated base are those of `db/schema.snapshot.txt`, or the deploy stops there), then the service; it checks the served revision of each at the hoster (S5) and that their environment was merged, not replaced, then `/api/version`, the smoke, the real send workflow to the witness tenant, the isolation suite on the deployed base (through the gateway), and purges the registry beyond the 5 newest images (never a digest served or named for rollback); any failure redeploys the previous digest on both containers: both are tried whatever the first answers, and the rollback fails if either did.
- How a container is deployed (`scripts/container-deploy.sh`): one update (PATCH) with the digest and the whole environment map, which the hoster redeploys by itself; no `POST /deploy` follows (the hoster answers it 409 on a container that already redeploys: that failed the deploy of 2026-11-10 and its rollback, each after a container had changed). The script then reads the hoster until the container is `ready` on that digest and the redeploy was seen (the container's `ready_at` changed, or a status other than `ready` was read after the update; if neither shows in 6 reads, `ready` on the digest is accepted and the log says `showed no redeploy`: read the gateway's revision at the hoster before trusting that run), and fails on `error`, on a refused update (its status and the hoster's message are printed) or after 60 reads 10 s apart.
- The smoke's refused host (`scripts/smoke.mjs`, found at the first deploy, 2026-11-10): the check must be answered by the app's own guard, 421 with the refusal `host-not-allowed`. The hoster's router picks the container by `Host` and answers 404 itself for a host it does not know, so the smoke sends, as `Host`, the container's default hostname at the hoster, which the router routes to the service and the app does not serve (`RW_SERVICE_HOST`, from the repository variable of the same name, §12 step 4), while the TLS server name stays `app.runward.dev`. A 404, any other status, a 421 without that refusal or a failed handshake is a fault. Against an https origin the smoke refuses to run without that host (exit 3), and `deploy.yml` refuses before it builds anything when the variable is empty, or when it is not the hostname the hoster itself reports for the service's container (`scripts/service-host-check.sh`, the field `domain_name` of the container, compared without case and without a trailing dot; an answer without that field is a refusal); `scripts/check-workflows.mjs` holds all three, the refusal read by job: in the job that holds a secret or in a job it needs, without `if:` or `continue-on-error:`. In plain http (the CI image, a local run) nothing stands before the app: the host sent is `elsewhere.example`. By hand: `RW_SERVICE_HOST=<default hostname> node scripts/smoke.mjs https://app.runward.dev <commit>`.
- Roll back by hand: `gh workflow run rollback.yml --repo stranxik/runward-hosted -f digest=rg.fr-par.scw.cloud/runward/runward-hosted@sha256:<digest of a green deploy>`; it rolls back the service only (the gateway keeps the newest code; migrations are expansion only), waits for `/api/version` and writes the time it took in the run summary.
- Migrations are expansion only, so the previous image runs on the new schema: a rollback never needs a down migration. One case to know: an image of before migration `0006` does not read `erased_at`, so for a tenant whose last index version is erased and that has published nothing since, it answers the index with a 200 and an empty body until that tenant's next upload or gesture that changes the index; no erased byte comes back (ADR-0020).

## 8. Operator gestures (the closed list)

All run inside the hoster's private network through the operator's gateway (ADR-0016): a private Serverless Container of the same image, one authenticated call per gesture, each run under its own database role. From the CI or from the author's workstation (the private repository `stranxik/runward-hosted-ops` and its environment `operateur` are planned; on 2026-11-10 the repository is empty): `scripts/operator-call.sh <gesture> '<json args>'` with `SCW_SECRET_KEY` (the hoster's barrier), `RW_OPERATOR_TOKEN` (the gateway's) and `RW_OPERATOR_URL` (output `operator_endpoint`). The token of a link is drawn on the author's workstation (`npm run operateur:amorcage`, `npm run operateur:reprise -- --tenant <id> --member <id>`); only its sha256 is passed. The gateway's arguments are the commands' flags in camelCase, for example `scripts/operator-call.sh open-bootstrap '{"hash":"<sha256>","witness":true}'`.

**What comes back is a status and a code** (the gateway answers the HTTP status and `{ gesture, ok, exit }`, or `{ error: <code> }` with refused, not-found, arguments, not-json, too-large or busy), and `scripts/operator-call.sh` prints one line made of those fields only, for example `operator-call: migrate answered HTTP 200 (gesture=migrate ok=true exit=0)`: its output lands in a GitHub runner's log, outside the private network. A gesture's result (a tenant, a link, a report, a head) is written to the operator journal in the database, never returned. So a gesture that creates a tenant takes the tenant's id from its caller: draw it on the workstation (`node -p 'crypto.randomUUID()'`) and pass it as `tenant`. The reason of a refusal or of a failure is in the gateway's log line at the hoster (Cockpit, Serverless Containers logs, container `runward-hosted-operator`), bounded and without identifiers.

| Gesture | Role | Command (what the gateway runs) |
|---|---|---|
| roles (before the first migration, and at each deploy; no argument) | `rw_admin` | `node scripts/roles.mjs` |
| migrate (each deploy, before the service switches) | `rw_owner` | `node scripts/migrate.mjs` |
| grants (each deploy, right after `migrate`; no argument: the grants of `rw_app` and `rw_maint` against `db/schema.snapshot.txt`, read in the service database, §11) | `rw_owner` | `node scripts/grants.mjs` |
| isolation (each deploy, after the smoke) | `rw_app` | `node scripts/isolation-deployed.mjs` |

| Gesture (role `rw_maint`) | Command |
|---|---|
| open a bootstrap | `open-bootstrap --hash <sha256> [--tenant <id>] [--witness] [--title <text>]` |
| open a recovery | `open-recovery --hash <sha256> --tenant <id> --member <id>` |
| reset a tenant's access | `reset-access --hash <sha256> --tenant <id>` |
| maintenance | `maintenance --on --until <iso> --reason <text>` / `maintenance --off` (during a maintenance, sign-in, the link options and the redemption of a link are refused, as is every browser write; open sessions still read) |
| retention (daily, 03:23 Paris, trigger) | `retention` |
| chain check (daily, 03:53 Paris, trigger) | `verify-chains` |
| before a restore, while the database can still be read | `restore-replay --anchor` (refused `restore-not-replayed`, nothing written, when a tenant's latest anchor names an entry its journal no longer holds and no replay was noted since: a restore is waiting for `--since`; refused `security-log-unreadable` when a tenant's security log cannot be read) |
| after a restore | `restore-replay --since <ulid>`, optionally `--recovery-hash <sha256>` |

## 9. Secrets

`SCW_SECRET_KEY` (environment `production` of this repository, reserved to `main`), `RW_OPERATOR_TOKEN` (same environment; keychain `runward-hosted-operator` / `token`; the gateway holds only its sha256), the database roles' passwords and the S3 keys (secret variables of the two containers). Rotation of the Scaleway key: create the new key, set it in the environment, run a deploy, revoke the old key.

A value the author types or pastes is put in the macOS keychain by masked input, in a terminal of its own, with the author's script: `~/.claude/skills/autonomie/scripts/ranger-secret.sh <service> <account> [pattern]` (the optional pattern, an extended regular expression, is what the value must match). It reads the value with `read -rs`, hands it to `security -i` on standard input (never in a command line, a history or a process list), reads it back and shows only its length, its equality with what was typed and its match with the pattern. Never `security add-generic-password … -w` at its masked prompt: it cuts the value at 128 characters without a word (measured on 2026-11-06 with a 300-character token). Check a value without showing it: `security find-generic-password -s <service> -a <account> -w | tr -d '\n' | wc -c` (the length only, compared with the expected one), then one real call that uses it. A value drawn by a session (`openssl rand`) goes the same way, by standard input (§12, step 1).

## 10. Watching

The hourly probe (`.github/workflows/probe.yml`, on when `vars.RW_PROBE_ENABLED == 'true'`) opens an issue after two failures in a row, and comments on it each hour with its verdict until the cause is gone: the service unavailable, an error rate above 5 % over five minutes, or a daily job that did not complete or has not run for more than 26 hours; the witness reader (`temoin.yml`) publishes S1 daily; the billing alert at 15 EUR is set in the console.

- **Is it healthy?** `curl -s https://app.runward.dev/api/health | jq .`: `ok`, `db`, `objectStore` (a fixed witness object without data, written then read back, its verdict kept 30 s), `maintenance`, `errors` (the last five minutes), `dailyJobs` (`lastRun`, `ok` for `retention` and `verify-chains`, both null before a first run; when `db` is ok and `dailyJobs` itself is null, the outcome could not be read and the probe alerts). The probe's history: `gh run list -R stranxik/runward-hosted --workflow probe.yml`, each run's summary holding its verdict.
- **What do the containers do?** Cockpit → Access Grafana → Scaleway Dashboards → Serverless Containers Overview (metrics) and Serverless Containers logs, filtered on `runward-hosted` or `runward-hosted-operator`; the logs are kept 7 days, the metrics 31 days (the hoster's defaults, `governance/observability-schema.md` §6).
- **Debug one request** (a trajectory): take its request id (`r-` and 12 hex: the `Runward-Request-Id` header, the `requestId` of a refusal, the `request:` line of the send job's summary), search it in Serverless Containers logs (one `http` line: route, status, duration, refusal, the tenant as a digest), then in the tenant's journal (`GET /api/v0/journal`, the entry that carries the same request id). Locally, `grep '"requestId":"r-…"'` on the service's standard output (§13, step 10).

## 11. Resources to create (paid: each waits for the author's approval)

Described in `infra/scaleway/main.tf` (OpenTofu, provider scaleway 2.88.0), project `runward`, region fr-par, zone fr-par-1. Prices excluding tax, read on 2026-11-08 in the public catalogue (`api.scaleway.com/product-catalog/v2alpha1/public-catalog/products`, hourly prices times 730 hours); the budget approved on 2026-11-06 is 20 EUR a month, alert at 15 EUR.

**Phase 1** (20 resources, plan of 2026-11-08):

| Resource | Setting | Monthly cost |
|---|---|---|
| Private Network `runward-hosted` | regional, IPAM | 0 EUR |
| Container Registry `runward` | private namespace, a few images of 100 to 200 MB | under 0.10 EUR (storage 0.027 EUR per GB) |
| Serverless Containers namespace `runward-hosted` | empty until phase 2 (Scaleway also creates its own, empty, registry namespace) | 0 EUR |
| Object Storage `runward-hosted-objects` | no versioning, incomplete uploads aborted after 1 day, a few MB | under 0.10 EUR |
| Managed PostgreSQL 16 `runward-hosted` | DB-DEV-S, one node, no HA, `sbs_5k` 5 GB, daily backups kept 7 days, encrypted at rest, **private network endpoint only** (no public endpoint; a postcondition fails the apply if one appears) | 11.39 EUR (0.0156 EUR per hour) + volume 0.50 EUR (0.099 EUR per GB) + backups 0.029 EUR per GB |
| Database `runward_hosted`, users `rw_owner`, `rw_app`, `rw_maint` and their privileges | passwords write-only, never in the plan or the state | 0 EUR |
| Secret Manager, path `/runward-hosted` | 4 secrets (connection URLs of `rw_admin`, `rw_owner`, `rw_maint`, `rw_app`), one version each | 0.18 EUR (0.044 EUR per version), access 0.03 EUR per 10 000 reads |

**Phase 2** (when `image` names a real digest; 5 more resources, then the domain):

| Resource | Setting | Monthly cost |
|---|---|---|
| Serverless Container `runward-hosted` (the service) | 0.25 vCPU, 536 MB (536000000 bytes, what the hoster keeps of the 512 MiB asked: it counts in MB of 10^6 bytes), scale 0 to 1, public, in the private network | about 0 EUR within the monthly free tier (200 000 vCPU-s, 400 000 GB-s); about 6.50 EUR if the minimum scale becomes 1 |
| Serverless Containers namespace `runward-hosted-operator` and container `runward-hosted-operator` (the operator's gateway, ADR-0016) | 0.25 vCPU, 536 MB (same), scale 0 to 1, **private**, in the private network, request timeout 900 s | about 0 EUR (a few minutes a day, within the same free tier) |
| Two scheduled triggers of the gateway | `retention` 03:23 and `verify-chains` 03:53, time zone `Europe/Paris` | 0 EUR |
| Domain `app.runward.dev` | container domain, applied with `-var app_domain=true` once the CNAME resolves | 0 EUR |
| Cockpit (logs and metrics) | the products' own logs and metrics, at the default retention: logs 7 days, metrics 31 days (`governance/observability-schema.md` §6) | 0 EUR (free at the default retention, the hoster's documentation) |
| **Total** | | **about 12.3 EUR a month** (phase 1 alone about 12.3 EUR) |
| One-off: restore drill | a throwaway DB-DEV-S for a few hours | cents |

No Serverless Job and no Secret Manager entry is created any more (ADR-0016): the provisioning key needs no Secret Manager right.

**What the hoster does not allow, as of 2026-11-08, and how it is met:**
- Serverless Jobs cannot join a Private Network (Scaleway's Serverless Jobs FAQ: "does not currently support Scaleway VPC or Private Networks"; no such field in the provider 2.88.0). The database has no public endpoint (and will not have one). So roles, migrate, isolation and the operator's gestures go through the operator's gateway, a private container attached to the private network (ADR-0016).
- A Serverless Container has no Secret Manager reference and no write-only argument: the connection URLs (the service's `rw_app`; the gateway's four roles) and the S3 keys are `secret_environment_variables`, kept in the state. The state and the plan are encrypted by OpenTofu (`encryption` block, pbkdf2 + AES-GCM, enforced) and kept outside any repository. The operator's token is not in the state: the gateway holds its sha256 (`operator_token_sha256`).
- A trigger cannot carry a secret except in clear in its configuration: the two daily gestures are reached by `POST /scheduled/retention` and `/scheduled/verify-chains`, which take no token and no argument and run nothing else (ADR-0016).
- The API that updates a container documents a merge for `secret_environment_variables` only; `environment_variables` is sent as the whole map. The CI therefore reads the current map, sets `RW_IMAGE` (and `RW_COMMIT`) on it and sends it whole, then checks that no key was lost (`scripts/container-deploy.sh`).
- The database API creates LOGIN users only and sets no attribute or membership: `rw_resolve` (NOLOGIN) and `grant rw_resolve to rw_owner` are made by `scripts/roles.mjs` as `rw_admin`, which also refuses to finish if `rw_app` or `rw_maint` can bypass RLS (PostgreSQL 16 lets only a BYPASSRLS role change that attribute: it is checked, not set). `db/roles.sql` stays the reference for a plain PostgreSQL. The privilege levels are none, readonly, readwrite, all: `rw_owner` gets `all` (CREATE, for the schemas it owns), `rw_app` and `rw_maint` get `readonly`, the smallest level that carries CONNECT (its table rights apply to the schema `public`, which the service does not use); everything in the schema `rw` comes from `db/grants.sql`, applied by `scripts/migrate.mjs` as `rw_owner`. Once those grants exist, the hoster reports the level of `rw_app` and `rw_maint` as `custom`, and the provider 2.88.0 writes the reported level into `permission`: a plan proposed `custom -> readonly` (seen on 2026-11-10, after the first `roles` and `migrate`). The provider documents that apply as reapplying the preset to all objects, existing and new; it is not applied: the two privileges carry `lifecycle { ignore_changes = [permission] }`, so OpenTofu sets `readonly` when it creates them and leaves the level alone afterwards. The cost, accepted: a later change of the level of these two users, at the hoster or in `main.tf`, does not show in a plan. What is checked instead, at each deploy, before the service switches: `roles` (before `migrate`) checks the roles' attributes (no superuser, no BYPASSRLS, no CREATEROLE or CREATEDB) and CONNECT; `grants` (after `migrate`: `scripts/operator-call.sh grants`, under `rw_owner`) compares what `rw_app` and `rw_maint` may do in effect (their own grants, those of PUBLIC, those of a role they are members of) on every table of the schemas `rw` and `rw_meta`, USAGE and CREATE on those two schemas, and CONNECT and CREATE on the database, with the grant lines of `db/schema.snapshot.txt`, and fails when there is one more or one fewer; its line in the gateway's log names the tables, roles and privileges that differ (the first four of each kind), never a row. The comparison reads the tables and schemas in the service database (`RW_DATABASE`, `runward_hosted`), and a catalog is read only from a session on its own database. It runs as `rw_owner`, whose URL names that database and who holds `all` on it; it was a flag of `roles`, under `rw_admin`, until 2026-11-11, and stopped two deploys that day. Run 42930736032: the administrator's URL names the hoster's default database `rdb` (`infra/scaleway/main.tf`), where the schema `rw` does not exist, and a catalog read there found no table (68 lines "fewer"). Run 43018993884: given a session of its own on the service database, `rw_admin` was refused by the server, `permission denied for database "runward_hosted"`: the hoster lets a user connect only to a database it holds a privilege on, and `rw_admin` holds none on the service database. It is given none: `roles` reads and changes what the whole server shares and works from `rdb`. The gesture refuses to compare anywhere else: a URL that names another database than `RW_DATABASE` is refused before any connection, a session that is not on it before the catalog is read, both with `nothing compared, refused`, never a count; a role that cannot connect is said as `cannot connect to the service database runward_hosted as <role>`. `roles` takes no argument: a call with `'{"grants":true}'` is answered 400 (`error=arguments`) and runs nothing. `isolation` then checks that no row crosses between the two witness tenants, under `rw_app`. Not checked: the schema `public` and any other schema (the hoster's preset applies there; the service has nothing there), functions and sequences, and TEMPORARY on the database (`roles` reads it and says it, without failing). Whether the hoster's preset reaches the tables of `rw` at all has not been observed. A deploy stopped by this comparison is read in the gateway's log, then settled by a change to `db/grants.sql` and a redeploy: `migrate` applies that file as `rw_owner` at every deploy, so a `revoke` added there removes what is in excess, and a missing grant comes back with `migrate` alone. A table or schema grant is changed only from a session on the service database, which `rw_admin` cannot open; no gesture of the gateway runs an ad hoc `revoke`. Never by changing the snapshot to fit the base. `rw_owner` has no such rule: its level stays `all`, and a plan that shows it otherwise is to be read, not applied.
- TLS: the clients use `DATABASE_SSL=verify-full` with `DATABASE_CA`, the instance certificate (attribute `certificate`, public). Read after phase 1 (2026-11-08): self-signed, subject `CN=172.16.16.2`, SAN `DNS:172.16.16.2` and `IP:172.16.16.2` (and a second, public, IP address of the hoster), valid to 2036-11-05; verify-full by the private IP holds, `database_host` stays empty.

## 12. The author's gestures

- Approve each paid resource above (done for the budget on 2026-11-06; phase 1 applied on 2026-11-08), then let a session apply phase 2 with the first image (sequence below).
- Create the bucket's key (an IAM application restricted to Object Storage in the project `runward`) and store it in the keychain by masked input (§9's script): service `runward-hosted-s3`, accounts `access-key-id` and `secret-access-key`. Phase 2 refuses to plan without it.
- Give the CI's key (the secret `SCW_SECRET_KEY` of the environment `production`, reserved to `main`) ContainerRegistryFullAccess, ContainersFullAccess and ContainersPrivateAccess in the project `runward` (the last can carry the condition `resource.name == "runward-hosted-operator"`).
- Publish the first release of this repository (its SHA becomes `RW_SEND_WORKFLOW_SHAS`).
- The passkey ceremonies, in a real browser: the founder's link (`npm run operateur:amorcage` on the author's workstation draws the link and prints the `scripts/operator-call.sh open-bootstrap` command that opens it; run that command, then open the link and create the passkey), the second passkey (a security key or another manager), a sign-in, a per-gesture verification (declare with consent), a removal then a restore of a passkey.

**The first deploy** (the chicken and the egg: the containers must exist before `deploy.yml` updates them, and an image must exist before OpenTofu creates them; no image is built on a workstation). A session does each step, after the author's two gestures above:

1. The operator's token, drawn once, never shown: into the keychain and into the environment `production`, its sha256 kept for OpenTofu.
   ```sh
   t=$(openssl rand -hex 32)
   printf 'add-generic-password -U -s runward-hosted-operator -a token -w %s\n' "$t" | security -i
   printf %s "$t" | gh secret set RW_OPERATOR_TOKEN --env production -R stranxik/runward-hosted
   printf %s "$t" | shasum -a 256 | cut -d' ' -f1 > "$HOME/Desktop/Thibault_Souris_Architecture/08_Runward/app-hebergee/infra-etat/operator-token.sha256"; unset t
   ```
2. With this branch merged and its ci run green: `gh workflow run push-image.yml -R stranxik/runward-hosted --ref main`, then read the digest in the run summary (`gh run view <id> -R stranxik/runward-hosted --log | grep 'image:'`).
3. Phase 2, plan then apply (secrets as in "Applying" below, plus the phase 2 variables): `-var image=<digest> -var operator_token_sha256=$(cat .../operator-token.sha256)`; `app_domain` stays false.
4. The repository's variables from the outputs: `gh variable set SCW_CONTAINER_ID`, `SCW_OPERATOR_CONTAINER_ID`, `RW_OPERATOR_URL` (value: `https://` + output `operator_endpoint`), `RW_SERVICE_HOST` (value: the output `service_endpoint`, a bare host name: the service's default hostname at the hoster, which the smoke sends as `Host`, §7; `deploy.yml` builds nothing while it is empty).
5. The first gestures through the gateway, from the workstation (the hoster's barrier with the provisioning key, which needs ContainersPrivateAccess if ContainersFullAccess does not carry it: an HTTP 403 says so; the gateway's with the token): `roles`, then `migrate`, each answering 200 (`scripts/operator-call.sh roles`, `scripts/operator-call.sh migrate`, with `SCW_SECRET_KEY`, `RW_OPERATOR_TOKEN` read from the keychain and `RW_OPERATOR_URL`). Then a call without `X-Auth-Token` must be refused by the hoster (ADR-0016, "what would settle it").
6. The CNAME `app.runward.dev` to the output `service_endpoint` at the DNS host; once `dig app.runward.dev @1.1.1.1` answers it, apply again with `-var app_domain=true`.
7. The two witness tenants (`open-bootstrap` with `witness` and a `tenant` id drawn on the workstation, through the gateway: its answer names no tenant, §8), those two ids in `witness_tenants`, applied, the first release's SHA in `send_workflow_shas`; then `gh variable set RW_DEPLOY_ENABLED --body true`. From then on, a push to `main` deploys (§7): the gateway first, `roles`, `migrate` and `grants`, the service, the smoke, the real send, `isolation`, the purge of the registry beyond the 5 newest images.

**Applying** (a session, from `infra/scaleway`, every secret read from the keychain by name inside the command, never printed): the state lives in `08_Runward/app-hebergee/infra-etat/` of the author's architecture folder, outside any repository.

```sh
export SCW_DEFAULT_PROJECT_ID=5c163e0e-8183-42b7-af90-0c4c84777bb0 SCW_DEFAULT_ORGANIZATION_ID=f1312bed-68f2-4374-9e4e-083eef000e1f
k() { security find-generic-password -s "$1" -a "$2" -w | tr -d '\n'; }
run() { TF_VAR_state_passphrase="$(k runward-hosted-tofu state-passphrase)" \
  SCW_ACCESS_KEY="$(k scaleway-runward access-key)" SCW_SECRET_KEY="$(k scaleway-runward secret-key)" \
  TF_VAR_db_password_admin="$(k runward-hosted-db admin)" TF_VAR_db_password_rw_owner="$(k runward-hosted-db rw_owner)" \
  TF_VAR_db_password_rw_app="$(k runward-hosted-db rw_app)" TF_VAR_db_password_rw_maint="$(k runward-hosted-db rw_maint)" \
  tofu "$@"; }
run init -reconfigure -backend-config="path=$HOME/Desktop/Thibault_Souris_Architecture/08_Runward/app-hebergee/infra-etat/terraform.tfstate"
run plan -out="$HOME/Desktop/Thibault_Souris_Architecture/08_Runward/app-hebergee/infra-etat/phase1.tfplan"
run apply "$HOME/Desktop/Thibault_Souris_Architecture/08_Runward/app-hebergee/infra-etat/phase1.tfplan"   # ephemeral values are passed again
```

After phase 1: no public endpoint (`run state show scaleway_rdb_instance.rw | grep -c load_balancer` gives 0), the certificate's names (§11, TLS), and the four passwords absent from the state (`grep -c -F` of each keychain value on the decrypted `run show -json` gives 0). Phase 2 adds `-var image=<digest>`, `-var operator_token_sha256=<sha256>`, `TF_VAR_container_db_password` (keychain `runward-hosted-db` / `rw_app`), `TF_VAR_operator_db_password_admin`, `TF_VAR_operator_db_password_rw_owner`, `TF_VAR_operator_db_password_rw_maint` (keychain `runward-hosted-db` / `admin`, `rw_owner`, `rw_maint`), `TF_VAR_s3_access_key_id` and `TF_VAR_s3_secret_access_key` (keychain `runward-hosted-s3`); it refuses to plan, naming what is missing, without any of them. A password rotation: new values in the keychain, then `-var credentials_version=<n+1>`.

**A plan after `roles` and `migrate` proposes nothing** when nothing was changed on purpose. Two changes it proposed on 2026-11-10, and why it no longer should (a plan that shows either again is read before anything is applied): `permission = "custom" -> "readonly"` on the privileges of `rw_app` and `rw_maint` (§11: ignored after creation, the grants of `db/grants.sql` are not the hoster's to reset), and `memory_limit_bytes = 536000000 -> 536870912` on both containers (`main.tf` now holds 536000000, the value the hoster stores; it is still compared at each plan).

## 13. A rehearsal of a deploy's first gestures, on a throwaway stack (the hand-over's redone task)

What it proves: that someone who did not build this repository can, from this runbook alone, create the roles and migrate through the operator's gateway, start the service on PostgreSQL, open the two witness tenants, run the isolation suite and the daily chain check through the gateway, read the service's health, trace one request by its id, find a decision in the ADRs, and stop everything. It is the sequence of §12 step 5 and step 7 and of §7's isolation, on a stack that costs nothing and holds no real secret: every token and identifier below is drawn for the run, then thrown away. It rehearses locally the gestures that §12 step 5 and step 7 run against the hoster; ADR-0016 is settled only by those calls against the hoster, at the first deploy. Note, for each step, its verdict line, how long it took, and every place where you had to guess: the record is committed as `runward/redone-task.md` and pointed to from `runward/handover.md` §2.

**Prerequisites**: a checkout of this repository at the commit to rehearse, `npm ci` done; Node.js 22, bash, curl, jq and openssl; a throwaway PostgreSQL 16 or 17 that you may destroy, reachable without TLS, trusting connections without a password, its address in `PG` (host:port). Where Docker runs, for example: `docker run -d --rm --name rw-rehearsal -p 127.0.0.1:55432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres@sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac` (the digest of `ci.yml`), then `PG=127.0.0.1:55432`. If the steps themselves run in a container (for example `node:22`), put it and the server on one Docker network, start the server without `-p`, and set `PG=rw-rehearsal:5432`: `docker network create rw-rehearsal-net`, `docker run -d --rm --name rw-rehearsal --network rw-rehearsal-net -e POSTGRES_HOST_AUTH_METHOD=trust postgres@sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac`, `docker run -d --name rw-rehearsal-node --network rw-rehearsal-net -v rw-rehearsal-work:/work -w /work node:22 sleep infinity`, then `docker exec -it rw-rehearsal-node bash`, and inside it clone this repository at the commit and run `npm ci`; `jq` is not in the `node:22` image (`apt-get update && apt-get install -y jq` inside it), and on a host with SELinux the checkout is mounted with `:Z`. Run every step from the repository's root, in one bash shell. To time each step, define first `LAP=$(node -p 'Date.now()'); lap() { local n; n=$(node -p 'Date.now()'); echo "step $1: $((n - LAP)) ms"; LAP=$n; }` and run `lap <n>` after each step.

1. **The database and the three login roles**, as the server's superuser (what the hoster's API did at phase 1; `db/roles.sql` is the reference). One statement per call: `create database` cannot share a transaction.
   ```sh
   sql() { node --input-type=module -e 'import postgres from "postgres"; const s = postgres(process.argv[1], { onnotice: () => {} }); try { await s.unsafe(process.argv[2]); console.log("ok"); } finally { await s.end(); }' "postgres://postgres@$PG/postgres" "$1"; }
   sql "create database runward_hosted"
   sql "create role rw_owner login"; sql "create role rw_app login nobypassrls"; sql "create role rw_maint login nobypassrls"
   sql "grant create, connect on database runward_hosted to rw_owner"; sql "grant connect on database runward_hosted to rw_app, rw_maint"
   ```
   Verify: each call prints `ok`. (`rw_resolve` is not created here: the `roles` gesture makes it, step 4.)
2. **This run's operator token and the two witness tenants' ids**, drawn here, used nowhere else:
   ```sh
   R=$(mktemp -d); T=$(openssl rand -hex 32)
   TH=$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$T")
   W1=$(node -p 'crypto.randomUUID()'); W2=$(node -p 'crypto.randomUUID()')
   echo ${#TH} ${#W1}
   ```
   Verify: `64 36`.
3. **The operator's gateway** (the private container of ADR-0016, here a local process): its four role URLs point at the throwaway server, the superuser standing in for `rw_admin`; its bucket does not exist (no gesture of this rehearsal touches the object store).
   ```sh
   env NODE_ENV=development PORT=8090 DATABASE_SSL=disable RW_DATABASE=runward_hosted RW_ORIGIN=http://localhost:8787 \
     RW_WITNESS_TENANTS="$W1,$W2" RW_OPERATOR_TOKEN_SHA256="$TH" \
     RW_OPERATOR_URL_ADMIN="postgres://postgres@$PG/runward_hosted" RW_OPERATOR_URL_OWNER="postgres://rw_owner@$PG/runward_hosted" \
     RW_OPERATOR_URL_MAINT="postgres://rw_maint@$PG/runward_hosted" RW_OPERATOR_URL_APP="postgres://rw_app@$PG/runward_hosted" \
     S3_ENDPOINT=https://s3.invalid S3_REGION=fr-par S3_BUCKET=rehearsal S3_ACCESS_KEY_ID=rehearsal S3_SECRET_ACCESS_KEY=rehearsal \
     node src/operator-gateway.js > "$R/gateway.log" 2>&1 & GW=$!
   for i in $(seq 50); do curl -s -o /dev/null http://127.0.0.1:8090/health && break; sleep 0.2; done; curl -s http://127.0.0.1:8090/health; echo
   ```
   Verify: `{"ok":true}`.
4. **The two first gestures of a deploy**, through the gateway (§8, §12 step 5):
   ```sh
   export SCW_SECRET_KEY=rehearsal RW_OPERATOR_TOKEN="$T" RW_OPERATOR_URL=http://127.0.0.1:8090
   scripts/operator-call.sh roles
   scripts/operator-call.sh migrate
   RW_OPERATOR_TOKEN=wrong scripts/operator-call.sh migrate; echo "exit $?"
   ```
   Verify: `operator-call: roles answered HTTP 200 (gesture=roles ok=true exit=0)`, the same line for `migrate`, then `operator-call: migrate answered HTTP 401 (error=refused)` and `exit 1`.
5. **The service, on PostgreSQL** (its objects in memory: this rehearsal sends no export):
   ```sh
   env NODE_ENV=development PORT=8787 RW_ORIGIN=http://localhost:8787 RW_EXTRA_HOSTS=127.0.0.1 RW_COMMIT=rehearsal \
     DATABASE_URL="postgres://rw_app@$PG/runward_hosted" DATABASE_SSL=disable RW_OBJECTS=memory \
     node src/main.js > "$R/service.log" 2>&1 & SV=$!
   for i in $(seq 50); do curl -s -o /dev/null http://127.0.0.1:8787/api/health && break; sleep 0.2; done; head -1 "$R/service.log" | jq -c '{event, detail: {store: .detail.store, objects: .detail.objects}}'
   ```
   Verify: `{"event":"start","detail":{"store":"postgres","objects":"memory"}}`.
6. **Observe** (§10):
   ```sh
   curl -s http://127.0.0.1:8787/api/health | jq -c '{ok, store, db, dailyJobs}'
   curl -s http://127.0.0.1:8787/api/version | jq -c '{commit, indexFormat, fleet: .views.runwardFleet}'
   ```
   Verify: `{"ok":true,"store":"postgres","db":"ok","dailyJobs":{"retention":{"lastRun":null,"ok":null},"verify-chains":{"lastRun":null,"ok":null}}}`, then `{"commit":"rehearsal","indexFormat":"runward-fleet-index/0","fleet":"0.46.0"}`.
7. **The two witness tenants** (§12 step 7), their ids from step 2; each link's digest is drawn at random, so the links open nothing:
   ```sh
   for W in "$W1" "$W2"; do scripts/operator-call.sh open-bootstrap "{\"hash\":\"$(openssl rand -hex 32)\",\"tenant\":\"$W\",\"witness\":true,\"title\":\"Rehearsal\"}"; done
   ```
   Verify: two lines `operator-call: open-bootstrap answered HTTP 200 (gesture=open-bootstrap ok=true exit=0)`, and nothing else printed: no tenant, no link.
8. **The isolation suite on this base**, as after each deploy (§7, S4), then the gateway's own line for it:
   ```sh
   scripts/operator-call.sh isolation
   grep '"event":"operator.gesture"' "$R/gateway.log" | tail -1 | jq -c '{status, role: .detail.role, exit: .detail.exit}'
   ```
   Verify: `operator-call: isolation answered HTTP 200 (gesture=isolation ok=true exit=0)`, then `{"status":200,"role":"rw_app","exit":0}`. What `exit=0` covers (`scripts/isolation-deployed.mjs`): from each witness, the 13 tenant tables held no row of the other, a write naming the other was refused, and `rw_app` does not bypass RLS. The suite exits 2, not 0, when the witnesses hold no row at all, so a 0 cannot come from an empty base.
9. **The daily chain check, by the schedule's path** (no token, as the hoster's trigger calls it), then read on the service:
   ```sh
   curl -s -X POST http://127.0.0.1:8090/scheduled/verify-chains; echo
   curl -s http://127.0.0.1:8787/api/health | jq -c '.dailyJobs["verify-chains"]'
   ```
   Verify: `{"gesture":"verify-chains","ok":true,"exit":0}`, then `{"lastRun":"<the time of the run>","ok":true}`.
10. **Trace one request by its id** (§10):
    ```sh
    RID=$(curl -s -X POST http://127.0.0.1:8787/api/v0/exports | jq -r .requestId); echo "$RID"
    grep -c "\"requestId\":\"$RID\"" "$R/service.log"; grep "\"requestId\":\"$RID\"" "$R/service.log" | jq -c '{status, refusal}'
    ```
    Verify: an id `r-` and 12 hex, `1`, then `{"status":401,"refusal":"token-missing"}`.
11. **A decision, from the ADRs alone**: why may the hoster's schedule call `/scheduled/verify-chains` without the operator's token, and what observation would reverse that? Answer from `runward/adr/` only, naming the record and its section.
    Verify: your answer names one record and two of its sections, and quotes the sentence that gives the reason and the one that names what would reverse it. There is no key in this runbook: the record's reviewer checks the answer against the ADRs.
12. **Stop everything**:
    ```sh
    kill "$SV" "$GW"; wait "$SV" "$GW"; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/health
    rm -r "$R"; ls "$R" 2>/dev/null | wc -l
    ```
    Verify: `000` (nothing answers any more), then `0`. Then drop the throwaway server (`docker stop rw-rehearsal`); in the container variant, also the steps' container, its volume and the network (`docker rm -f -v`, `docker volume rm`, `docker network rm`), and the images pulled for the run if you want them gone (`docker rmi`).

## 14. Rerun the evaluation

The service calls no model: its evaluation bench is its test pyramid and the six measures of the framing note (S1 to S6, on the deployed service only).

- **Unit, application and HTTP**: `npm test` (in memory; from the author's Mac the suites run on the NAS: `scripts/on-nas.sh 'npm test'`; on a Linux host with Docker: `scripts/reference-env.sh 'npm test'`, which brings jq).
- **PostgreSQL**: `scripts/on-nas.sh 'npm run test:pg'` from the author's Mac, or `scripts/reference-env.sh 'npm run test:pg'` on a Linux host with Docker: both start a throwaway PostgreSQL 17 at the digest of `ci.yml`, set `PG_ADMIN_URL`, and remove the server with its volume (isolation, catalog, planted controls, the schema snapshot, the statement deadline, the daily jobs' outcome).
- **The committed reports**: `scripts/on-nas.sh 'npm run test:reports'` says whether `reports/` still describes the tree; `scripts/on-nas.sh -r 'npm run test:reports:write'` rewrites them in the reference environment (Linux, Node.js 22, PostgreSQL 17 at the digest of `ci.yml`, jq) and brings them back: the report lands in `reports/junit.xml`, `reports/eslint.json`, `reports/eslint-security.sarif`, `reports/secretlint.sarif`.
- **The gate**: `npx -y runward@0.46.0 check --strict` (CI runs the same version, integrity checked).
- **S1 to S6**: `temoin.yml` (S1, daily), the probe (availability), `deploy.yml`'s run summary (S5, the time to roll back).

## 15. Process a suspended approval

One environment holds a run until a person approves it today: `production` in this repository (a deploy). The environment `operateur` of the private repository `stranxik/runward-hosted-ops` (a bootstrap, a recovery, a reset of access, maintenance) is planned; on 2026-11-10 that repository is empty, and those gestures run from the author's workstation (§8). The commands below name the private repository; for a deploy, read `-R stranxik/runward-hosted`. The approver is the author, alone (ADR-0010); a run nobody approves expires, and nothing happens.

- **Where they wait**: `gh run list -R stranxik/runward-hosted-ops --status waiting` (and `-R stranxik/runward-hosted` for a deploy).
- **What is asked**: `gh api repos/stranxik/runward-hosted-ops/actions/runs/<run id>/pending_deployments -q '.[] | {environment: .environment.name, id: .environment.id}'`; read the run's inputs (`gh run view <run id> -R stranxik/runward-hosted-ops`) before approving: a digest of a link, a tenant, a member.
- **Approve** (the author's gesture, from the run's page, Review deployments, or): `gh api -X POST repos/stranxik/runward-hosted-ops/actions/runs/<run id>/pending_deployments -F 'environment_ids[]=<id>' -f state=approved -f comment='<why>'`; `state=rejected` refuses it.
- **Verify**: the run goes on (`gh run watch <run id> -R stranxik/runward-hosted-ops`), and its log says the gesture's status and code (§8).

## 16. A restore drill, on a throwaway stack

What it proves: that after the database is replaced by a backup, `restore-replay` (§3, §8) puts the accesses back where the security log of the object store says they were. Three tenants are opened and used through the real service (passkey ceremonies verified by the real WebAuthn library, sessions, access gestures written to the object store), a backup is taken at an instant T, more access gestures happen after T, each tenant's head is anchored in the object store while the database can still be read, the database is dropped and restored from the backup, then the gesture runs through the operator's gateway and its effects are read: the sessions closed, the gestures after T replayed in ULID order (an access reset among them), the note in each tenant's journal with the range of the entries lost, the chains, the isolation. It is the drill §3 asks for before the floor is declared. Every token, key and identifier is drawn for the run, then thrown away. Each step ends with `lap <n>`, which prints how long the step took: note it with the step's verdict line.

**Prerequisites**: a checkout of this repository at the commit to drill, `npm ci` done; Node.js 22, bash, curl, jq, openssl, and `psql`, `pg_dump`, `pg_restore` of PostgreSQL 17; a throwaway PostgreSQL 17 that you may destroy, reachable without TLS, trusting connections without a password, its address in `PG` (host:port); a throwaway S3 that you may destroy, its address in `S3`, **on `127.0.0.1` or `localhost`**: the service's only way out refuses plain http to any other host (`src/adapters/system/egress.js`). Where Docker runs, the two servers at the digests of `ci.yml`: `docker network create rw-drill-net`, `docker run -d --name rw-drill-pg --network rw-drill-net -e POSTGRES_HOST_AUTH_METHOD=trust postgres@sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac`, `docker run -d --name rw-drill-s3 --network rw-drill-net chrislusf/seaweedfs@sha256:bb05d66d2963b1cc48073190781c3dd29e2c4c88a2ae2986bf58e38c86d89c6e server -s3 -dir=/data` (SeaweedFS checks no credential). If the steps themselves run in a container, start it in the S3's network namespace, so that `127.0.0.1` is the S3 and the PostgreSQL answers by its name: `docker run -d --name rw-drill-node --network container:rw-drill-s3 -v rw-drill-work:/work -w /work node:22 sleep infinity`, clone and `npm ci` inside it, then `PG=rw-drill-pg:5432` and `S3=http://127.0.0.1:8333`. In the `node:22` image, jq and the PostgreSQL 17 client are installed with `apt-get update && apt-get install -y jq postgresql-common && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y && apt-get install -y postgresql-client-17`. Run every step from the repository's root, in one bash shell.

**The drill's client** (`scripts/drill-client.mjs`): curl cannot answer a passkey ceremony, so this file stands for the browser and its authenticator. It keeps its keys and session cookies in `$R`, the run's throwaway directory, and prints `{"status":…,"body":…}` for each call.

1. **The run's directory and its helpers**:
   ```sh
   R=$(mktemp -d); export R
   LAP=$(node -p 'Date.now()'); START=$LAP
   lap() { local n; n=$(node -p 'Date.now()'); echo "step $1: $((n - LAP)) ms"; LAP=$n; }
   sql() { psql -X -q -At -v ON_ERROR_STOP=1 "postgres://postgres@$PG/${2:-runward_hosted}" -c "$1"; }
   h() { node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' -- "$1"; }
   d() { node scripts/drill-client.mjs "$@"; }
   s() { d "$@" | jq -r '.status' | tr '\n' ' '; }
   seclog() { node --input-type=module -e 'import { s3Objects } from "./src/adapters/objects/objects.js"; const e = process.env; const o = s3Objects({ endpoint: e.S3_ENDPOINT, region: e.S3_REGION, bucket: e.S3_BUCKET, accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY, fetch }); console.log((await o.securitySince(process.argv[1], process.argv[2] ?? "")).map((x) => x.event.what).join(" "))' "$@"; }
   state() { sql "select t.title, (select count(*) from rw.passkey where tenant_id = t.id and removed_at is null), (select count(*) from rw.session where tenant_id = t.id and closed_at is null), (select max(seq) from rw.ledger where tenant_id = t.id) from rw.tenant t order by t.title"; }
   heads() { sql "select t.title, l.seq, l.hash from rw.tenant t join rw.ledger l on l.tenant_id = t.id where l.seq = (select max(seq) from rw.ledger where tenant_id = t.id) order by t.title"; }
   test -d "$R" && node --check scripts/drill-client.mjs && echo "client ok"; lap 1
   ```
   Verify: `client ok`, then `step 1: … ms`. `sql` is the drill's observer: the server's superuser, who reads across tenants; no gesture of the service or of the operator uses it. `state` prints, per tenant: its title, its live passkeys, its open sessions, the seq of its journal's head. `h` gives its argument to node after `--`: a link token is base64url and one in sixty-four begins with `-`, which node would read as an option of its own (the digest then comes out empty and the tenant is never opened).
2. **The database, the three login roles, the bucket, this run's tokens and identifiers** (§13 steps 1 and 2; here the object store is real):
   ```sh
   until pg_isready -q -d "postgres://postgres@$PG/postgres" && curl -s -o /dev/null "$S3"; do sleep 1; done
   sql "create database runward_hosted" postgres
   sql "create role rw_owner login; create role rw_app login nobypassrls; create role rw_maint login nobypassrls" postgres
   sql "grant create, connect on database runward_hosted to rw_owner; grant connect on database runward_hosted to rw_app, rw_maint" postgres
   export NODE_ENV=development DATABASE_SSL=disable RW_DATABASE=runward_hosted RW_ORIGIN=http://localhost:8787
   export S3_ENDPOINT="$S3" S3_REGION=us-east-1 S3_BUCKET="rw-drill-$(openssl rand -hex 3)" S3_ACCESS_KEY_ID=drill S3_SECRET_ACCESS_KEY="$(openssl rand -hex 16)"
   node --input-type=module -e 'import { AwsClient } from "aws4fetch"; const e = process.env; const a = new AwsClient({ accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY, service: "s3", region: e.S3_REGION }); console.log("bucket", (await a.fetch(`${e.S3_ENDPOINT}/${e.S3_BUCKET}`, { method: "PUT" })).status)'
   T=$(openssl rand -hex 32); TH=$(h "$T")
   W1=$(node -p 'crypto.randomUUID()'); W2=$(node -p 'crypto.randomUUID()'); W3=$(node -p 'crypto.randomUUID()')
   link() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '='; }
   LA=$(link); LB=$(link); LC=$(link)
   sql "select count(*) from pg_roles where rolname in ('rw_owner', 'rw_app', 'rw_maint')" postgres; echo ${#TH} ${#W1} ${#LA}; lap 2
   ```
   Verify: `bucket 200`, `3`, `64 36 43`. The first line waits for the two servers: a SeaweedFS just started refuses connections for twenty seconds or more, and a bucket that was not created makes it accept every write and return none (the service starts, the gestures pass, and `restore-replay` is refused `security-log-unreadable` at step 10, before it writes anything). On anything but `bucket 200`, stop here.
3. **The operator's gateway, then the two first gestures of a deploy** (§13 steps 3 and 4): the gateway holds the bucket's key, which `restore-replay` writes the anchors and reads the security log with.
   ```sh
   env PORT=8090 RW_WITNESS_TENANTS="$W1,$W2" RW_OPERATOR_TOKEN_SHA256="$TH" \
     RW_OPERATOR_URL_ADMIN="postgres://postgres@$PG/runward_hosted" RW_OPERATOR_URL_OWNER="postgres://rw_owner@$PG/runward_hosted" \
     RW_OPERATOR_URL_MAINT="postgres://rw_maint@$PG/runward_hosted" RW_OPERATOR_URL_APP="postgres://rw_app@$PG/runward_hosted" \
     node src/operator-gateway.js > "$R/gateway.log" 2>&1 & GW=$!
   for i in $(seq 50); do curl -s -o /dev/null http://127.0.0.1:8090/health && break; sleep 0.2; done; curl -s http://127.0.0.1:8090/health; echo
   export SCW_SECRET_KEY=drill RW_OPERATOR_TOKEN="$T" RW_OPERATOR_URL=http://127.0.0.1:8090
   scripts/operator-call.sh roles; scripts/operator-call.sh migrate; lap 3
   ```
   Verify: `{"ok":true}`, then `operator-call: roles answered HTTP 200 (gesture=roles ok=true exit=0)` and the same line for `migrate`.
4. **The service, on PostgreSQL and on the object store**:
   ```sh
   serve() { env PORT=8787 RW_EXTRA_HOSTS=127.0.0.1 RW_COMMIT=drill DATABASE_URL="postgres://rw_app@$PG/runward_hosted" node src/main.js >> "$R/service.log" 2>&1 & SV=$!; for i in $(seq 50); do curl -s -o /dev/null http://127.0.0.1:8787/api/health && break; sleep 0.2; done; }
   serve; head -1 "$R/service.log" | jq -c '{event, detail: {store: .detail.store, objects: .detail.objects}}'
   curl -s http://127.0.0.1:8787/api/health | jq -c '{ok, db, objectStore}'; lap 4
   ```
   Verify: `{"event":"start","detail":{"store":"postgres","objects":"s3"}}`, then `{"ok":true,"db":"ok","objectStore":"ok"}`.
5. **Three tenants**, opened through the gateway: the two witnesses of the isolation suite (A, B) and a third (C). Each founder's link is drawn here; only its digest is passed.
   ```sh
   scripts/operator-call.sh open-bootstrap "{\"hash\":\"$(h "$LA")\",\"tenant\":\"$W1\",\"witness\":true,\"title\":\"drill-a\"}"
   scripts/operator-call.sh open-bootstrap "{\"hash\":\"$(h "$LB")\",\"tenant\":\"$W2\",\"witness\":true,\"title\":\"drill-b\"}"
   scripts/operator-call.sh open-bootstrap "{\"hash\":\"$(h "$LC")\",\"tenant\":\"$W3\",\"title\":\"drill-c\"}"; lap 5
   ```
   Verify: three lines `operator-call: open-bootstrap answered HTTP 200 (gesture=open-bootstrap ok=true exit=0)`. On any other line, stop here: a tenant that was not opened makes every later step read two tenants.
6. **Activity before T, through the service**. A: a founder with three passkeys (A1, A2, A3), two sessions (a1 opened by A1, a2 by A2), a repository declared with consent. B: a founder with two passkeys, one session, a repository. C: a founder with one passkey, one session.
   ```sh
   s open a1 "$LA" A1; s verify a1 A1 passkey-add; A2=$(d addkey a1 A2 | jq -r '.body.id'); s verify a1 A1 passkey-add; A3=$(d addkey a1 A3 | jq -r '.body.id')
   s signin a2 A2; s verify a1 A1 declare-with-consent drill/alpha; RA=$(d call a1 POST /api/v0/repositories '{"name":"drill/alpha","consent":true}' | jq -r '.body.id'); echo
   s open b1 "$LB" B1; s verify b1 B1 passkey-add; s addkey b1 B2; RB=$(d call b1 POST /api/v0/repositories '{"name":"drill/beta"}' | jq -r '.body.id'); s open c1 "$LC" C1; echo
   echo ${#A2} ${#A3} ${#RA} ${#RB}; state
   for W in "$W1" "$W2" "$W3"; do seclog "$W"; done; lap 6
   ```
   Verify: `200 200 200 200 200`, `200 200 200 200`, `36 36 36 36`; then the state `drill-a|3|2|7`, `drill-b|2|1|4`, `drill-c|1|1|2`; then what the object store holds for each tenant, in ULID order: `member-founded passkey-added passkey-added consent-given`, `member-founded passkey-added`, `member-founded`.
7. **T: the backup**. `SINCE` is the ULID of T: the ten characters of its time, then sixteen zeros, so that every gesture written from T on sorts after it. T is taken before the dump starts (a gesture between T and the dump's snapshot is in both the backup and the replay, and replaying it changes nothing); the two seconds stand for the margin a real backup's hour is known with.
   ```sh
   sleep 1; T_MS=$(node -p 'Date.now()')
   SINCE=$(node -e 'const B = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; let t = BigInt(process.argv[1]), s = ""; for (let i = 0; i < 10; i++) { s = B[Number(t%32n)] + s; t /= 32n; } console.log(s + "0".repeat(16))' "$T_MS")
   sleep 1; pg_dump -Fc -d "postgres://postgres@$PG/runward_hosted" -f "$R/backup.dump"
   echo ${#SINCE}; pg_restore -l "$R/backup.dump" | grep -c 'TABLE DATA rw ledger'; lap 7
   ```
   Verify: `26`, `1`.
8. **Activity after T**, which the restore will lose in the database and the object store will keep. A: A2 removed (its session a2 closes with it) then restored, A3 removed for good, the consent withdrawn, a fourth passkey added then removed, a third session opened. B: its repository removed, then its session signed out. C: its access reset by the operator (the founder and the passkey withdrawn).
   ```sh
   s verify a1 A1 passkey-remove "$A2"; s call a1 DELETE "/api/v0/passkeys/$A2"; s verify a1 A1; s call a1 POST "/api/v0/passkeys/$A2/restore"
   s verify a1 A1 passkey-remove "$A3"; s call a1 DELETE "/api/v0/passkeys/$A3"; s verify a1 A1 consent-withdraw "$RA"; s call a1 DELETE "/api/v0/repositories/$RA/consent"
   s verify a1 A1 passkey-add; A4=$(d addkey a1 A4 | jq -r '.body.id'); s verify a1 A1 passkey-remove "$A4"; s call a1 DELETE "/api/v0/passkeys/$A4"; s signin a3 A1; echo
   s verify b1 B1; s call b1 DELETE "/api/v0/repositories/$RB"; s call b1 POST /api/v0/auth/logout; echo
   scripts/operator-call.sh reset-access "{\"hash\":\"$(openssl rand -hex 32)\",\"tenant\":\"$W3\"}"
   state; heads > "$R/heads-before.txt"
   for W in "$W1" "$W2" "$W3"; do seclog "$W" "$SINCE"; done; lap 8
   ```
   Verify: `200 200 200 200 200 200 200 200 200 200 200 200`, `200 200 200`, `operator-call: reset-access answered HTTP 200 (gesture=reset-access ok=true exit=0)`; then the state before the loss `drill-a|2|2|14`, `drill-b|2|0|6`, `drill-c|0|0|3`; then what the object store holds after `SINCE`, in ULID order: `passkey-removed passkey-restored passkey-removed consent-withdrawn passkey-added passkey-removed`, `repository-removed`, `access-reset`.
9. **The anchor, then the loss: the database is replaced by the backup**. The service is stopped first and stays stopped until step 14: a restore needs every connection closed, and between the restore and the replay a withdrawn passkey signs in again (maintenance refuses a session's writes, never a sign-in). While the database can still be read, `restore-replay` with `anchor` writes the head of each tenant's journal to that tenant's security log in the object store, which the restore does not touch (§3): the replay reads it back as the head before the loss. It appends nothing to a journal.
   ```sh
   kill "$SV"; wait "$SV"
   scripts/operator-call.sh restore-replay '{"anchor":true}'
   for W in "$W1" "$W2" "$W3"; do seclog "$W" "$SINCE" | tr ' ' '\n' | tail -1; done; heads | diff - "$R/heads-before.txt" && echo "heads unchanged"
   sql "drop database runward_hosted with (force)" postgres
   pg_restore --create -d "postgres://postgres@$PG/postgres" "$R/backup.dump"; echo "pg_restore exit $?"
   state; sql "select 'A3 removed: ' || (removed_at is not null) from rw.passkey where id = '$A3'"; lap 9
   ```
   Verify: `operator-call: restore-replay answered HTTP 200 (gesture=restore-replay ok=true exit=0)`, three lines `journal-anchored` (the last object of each tenant's log) and `heads unchanged`; then `pg_restore exit 0`; the state of T is back, `drill-a|3|2|7`, `drill-b|2|1|4`, `drill-c|1|1|2`, and `A3 removed: false`: the restore alone has resurrected what was withdrawn after T.
10. **`restore-replay`**, through the gateway (§3, §8). It takes the instant of the backup and no head: each tenant's head before the loss is the one anchored at step 9, read from that tenant's own log.
    ```sh
    scripts/operator-call.sh restore-replay "{\"since\":\"$SINCE\"}"; lap 10
    ```
    Verify: `operator-call: restore-replay answered HTTP 200 (gesture=restore-replay ok=true exit=0)`. On any other answer, read the reason (`grep '"event":"operator.gesture"' "$R/gateway.log" | tail -1 | jq -r '.error'`), leave the service stopped, and go to step 17: the drill has shown a restore that does not replay. A refusal `security-log-unreadable` wrote nothing to any tenant; a tenant whose replay failed is rolled back whole and named in the operator journal, the others are replayed, and the same gesture run again replays every tenant.
11. **What the replay did**, read by the observer: no session left open; in each tenant's journal, one more entry, `restore-replayed`, with how many sessions it closed and how many gestures it replayed; the accesses as the object store said.
    ```sh
    sql "select count(*) from rw.session where closed_at is null"
    sql "select t.title, l.seq, l.body->>'what', l.body->'detail'->>'closed', l.body->'detail'->>'replayed', jsonb_array_length(l.body->'detail'->'stranded') from rw.tenant t join rw.ledger l on l.tenant_id = t.id where l.seq = (select max(seq) from rw.ledger where tenant_id = t.id) order by t.title"
    sql "select 'A2 removed: ' || (removed_at is not null) from rw.passkey where id = '$A2'"; sql "select 'A3 removed: ' || (removed_at is not null) from rw.passkey where id = '$A3'"
    sql "select name, consent, removed_at is not null from rw.repository order by name"
    sql "select what, jsonb_array_length(detail->'report'), detail->>'failed' from rw.operator_journal order by seq desc limit 1"
    sql "select t.title, r->>'memberless', r->'stranded' from rw.operator_journal o cross join lateral jsonb_array_elements(o.detail->'report') r join rw.tenant t on t.id = (r->>'tenant')::uuid where o.seq = (select max(seq) from rw.operator_journal where what = 'restore-replayed') order by t.title"; lap 11
    ```
    Verify: `0`; `drill-a|8|restore-replayed|2|4|0`, `drill-b|5|restore-replayed|1|1|0`, `drill-c|3|restore-replayed|1|1|0` (the access reset is replayed); `A2 removed: false` and `A3 removed: true`; `drill/alpha|f|f` (the consent withdrawn again) and `drill/beta|f|t` (removed again); `restore-replayed|3|0` (the operator journal's note, one row per tenant, no failure); then what the operator reads to act: `drill-a|false|[]`, `drill-b|false|[]`, `drill-c|true|[]`: tenant C is left without a member, its bootstrap is opened again at step 15. A2 is the proof of the order: it was removed, then restored; replayed the other way round it would end removed. Of A's six gestures after `SINCE`, four are replayed: the fourth passkey, added after T, is not in the restored database, so neither its addition nor its removal applies.
12. **The note in each tenant's journal, against what §3 says of it** ("restore of …: entries lost between seq … and …"). The drill computes the lost range itself, from the heads the observer noted at step 8, then prints what each note carries: its seq, the range, the seq of the restored head and of the head before the loss; then the note's fields; then whether each note carries the head of its own tenant.
    ```sh
    join -t'|' <(heads | cut -d'|' -f1,2) <(cut -d'|' -f1,2 "$R/heads-before.txt") | awk -F'|' '{ printf "%s: the note is seq %d; the entries %d to %d of before the loss are gone\n", $1, $2, $2, $3 }'
    sql "select t.title, l.seq, l.body->'detail'->'lost'->>'from', l.body->'detail'->'lost'->>'to', l.body->'detail'->'lost'->>'count', l.body->'detail'->'headAfterRestore'->>'seq', l.body->'detail'->'headBefore'->>'seq' from rw.tenant t join rw.ledger l on l.tenant_id = t.id where l.body->>'what' = 'restore-replayed' order by t.title"
    sql "select string_agg(k, ' ' order by k) from jsonb_object_keys((select body->'detail' from rw.ledger where body->>'what' = 'restore-replayed' limit 1)) k"
    sql "select t.title, l.body->'detail'->'headBefore'->>'hash' from rw.tenant t join rw.ledger l on l.tenant_id = t.id where l.body->>'what' = 'restore-replayed' order by t.title" | diff - <(cut -d'|' -f1,3 "$R/heads-before.txt") && echo "each note carries the head of its own tenant"
    sql "select count(distinct body->'detail'->'headBefore'->>'hash') from rw.ledger where body->>'what' = 'restore-replayed'"; lap 12
    ```
    Verify: `drill-a: the note is seq 8; the entries 8 to 14 of before the loss are gone`, `drill-b: the note is seq 5; the entries 5 to 6 of before the loss are gone`, `drill-c: the note is seq 3; the entries 3 to 3 of before the loss are gone`. Then what the notes carry, which must be the same ranges: `drill-a|8|8|14|7|7|14`, `drill-b|5|5|6|2|4|6`, `drill-c|3|3|3|1|2|3` (the note's seq, `lost.from`, `lost.to`, `lost.count`, the seq of the restored head, the seq of the head before the loss). Then the fields `closed headAfterRestore headBefore lost replayed since stranded`, then `each note carries the head of its own tenant` and `3` (three tenants, three heads). Without the anchor of step 9 the note says `headBefore` null and the range open (`lost.to` null): the head before the loss is said unknown, never taken on the operator's word.
13. **The chains, after the replay** (§3):
    ```sh
    scripts/operator-call.sh verify-chains
    sql "select detail->>'failed', (select string_agg((r->>'ok') || ' ' || (r->'head'->>'seq'), ', ' order by (r->'head'->>'seq')::int desc) from jsonb_array_elements(detail->'report') r) from rw.operator_journal where what = 'verify-chains' order by seq desc limit 1"; lap 13
    ```
    Verify: `operator-call: verify-chains answered HTTP 200 (gesture=verify-chains ok=true exit=0)`, then `0|true 8, true 5, true 3`: each chain holds from its first entry to the note.
14. **The service again, and the accesses as a person meets them**: the sessions of before the loss are closed, whether the backup held them (a1) or not (a3); the passkey withdrawn after T opens nothing; the one removed then restored signs in; the journal shows the note; the consent and the removal are as they were left.
    ```sh
    serve
    d call a1 GET /api/v0/session | jq -c '[.status,.body.refusal]'; d call a3 GET /api/v0/session | jq -c '[.status,.body.refusal]'
    d signin x A3 | jq -c '[.status,.body.refusal]'; d signin x A4 | jq -c '[.status,.body.refusal]'
    d signin a5 A2 | jq -c '[.status,.body.signedIn]'; d signin a4 A1 | jq -c '[.status,.body.signedIn]'
    d call a4 GET /api/v0/journal | jq -c '.body.entries[] | select(.body.what == "restore-replayed") | {seq, what: .body.what, who: .body.who.id}'
    d call a4 GET /api/v0/access | jq -c '.body.repositories[] | {name, consent}'
    d signin b2 B1 | jq -c '[.status,.body.signedIn]'; d call b2 GET /api/v0/access | jq -c '.body.repositories[] | {name, state}'; lap 14
    ```
    Verify: `[401,"signed-out"]` twice, `[401,"passkey-unknown"]` twice, `[200,true]` twice, `{"seq":8,"what":"restore-replayed","who":"operateur"}`, `{"name":"drill/alpha","consent":false}`, `[200,true]`, `{"name":"drill/beta","state":"removed"}`.
15. **Tenant C: an access reset after T**. The operator withdrew the founder and the passkey at step 8, and the object store holds `access-reset` after `SINCE`. What §3 and T24 promise is that the restore does not give that access back. The bootstrap the reset had opened is gone with the restore (the backup never held it): the operator opens one again, and the rightful founder arrives.
    ```sh
    d signin c2 C1 | jq -c '[.status,(.body.refusal//.body.signedIn)]'
    c_state() { sql "select t.title, (select count(*) from rw.member where tenant_id = t.id and removed_at is null), (select count(*) from rw.passkey where tenant_id = t.id and removed_at is null) from rw.tenant t where t.title = 'drill-c'"; }
    c_state
    LC2=$(link); scripts/operator-call.sh open-bootstrap "{\"hash\":\"$(h "$LC2")\",\"tenant\":\"$W3\"}"
    s open c3 "$LC2" C2; echo; d signin c4 C1 | jq -c '[.status,(.body.refusal//.body.signedIn)]'; c_state; lap 15
    ```
    Verify: `[401,"passkey-unknown"]` and `drill-c|0|0`: the passkey the reset withdrew opens nothing, the tenant has no member. Then `operator-call: open-bootstrap answered HTTP 200 (gesture=open-bootstrap ok=true exit=0)`, `200`, `[401,"passkey-unknown"]` again and `drill-c|1|1`: the tenant is opened again by a new founder, the withdrawn passkey still opens nothing. A line `[200,true]` on the first or the fourth of these, or `drill-c|1|1` on the second, is the defect of 2026-11-10 (`restore-replay` did not replay `access-reset`): the floor is not declared on it.
16. **The isolation, on the restored and replayed base** (§7, S4), and the health as the probe reads it:
    ```sh
    scripts/operator-call.sh isolation
    curl -s http://127.0.0.1:8787/api/health | jq -c '{ok, db, objectStore, verifyChains: .dailyJobs["verify-chains"].ok}'; lap 16
    ```
    Verify: `operator-call: isolation answered HTTP 200 (gesture=isolation ok=true exit=0)`, then `{"ok":true,"db":"ok","objectStore":"ok","verifyChains":true}`.
17. **Stop everything, and the total**:
    ```sh
    kill "$SV" "$GW"; wait "$SV" "$GW"; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/health
    echo "total: $(( $(node -p 'Date.now()') - START )) ms"; rm -r "$R"; ls "$R" 2>/dev/null | wc -l
    ```
    Verify: `000`, `total: … ms`, `0`. Then drop the throwaway servers, their volumes and their network (`docker rm -f -v rw-drill-node rw-drill-s3 rw-drill-pg; docker volume rm rw-drill-work; docker network rm rw-drill-net`) and check that nothing is left: `docker ps -a --filter name=rw-drill -q | wc -l` and `docker volume ls -q --filter name=rw-drill | wc -l` both print `0`. The images pulled for the run stay on the host unless removed with `docker rmi`.

**What the time means**: steps 9 and 10 are the restore itself (the base replaced, then the replay) on three small tenants; the hoster's own restore of a managed backup replaces `pg_restore` in production and is not timed here. **What the drill does not exercise**, and what does: an erasure of content after T (the object store has lost bytes the restored database still counts) is replayed in `test/pg/restore-replay.test.js` and `test/unit/restore-replay.test.js`; a recovery redeemed after T, a bootstrap redeemed after T, `--recovery-hash` for a member left without a passkey, a tenant whose replay fails and a security log that cannot be read are in `test/unit/restore-replay.test.js` (a recovery is usable 24 hours after it opens, which a drill does not wait for). The replay empties again the index versions built from content erased after T, on request or by the retention pass, which writes the same event (ADR-0020; `test/pg/restore-replay.test.js`, its retention case); a tenant whose last version is one of them has no served index until its next gesture or upload publishes one.

## References

ADR-0007, ADR-0008, ADR-0010, ADR-0016; `runward/governance/threat-model.md`; `runward/governance/observability-schema.md`; `runward/handover.md`.
