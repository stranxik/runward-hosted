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

- Deploy: a push to `main` with `vars.RW_DEPLOY_ENABLED == 'true'`; `.github/workflows/deploy.yml` deploys by digest only after the ci run of that commit is green: first the operator's gateway, which runs `roles` and `migrate` (ADR-0016), then the service; it checks the served revision of each at the hoster (S5) and that their environment was merged, not replaced, then `/api/version`, the smoke, the real send workflow to the witness tenant, the isolation suite on the deployed base (through the gateway), and purges the registry beyond the 5 newest images (never a digest served or named for rollback); any failure redeploys the previous digest on both containers.
- Roll back by hand: `gh workflow run rollback.yml --repo stranxik/runward-hosted -f digest=rg.fr-par.scw.cloud/runward/runward-hosted@sha256:<digest of a green deploy>`; it rolls back the service only (the gateway keeps the newest code; migrations are expansion only), waits for `/api/version` and writes the time it took in the run summary.
- Migrations are expansion only, so the previous image runs on the new schema: a rollback never needs a down migration.

## 8. Operator gestures (the closed list)

All run inside the hoster's private network through the operator's gateway (ADR-0016): a private Serverless Container of the same image, one authenticated call per gesture, each run under its own database role. From the CI, from the private repository `stranxik/runward-hosted-ops` (environment `operateur`) or from the author's workstation: `scripts/operator-call.sh <gesture> '<json args>'` with `SCW_SECRET_KEY` (the hoster's barrier), `RW_OPERATOR_TOKEN` (the gateway's) and `RW_OPERATOR_URL` (output `operator_endpoint`). The token of a link is drawn on the author's workstation (`npm run operateur:amorcage`, `npm run operateur:reprise -- --tenant <id> --member <id>`); only its sha256 is passed. The gateway's arguments are the commands' flags in camelCase, for example `scripts/operator-call.sh open-bootstrap '{"hash":"<sha256>","witness":true}'`.

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

`SCW_SECRET_KEY` (environment `production` of this repository, reserved to `main`), `RW_OPERATOR_TOKEN` (same environment; keychain `runward-hosted-operator` / `token`; the gateway holds only its sha256), the database roles' passwords and the S3 keys (secret variables of the two containers). Rotation of the Scaleway key: create the new key, set it in the environment, run a deploy, revoke the old key. A value is put in the macOS keychain by masked input only: `security add-generic-password -U -s <service> -a <account> -w`.

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

**Phase 2** (when `image` names a real digest; 5 more resources, then the domain):

| Resource | Setting | Monthly cost |
|---|---|---|
| Serverless Container `runward-hosted` (the service) | 0.25 vCPU, 512 MiB, scale 0 to 1, public, in the private network | about 0 EUR within the monthly free tier (200 000 vCPU-s, 400 000 GB-s); about 6.50 EUR if the minimum scale becomes 1 |
| Serverless Containers namespace `runward-hosted-operator` and container `runward-hosted-operator` (the operator's gateway, ADR-0016) | 0.25 vCPU, 512 MiB, scale 0 to 1, **private**, in the private network, request timeout 900 s | about 0 EUR (a few minutes a day, within the same free tier) |
| Two scheduled triggers of the gateway | `retention` 03:23 and `verify-chains` 03:37, time zone `Europe/Paris` | 0 EUR |
| Domain `app.runward.dev` | container domain, applied with `-var app_domain=true` once the CNAME resolves | 0 EUR |
| Cockpit (logs) | the products' own logs | to confirm, free or cents |
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
- Create the bucket's key (an IAM application restricted to Object Storage in the project `runward`) and store it in the keychain by masked input: service `runward-hosted-s3`, accounts `access-key-id` and `secret-access-key`. Phase 2 refuses to plan without it.
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
7. The two witness tenants (`open-bootstrap` with `witness`, through the gateway), `witness_tenants` set and applied, the first release's SHA in `send_workflow_shas`; then `gh variable set RW_DEPLOY_ENABLED --body true`. From then on, a push to `main` deploys (§7): the gateway first, `roles` and `migrate`, the service, the smoke, the real send, `isolation`, the purge of the registry beyond the 5 newest images.

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

## References

ADR-0007, ADR-0008, ADR-0010; `runward/governance/threat-model.md`.
