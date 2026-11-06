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

Prices excluding tax, from the framing note §8 (Scaleway pricing pages read on 2026-11-06; each amount is confirmed in the console before creation).

| Resource | Setting | Monthly cost |
|---|---|---|
| Managed Database for PostgreSQL | DB-DEV-S (2 vCPU, 2 GB), one node, no HA, daily backups kept 7 days, private network | about 11.40 EUR (0.0156 EUR per hour), plus storage and backups at 0.03 EUR per GB |
| Serverless Containers, fr-par | 0.25 vCPU, 512 MB, scale 0 to 1 | about 0 EUR within the monthly free tier (200 000 vCPU-s, 400 000 GB-s); about 6.50 EUR if the minimum scale becomes 1 |
| Object Storage | Standard, no versioning, a few MB | under 0.10 EUR |
| Container Registry | private namespace, a few images of 100 to 200 MB | under 0.10 EUR |
| Serverless Jobs | retention, chain check, operator gestures, isolation suite: seconds a day | to confirm, cents |
| Cockpit (logs) | the products' own logs | to confirm, free or cents |
| Domain | `app.runward.dev`, DNS only | 0 EUR |
| **Total** | | **about 12 to 19 EUR a month**; budget approved 20 EUR, alert at 15 EUR |
| One-off: restore drill | a throwaway DB-DEV-S for a few hours | cents |

## 12. The author's gestures

- Approve each paid resource above, then create it (or let a session create it after that approval).
- Set `vars.RW_DEPLOY_ENABLED`, `vars.SCW_CONTAINER_ID`, `vars.SCW_ISOLATION_JOB_ID`, the secret `SCW_SECRET_KEY` of the environment `production` (reserved to `main`), and later `vars.RW_PROBE_ENABLED`, `vars.RW_READER_ENABLED`, `vars.RW_READER_FLEETS`.
- Publish the first release of this repository (its SHA becomes `RW_SEND_WORKFLOW_SHAS`).
- The passkey ceremonies, in a real browser: the founder's link (`npm run operateur:amorcage`, approve the run, open the link, create the passkey), the second passkey (a security key or another manager), a sign-in, a per-gesture verification (declare with consent), a removal then a restore of a passkey.

## References

ADR-0007, ADR-0008, ADR-0010; `runward/governance/threat-model.md`.
