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
- **Migrate** (as `rw_owner`, never the service): `MIGRATE_URL=postgres://rw_owner@<host>/<db> node scripts/migrate.mjs`. Expansion only: a file that drops, renames or truncates is refused.
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
- **The journal**: `verify-chains` (daily at the hoster, 03:37 Paris, through the gateway) checks every tenant's chain and writes its report to the operator's journal; `/api/health` says whether its last run completed (§10).
- **A restore of the database** (PADR-0014 note, T24): restore the day's backup; then `scripts/operator-call.sh restore-replay '{"since":"<ULID of the backup's time>","headBefore":"<head before>"}'` (§8); it closes every session of every tenant, replays the access gestures from the object store in ULID order, writes "restore of …: entries lost between seq … and …" to each tenant's journal, and opens a recovery for a member left without a passkey when `--recovery-hash` is given. Drill it once before declaring the floor, on a throwaway instance, timed.

## 4. Common incidents

| Symptom | Error type | Diagnosis | Action |
|---|---|---|---|
| the send job says "not sent: service unavailable" | transient | `/api/health`, the probe issue | re-run the job; the upload is idempotent per run, attempt, mission and kind |
| an upload "not accepted" with a code | validation | the code, message and action in the job summary and in Envois | follow the action named |
| an index not published (quarantine) | business | the journal entry names the field | fix the export or wait for the runward-fleet update |
| the probe opened "service unavailable" | unavailable | the hoster console, the container logs by request id | redeploy the last green digest (below) |
| the probe's issue says "the daily job retention (or verify-chains) did not complete" | job | the gateway's log line `operator.gesture` at the hour of the run (Cockpit, Serverless Containers logs, container `runward-hosted-operator`): how many tenants, and the first reason; the tenant itself is named only in the operator journal, in the database | re-run it: `scripts/operator-call.sh retention` (or `verify-chains`), both idempotent; a broken chain is an incident of its own (T10): do not re-run until the entry is understood |
| the probe's issue says "has not run since" | job | the triggers of the container `runward-hosted-operator` in the console (`retention` 03:23, `verify-chains` 03:37, Europe/Paris) | run it by hand as above, then check the triggers |
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
- **Promoting a new model (earned)**: not applicable; the analogue is a new runward-fleet version, pinned by a new ADR and replayed (ADR-0002, ADR-0018): at a commit `<c>` of runward's `main`, `git -C <runward checkout> checkout <c> && npm pack ./packages/runward-fleet` (twice: the same sha256), the tarball into `vendor/runward-fleet-<version>-<c8>.tgz`, `vendor/runward-fleet.lock.json` (commit, tarball, sha256, integrity, and the previous pin with why it moved) and `package.json` / `package-lock.json` (`npm install ./vendor/<tarball>`) changed together; then `node scripts/verify-runward-fleet.mjs` (every file against GitHub), `node --test test/unit/repositories.test.js` (the export replays byte for byte) and the views' text (`test/unit/http.test.js`); a new ADR that refines ADR-0018.
- **Rollback**: redeploy the previous digest (section 7).

## 7. Deploy and roll back

- Deploy: a push to `main` with `vars.RW_DEPLOY_ENABLED == 'true'`; `.github/workflows/deploy.yml` deploys by digest only after the ci run of that commit is green: first the operator's gateway, which runs `roles` and `migrate` (ADR-0016), then the service; it checks the served revision of each at the hoster (S5) and that their environment was merged, not replaced, then `/api/version`, the smoke, the real send workflow to the witness tenant, the isolation suite on the deployed base (through the gateway), and purges the registry beyond the 5 newest images (never a digest served or named for rollback); any failure redeploys the previous digest on both containers.
- Roll back by hand: `gh workflow run rollback.yml --repo stranxik/runward-hosted -f digest=rg.fr-par.scw.cloud/runward/runward-hosted@sha256:<digest of a green deploy>`; it rolls back the service only (the gateway keeps the newest code; migrations are expansion only), waits for `/api/version` and writes the time it took in the run summary.
- Migrations are expansion only, so the previous image runs on the new schema: a rollback never needs a down migration.

## 8. Operator gestures (the closed list)

All run inside the hoster's private network through the operator's gateway (ADR-0016): a private Serverless Container of the same image, one authenticated call per gesture, each run under its own database role. From the CI or from the author's workstation (the private repository `stranxik/runward-hosted-ops` and its environment `operateur` are planned; on 2026-11-10 the repository is empty): `scripts/operator-call.sh <gesture> '<json args>'` with `SCW_SECRET_KEY` (the hoster's barrier), `RW_OPERATOR_TOKEN` (the gateway's) and `RW_OPERATOR_URL` (output `operator_endpoint`). The token of a link is drawn on the author's workstation (`npm run operateur:amorcage`, `npm run operateur:reprise -- --tenant <id> --member <id>`); only its sha256 is passed. The gateway's arguments are the commands' flags in camelCase, for example `scripts/operator-call.sh open-bootstrap '{"hash":"<sha256>","witness":true}'`.

**What comes back is a status and a code** (the gateway answers the HTTP status and `{ gesture, ok, exit }`, or `{ error: <code> }` with refused, not-found, arguments, not-json, too-large or busy), and `scripts/operator-call.sh` prints one line made of those fields only, for example `operator-call: migrate answered HTTP 200 (gesture=migrate ok=true exit=0)`: its output lands in a GitHub runner's log, outside the private network. A gesture's result (a tenant, a link, a report, a head) is written to the operator journal in the database, never returned. So a gesture that creates a tenant takes the tenant's id from its caller: draw it on the workstation (`node -p 'crypto.randomUUID()'`) and pass it as `tenant`. The reason of a refusal or of a failure is in the gateway's log line at the hoster (Cockpit, Serverless Containers logs, container `runward-hosted-operator`), bounded and without identifiers.

| Gesture | Role | Command (what the gateway runs) |
|---|---|---|
| roles (before the first migration, and at each deploy) | `rw_admin` | `node scripts/roles.mjs` |
| migrate (each deploy, before the service switches) | `rw_owner` | `node scripts/migrate.mjs` |
| isolation (each deploy, after the smoke) | `rw_app` | `node scripts/isolation-deployed.mjs` |

| Gesture (role `rw_maint`) | Command |
|---|---|
| open a bootstrap | `open-bootstrap --hash <sha256> [--tenant <id>] [--witness] [--title <text>]` |
| open a recovery | `open-recovery --hash <sha256> --tenant <id> --member <id>` |
| reset a tenant's access | `reset-access --hash <sha256> --tenant <id>` |
| maintenance | `maintenance --on --until <iso> --reason <text>` / `maintenance --off` |
| retention (daily, 03:23 Paris, trigger) | `retention` |
| chain check (daily, 03:37 Paris, trigger) | `verify-chains` |
| after a restore | `restore-replay --since <ulid>` |

## 9. Secrets

`SCW_SECRET_KEY` (environment `production` of this repository, reserved to `main`), `RW_OPERATOR_TOKEN` (same environment; keychain `runward-hosted-operator` / `token`; the gateway holds only its sha256), the database roles' passwords and the S3 keys (secret variables of the two containers). Rotation of the Scaleway key: create the new key, set it in the environment, run a deploy, revoke the old key.

A value the author types or pastes is put in the macOS keychain by masked input, in a terminal of its own, with the author's script: `~/.claude/skills/autonomie/scripts/ranger-secret.sh <service> <account> [pattern]` (the optional pattern, an extended regular expression, is what the value must match). It reads the value with `read -rs`, hands it to `security -i` on standard input (never in a command line, a history or a process list), reads it back and shows only its length, its equality with what was typed and its match with the pattern. Never `security add-generic-password … -w` at its masked prompt: it cuts the value at 128 characters without a word (measured on 2026-11-06 with a 300-character token). Check a value without showing it: `security find-generic-password -s <service> -a <account> -w | tr -d '\n' | wc -c` (the length only, compared with the expected one), then one real call that uses it. A value drawn by a session (`openssl rand`) goes the same way, by standard input (§12, step 1).

## 10. Watching

The hourly probe (`.github/workflows/probe.yml`, on when `vars.RW_PROBE_ENABLED == 'true'`) opens an issue after two failures in a row, and comments on it each hour with its verdict until the cause is gone: the service unavailable, an error rate above 5 % over five minutes, or a daily job that did not complete or has not run for more than 26 hours; the witness reader (`temoin.yml`) publishes S1 daily; the billing alert at 15 EUR is set in the console.

- **Is it healthy?** `curl -s https://app.runward.dev/api/health | jq .`: `ok`, `db`, `objectStore`, `maintenance`, `errors` (the last five minutes), `dailyJobs` (`lastRun`, `ok` for `retention` and `verify-chains`; null before a first run). The probe's history: `gh run list -R stranxik/runward-hosted --workflow probe.yml`, each run's summary holding its verdict.
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
| Serverless Container `runward-hosted` (the service) | 0.25 vCPU, 512 MiB, scale 0 to 1, public, in the private network | about 0 EUR within the monthly free tier (200 000 vCPU-s, 400 000 GB-s); about 6.50 EUR if the minimum scale becomes 1 |
| Serverless Containers namespace `runward-hosted-operator` and container `runward-hosted-operator` (the operator's gateway, ADR-0016) | 0.25 vCPU, 512 MiB, scale 0 to 1, **private**, in the private network, request timeout 900 s | about 0 EUR (a few minutes a day, within the same free tier) |
| Two scheduled triggers of the gateway | `retention` 03:23 and `verify-chains` 03:37, time zone `Europe/Paris` | 0 EUR |
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
- The database API creates LOGIN users only and sets no attribute or membership: `rw_resolve` (NOLOGIN) and `grant rw_resolve to rw_owner` are made by `scripts/roles.mjs` as `rw_admin`, which also refuses to finish if `rw_app` or `rw_maint` can bypass RLS (PostgreSQL 16 lets only a BYPASSRLS role change that attribute: it is checked, not set). `db/roles.sql` stays the reference for a plain PostgreSQL. The privilege levels are none, readonly, readwrite, all: `rw_owner` gets `all` (CREATE, for the schemas it owns), `rw_app` and `rw_maint` get `readonly`, the smallest level that carries CONNECT (its table rights apply to the schema `public`, which the service does not use); everything in the schema `rw` comes from `db/grants.sql`, applied by `scripts/migrate.mjs` as `rw_owner`.
- TLS: the clients use `DATABASE_SSL=verify-full` with `DATABASE_CA`, the instance certificate (attribute `certificate`, public). Read after phase 1 (2026-11-08): self-signed, subject `CN=172.16.16.2`, SAN `DNS:172.16.16.2` and `IP:172.16.16.2` (and a second, public, IP address of the hoster), valid to 2036-11-05; verify-full by the private IP holds, `database_host` stays empty.

## 12. The author's gestures

- Approve each paid resource above (done for the budget on 2026-11-06; phase 1 applied on 2026-11-08), then let a session apply phase 2 with the first image (sequence below).
- Create the bucket's key (an IAM application restricted to Object Storage in the project `runward`) and store it in the keychain by masked input (§9's script): service `runward-hosted-s3`, accounts `access-key-id` and `secret-access-key`. Phase 2 refuses to plan without it.
- Give the CI's key (the secret `SCW_SECRET_KEY` of the environment `production`, reserved to `main`) ContainerRegistryFullAccess, ContainersFullAccess and ContainersPrivateAccess in the project `runward` (the last can carry the condition `resource.name == "runward-hosted-operator"`).
- Publish the first release of this repository (its SHA becomes `RW_SEND_WORKFLOW_SHAS`).
- The passkey ceremonies, in a real browser: the founder's link (`npm run operateur:amorcage`, approve the run, open the link, create the passkey), the second passkey (a security key or another manager), a sign-in, a per-gesture verification (declare with consent), a removal then a restore of a passkey.

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
4. The repository's variables from the outputs: `gh variable set SCW_CONTAINER_ID`, `SCW_OPERATOR_CONTAINER_ID`, `RW_OPERATOR_URL` (value: `https://` + output `operator_endpoint`).
5. The first gestures through the gateway, from the workstation (the hoster's barrier with the provisioning key, which needs ContainersPrivateAccess if ContainersFullAccess does not carry it: an HTTP 403 says so; the gateway's with the token): `roles`, then `migrate`, each answering 200 (`scripts/operator-call.sh roles`, `scripts/operator-call.sh migrate`, with `SCW_SECRET_KEY`, `RW_OPERATOR_TOKEN` read from the keychain and `RW_OPERATOR_URL`). Then a call without `X-Auth-Token` must be refused by the hoster (ADR-0016, "what would settle it").
6. The CNAME `app.runward.dev` to the output `service_endpoint` at the DNS host; once `dig app.runward.dev @1.1.1.1` answers it, apply again with `-var app_domain=true`.
7. The two witness tenants (`open-bootstrap` with `witness` and a `tenant` id drawn on the workstation, through the gateway: its answer names no tenant, §8), those two ids in `witness_tenants`, applied, the first release's SHA in `send_workflow_shas`; then `gh variable set RW_DEPLOY_ENABLED --body true`. From then on, a push to `main` deploys (§7): the gateway first, `roles` and `migrate`, the service, the smoke, the real send, `isolation`, the purge of the registry beyond the 5 newest images.

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

## 13. A rehearsal of a deploy's first gestures, on a throwaway stack (the hand-over's redone task)

What it proves: that someone who did not build this repository can, from this runbook alone, create the roles and migrate through the operator's gateway, start the service on PostgreSQL, open the two witness tenants, run the isolation suite and the daily chain check through the gateway, read the service's health, trace one request by its id, find a decision in the ADRs, and stop everything. It is the sequence of §12 step 5 and step 7 and of §7's isolation, on a stack that costs nothing and holds no real secret: every token and identifier below is drawn for the run, then thrown away. It rehearses locally the gestures that §12 step 5 and step 7 run against the hoster; ADR-0016 is settled only by those calls against the hoster, at the first deploy. Note, for each step, its verdict line, how long it took, and every place where you had to guess: the record is committed as `runward/redone-task.md` and pointed to from `runward/handover.md` §2.

**Prerequisites**: a checkout of this repository at the commit to rehearse, `npm ci` done; Node.js 22, bash, curl, jq and openssl; a throwaway PostgreSQL 16 or 17 that you may destroy, reachable without TLS, trusting connections without a password, its address in `PG` (host:port). Where Docker runs, for example: `docker run -d --rm --name rw-rehearsal -p 127.0.0.1:55432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine`, then `PG=127.0.0.1:55432`. If the steps themselves run in a container (for example `node:22`), put it and the server on one Docker network, start the server without `-p`, and set `PG=rw-rehearsal:5432`; `jq` is not in the `node:22` image (`apt-get update && apt-get install -y jq` inside it), and on a host with SELinux the checkout is mounted with `:Z`. Run every step from the repository's root, in one bash shell.

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
   sleep 1; curl -s http://127.0.0.1:8090/health; echo
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
   sleep 1; head -1 "$R/service.log" | jq -c '{event, detail: {store: .detail.store, objects: .detail.objects}}'
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
    ```
    Verify: `000` (nothing answers any more); then drop the throwaway server (`docker stop rw-rehearsal`) and `rm -r "$R"`.

## 14. Rerun the evaluation

The service calls no model: its evaluation bench is its test pyramid and the six measures of the framing note (S1 to S6, on the deployed service only).

- **Unit, application and HTTP**: `npm test` (in memory, no Docker; on the author's Mac, the suites run on the NAS: `~/.claude/skills/nas/scripts/verifier-sur-nas.sh . 'npm test'`).
- **PostgreSQL**: `PG_ADMIN_URL=postgres://postgres@<a throwaway server>/postgres npm run test:pg` (isolation, catalog, planted controls, the schema snapshot, the statement deadline, the daily jobs' outcome).
- **The committed reports**: `npm run test:reports` says whether `reports/` still describes the tree; `npm run test:reports:write` rewrites them, in the reference environment only (Linux, Node.js 22, PostgreSQL 17 at the digest of `ci.yml`, jq): the report lands in `reports/junit.xml`, `reports/eslint.json`, `reports/eslint-security.sarif`, `reports/secretlint.sarif`.
- **The gate**: `npx -y runward@0.46.0 check --strict` (CI runs the same version, integrity checked).
- **S1 to S6**: `temoin.yml` (S1, daily), the probe (availability), `deploy.yml`'s run summary (S5, the time to roll back).

## 15. Process a suspended approval

One environment holds a run until a person approves it today: `production` in this repository (a deploy). The environment `operateur` of the private repository `stranxik/runward-hosted-ops` (a bootstrap, a recovery, a reset of access, maintenance) is planned; on 2026-11-10 that repository is empty, and those gestures run from the author's workstation (§8). The commands below name the private repository; for a deploy, read `-R stranxik/runward-hosted`. The approver is the author, alone (ADR-0010); a run nobody approves expires, and nothing happens.

- **Where they wait**: `gh run list -R stranxik/runward-hosted-ops --status waiting` (and `-R stranxik/runward-hosted` for a deploy).
- **What is asked**: `gh api repos/stranxik/runward-hosted-ops/actions/runs/<run id>/pending_deployments -q '.[] | {environment: .environment.name, id: .environment.id}'`; read the run's inputs (`gh run view <run id> -R stranxik/runward-hosted-ops`) before approving: a digest of a link, a tenant, a member.
- **Approve** (the author's gesture, from the run's page, Review deployments, or): `gh api -X POST repos/stranxik/runward-hosted-ops/actions/runs/<run id>/pending_deployments -F 'environment_ids[]=<id>' -f state=approved -f comment='<why>'`; `state=rejected` refuses it.
- **Verify**: the run goes on (`gh run watch <run id> -R stranxik/runward-hosted-ops`), and its log says the gesture's status and code (§8).

## References

ADR-0007, ADR-0008, ADR-0010, ADR-0016; `runward/governance/threat-model.md`; `runward/governance/observability-schema.md`; `runward/handover.md`.
