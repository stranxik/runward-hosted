# Runbook: runward hosted

**Version**: v0.1 · **Last review**: 2026-11-06 · **Owner**: Thibault Souris

## 1. Startup

- **Prerequisites**: Node.js 22 or later; a PostgreSQL with the four roles (`db/roles.sql`) and the database granted to `rw_owner`; an S3 bucket without versioning; the environment below. Secrets are environment variables only, set at the hoster as secret variables, never in a file.
- **Migrate** (as `rw_owner`, never the service): `MIGRATE_URL=postgres://rw_owner@<host>/<db> node scripts/migrate.mjs`. Expansion only: a file that drops, renames or truncates is refused.
- **Start**: `node src/main.js`, with `DATABASE_URL` (role `rw_app`), `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `RW_ORIGIN`, `RW_COMMIT`, `RW_IMAGE`, `RW_SEND_WORKFLOW_SHAS`. A missing value stops the start with the list of what is missing (exit 78), never a value.
- **Feature detection at boot**: the start line says the store, the objects, the origin, the commit, the runward-fleet version, the egress list and how many send workflow releases are accepted.
- **Health check**: `GET /api/health` (database and object store, maintenance), `GET /api/version` (commit, image, views, API contract, index format, send workflow).
- **Local witness**: `RW_STORE=memory RW_ORIGIN=http://localhost:8787 PORT=8787 node src/main.js` (memory only, refused in production; nothing survives a restart).

## 2. Dependencies and degraded modes

| Dependency | Role | Criticality | Behavior on failure |
|---|---|---|---|
| PostgreSQL | state, journal, isolation | critical | fail-closed on writes (503 `service-unavailable`); reads degraded to a named state; the send job retries 4 times then warns |
| Object store | exports, security log, archives | critical | fail-closed on uploads and access gestures (the security log is written before commit); reads of the index degraded only if the database fails |
| GitHub OIDC keys | upload and reader tokens | critical | fail-closed: `service-unavailable`, retried by the send job |
| The browser's passkeys | sign-in | critical | fallback to the phone by QR code, or another browser, named on screen |

**Transverse rule**: degrade reading, never acting.

## 3. Checkpoints and recovery

- **State model**: the chained journal per tenant is the truth and the audit; the published index is derived from it and the current uploads; the security log in the object store survives a database restore.
- **Recovery**: a restart needs nothing replayed: every state is in PostgreSQL and S3; a dropped upload is re-sent by re-running the client job (idempotent per run, attempt, mission and kind).
- **Replication**: one instance; per-tenant advisory locks already serialise journal appends and publications if a second instance comes.
- **Agent suspended awaiting approval**: no agent; an operator workflow waits for its environment approval, then expires.
- **The journal**: `node src/operator.js verify-chains` (daily at the hoster) checks every tenant's chain and writes its report to the operator's journal.
- **A restore of the database** (PADR-0014 note, T24): restore the day's backup; then `node src/operator.js restore-replay --since <ULID of the backup's time> --head-before <head before>`; it closes every session of every tenant, replays the access gestures from the object store in ULID order, writes "restore of …: entries lost between seq … and …" to each tenant's journal, and opens a recovery for a member left without a passkey when `--recovery-hash` is given. Drill it once before declaring the floor, on a throwaway instance, timed.

## 4. Common incidents

| Symptom | Error type | Diagnosis | Action |
|---|---|---|---|
| the send job says "not sent: service unavailable" | transient | `/api/health`, the probe issue | re-run the job; the upload is idempotent per run, attempt, mission and kind |
| an upload "not accepted" with a code | validation | the code, message and action in the job summary and in Envois | follow the action named |
| an index not published (quarantine) | business | the journal entry names the field | fix the export or wait for the runward-fleet update |
| the probe opened "service unavailable" | unavailable | the hoster console, the container logs by request id | redeploy the last green digest (below) |
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
- **Promoting a new model (earned)**: not applicable; the analogue is a new runward-fleet version, pinned by a new ADR and replayed (ADR-0002).
- **Rollback**: redeploy the previous digest (section 7).

## 7. Deploy and roll back

- Deploy: a push to `main` with `vars.RW_DEPLOY_ENABLED == 'true'`; `.github/workflows/deploy.yml` deploys by digest only after the ci run of that commit is green, then checks the served revision at the hoster (S5), `/api/version`, the smoke, the real send workflow to the witness tenant, the isolation suite on the deployed base; any failure redeploys the previous digest.
- Roll back by hand: `gh workflow run rollback.yml --repo stranxik/runward-hosted -f digest=rg.fr-par.scw.cloud/runward/runward-hosted@sha256:<digest of a green deploy>`; it waits for `/api/version` and writes the time it took in the run summary.
- Migrations are expansion only, so the previous image runs on the new schema: a rollback never needs a down migration.

## 8. Operator gestures (the closed list)

All run as `node src/operator.js <gesture>` inside the hoster's private network (the same image, a job), started by an approved workflow of the private repository `stranxik/runward-hosted-ops` (environment `operateur`). The token of a link is drawn on the author's workstation (`npm run operateur:amorcage`, `npm run operateur:reprise -- --tenant <id> --member <id>`); only its sha256 is passed.

| Gesture | Command |
|---|---|
| open a bootstrap | `open-bootstrap --hash <sha256> [--tenant <id>] [--witness] [--title <text>]` |
| open a recovery | `open-recovery --hash <sha256> --tenant <id> --member <id>` |
| reset a tenant's access | `reset-access --hash <sha256> --tenant <id>` |
| maintenance | `maintenance --on --until <iso> --reason <text>` / `maintenance --off` |
| retention (daily) | `retention` |
| chain check (daily) | `verify-chains` |
| after a restore | `restore-replay --since <ulid>` |

## 9. Secrets

`SCW_SECRET_KEY` (environment `production` of this repository, reserved to `main`), the database roles' passwords and the S3 keys (secret variables of the container and the jobs). Rotation of the Scaleway key: create the new key, set it in the environment, run a deploy, revoke the old key. A value is put in the macOS keychain by masked input only: `security add-generic-password -U -s <service> -a <account> -w`.

## 10. Watching

The hourly probe (`.github/workflows/probe.yml`, on when `vars.RW_PROBE_ENABLED == 'true'`) opens an issue after two failures in a row; the witness reader (`temoin.yml`) publishes S1 daily; the billing alert at 15 EUR is set in the console.

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

**Phase 2** (when `image` names a real digest; 12 more resources with the jobs):

| Resource | Setting | Monthly cost |
|---|---|---|
| Serverless Container `runward-hosted` | 0.25 vCPU, 512 MiB, scale 0 to 1, public, in the private network | about 0 EUR within the monthly free tier (200 000 vCPU-s, 400 000 GB-s); about 6.50 EUR if the minimum scale becomes 1 |
| Domain `app.runward.dev` | container domain; the CNAME is set at the DNS host | 0 EUR |
| Secret Manager | 2 more secrets (the bucket's key, for the operator jobs) | 0.09 EUR |
| Serverless Jobs `roles`, `migrate`, `retention` (03:23), `verify-chains` (03:37), `operator`, `isolation` | 0.25 vCPU, 512 MB, timeout 900 s; **off** until `jobs_reach_database` (see below) | about 0.01 EUR (0.00001 EUR per vCPU-s) |
| Cockpit (logs) | the products' own logs | to confirm, free or cents |
| **Total** | | **about 12.4 EUR a month** (phase 1 about 12.3 EUR) |
| One-off: restore drill | a throwaway DB-DEV-S for a few hours | cents |

**What the hoster does not allow, as of 2026-11-08:**
- Serverless Jobs cannot join a Private Network (Scaleway's Serverless Jobs FAQ: "does not currently support Scaleway VPC or Private Networks"; no such field in the provider 2.88.0 nor in the jobs API v1alpha2). The database has no public endpoint, so no job can reach it: the jobs stay off (`jobs_reach_database = false`), and `roles` and `migrate`, which must run before the service starts, have no path yet. A decision (ADR) is needed: a private second container in the private network that runs one gesture per authenticated call, a short-lived bastion in the private network, or waiting for the feature. A public database endpoint is not an option.
- A Serverless Container has no Secret Manager reference and no write-only argument: its `DATABASE_URL` (rw_app) and S3 keys are `secret_environment_variables`, kept in the state. The state and the plan are encrypted by OpenTofu (`encryption` block, pbkdf2 + AES-GCM, enforced) and kept outside any repository.
- The database API creates LOGIN users only and sets no attribute or membership: `rw_resolve` (NOLOGIN) and `grant rw_resolve to rw_owner` are made by `scripts/roles.mjs` as `rw_admin`, which also refuses to finish if `rw_app` or `rw_maint` can bypass RLS (PostgreSQL 16 lets only a BYPASSRLS role change that attribute: it is checked, not set). `db/roles.sql` stays the reference for a plain PostgreSQL. The privilege levels are none, readonly, readwrite, all: `rw_owner` gets `all` (CREATE, for the schemas it owns), `rw_app` and `rw_maint` get `readonly`, the smallest level that carries CONNECT (its table rights apply to the schema `public`, which the service does not use); everything in the schema `rw` comes from `db/grants.sql`, applied by `scripts/migrate.mjs` as `rw_owner`.
- TLS: the clients use `DATABASE_SSL=verify-full` with `DATABASE_CA`, the instance certificate (attribute `certificate`, public). Whether it names the private IP (or the private hostname) can be read only once the instance exists: `tofu output -raw database_ca | openssl x509 -noout -subject -issuer -ext subjectAltName,basicConstraints`. If the private IP is absent, set `database_host` to a name the certificate carries, or fall back to checking the CA alone and say so.

## 12. The author's gestures

- Approve each paid resource above (done for the budget on 2026-11-06), then let a session apply phase 1, and phase 2 once the jobs question is decided.
- Give the provisioning key, in the project `runward`, `SecretManagerFullAccess` in addition to the eight sets already granted (ContainerRegistryFullAccess, ContainersFullAccess, IPAMReadOnly, ObjectStorageFullAccess, PrivateNetworksFullAccess, RelationalDatabasesFullAccess, ServerlessJobsFullAccess, VPCFullAccess).
- Create the bucket's key (an IAM application restricted to Object Storage in the project `runward`) and store it in the keychain by masked input: service `runward-hosted-s3`, accounts `access-key-id` and `secret-access-key`. Phase 2 refuses to plan without it.
- Set `vars.RW_DEPLOY_ENABLED`, `vars.SCW_CONTAINER_ID`, `vars.SCW_ISOLATION_JOB_ID`, the secret `SCW_SECRET_KEY` of the environment `production` (reserved to `main`), and later `vars.RW_PROBE_ENABLED`, `vars.RW_READER_ENABLED`, `vars.RW_READER_FLEETS`.
- Publish the first release of this repository (its SHA becomes `RW_SEND_WORKFLOW_SHAS`).
- The passkey ceremonies, in a real browser: the founder's link (`npm run operateur:amorcage`, approve the run, open the link, create the passkey), the second passkey (a security key or another manager), a sign-in, a per-gesture verification (declare with consent), a removal then a restore of a passkey.

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

After phase 1: no public endpoint (`run state show scaleway_rdb_instance.rw | grep -c load_balancer` gives 0), the certificate's names (§11, TLS), and the four passwords absent from the state (`grep -c -F` of each keychain value on the decrypted `run show -json` gives 0). Phase 2 adds `-var image=<digest>`, `TF_VAR_container_db_password` (keychain `runward-hosted-db` / `rw_app`), `TF_VAR_s3_access_key_id` and `TF_VAR_s3_secret_access_key` (keychain `runward-hosted-s3`). A password rotation: new values in the keychain, then `-var credentials_version=<n+1>`.

## References

ADR-0007, ADR-0008, ADR-0010; `runward/governance/threat-model.md`.
