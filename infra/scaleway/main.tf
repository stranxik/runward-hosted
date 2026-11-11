# runward hosted on Scaleway, Paris (PADR-0009, PADR-0015 point 7), project "runward", region fr-par.
# Two phases. Phase 1 (always): the network, the registry, the namespace, the bucket, the database, its
# users and their privileges. Phase 2 (only when `image` names a real digest): the service's container,
# the operator's gateway (a private container in the private network, ADR-0016) and its two scheduled
# triggers, then the domain app.runward.dev once its CNAME resolves (`app_domain`).
# The CI runs `tofu init -backend=false && tofu validate` only; a session applies, after the author's
# approval of the paid resources (runward/runbook.md §11 and §12).
#
# No secret is written here, in the plan or (for phase 1) in the state:
#   - every database password of phase 1 is EPHEMERAL and lands only in WRITE-ONLY arguments
#     (`password_wo`), which OpenTofu (>= 1.11) never records in a plan or a state;
#   - phase 2 is the exception the hoster imposes: a Serverless Container has no secret reference and no
#     write-only argument, so the connection URLs and the S3 keys of the two containers are `sensitive`
#     (not ephemeral) and are kept in the state; the state and the plan are encrypted (block `encryption`,
#     enforced) and live outside any repository (the backend path is given at init, never committed).
#     The operator's token is not among them: the gateway holds only its sha256.
terraform {
  required_version = ">= 1.11.0"
  required_providers {
    scaleway = { source = "scaleway/scaleway", version = "= 2.88.0" }
  }
  # the path is given at init: tofu init -backend-config="path=<folder outside any repository>/terraform.tfstate"
  backend "local" {}

  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }
    state {
      method   = method.aes_gcm.state
      enforced = true
    }
    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}

provider "scaleway" {
  region     = "fr-par"
  zone       = "fr-par-1"
  project_id = var.project_id
}

# ---------------------------------------------------------------------------------------------- inputs
variable "project_id" {
  type        = string
  description = "the Scaleway project 'runward'"
  default     = "5c163e0e-8183-42b7-af90-0c4c84777bb0"
}
variable "state_passphrase" {
  type        = string
  sensitive   = true
  ephemeral   = true
  description = "encrypts the state and the plan (keychain: runward-hosted-tofu / state-passphrase); not needed by `tofu init -backend=false && tofu validate`"
}
variable "image" {
  type        = string
  description = "the registry image to serve, BY DIGEST (rg.fr-par.scw.cloud/runward/runward-hosted@sha256:...); the all-zero digest keeps phase 2 off"
  default     = "rg.fr-par.scw.cloud/runward/runward-hosted@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "the image is named by its digest, never by a tag"
  }
}
variable "send_workflow_shas" {
  type        = string
  default     = ""
  description = "the published release commits of send.yml, comma separated"
}
variable "witness_tenants" {
  type        = string
  default     = ""
  description = "the two witness tenants of the isolation suite, comma separated (RW_WITNESS_TENANTS)"
}
variable "database_host" {
  type        = string
  default     = ""
  description = "the host the clients dial; empty = the private IP of the database. Set it to the endpoint's hostname only if the instance certificate names it (verify-full checks the host against the certificate)"
}
variable "credentials_version" {
  type        = number
  default     = 1
  description = "bump to push new passwords (and new secret versions) from the keychain; the write-only values are sent only when it changes"
}

# the four database passwords (keychain: runward-hosted-db / admin, rw_owner, rw_app, rw_maint), ephemeral
variable "db_password_admin" {
  type      = string
  sensitive = true
  ephemeral = true
  default   = null
}
variable "db_password_rw_owner" {
  type      = string
  sensitive = true
  ephemeral = true
  default   = null
}
variable "db_password_rw_app" {
  type      = string
  sensitive = true
  ephemeral = true
  default   = null
}
variable "db_password_rw_maint" {
  type      = string
  sensitive = true
  ephemeral = true
  default   = null
}

# phase 2 only: what the containers keep in their secret environment (kept in the encrypted state)
variable "container_db_password" {
  type        = string
  sensitive   = true
  default     = null
  description = "the rw_app password again (keychain runward-hosted-db / rw_app), for the service's DATABASE_URL and the gateway's isolation gesture"
}
variable "operator_db_password_admin" {
  type        = string
  sensitive   = true
  default     = null
  description = "the rw_admin password again (keychain runward-hosted-db / admin), for the gateway's roles gesture"
}
variable "operator_db_password_rw_owner" {
  type        = string
  sensitive   = true
  default     = null
  description = "the rw_owner password again (keychain runward-hosted-db / rw_owner), for the gateway's migrate gesture"
}
variable "operator_db_password_rw_maint" {
  type        = string
  sensitive   = true
  default     = null
  description = "the rw_maint password again (keychain runward-hosted-db / rw_maint), for the gateway's operator gestures"
}
variable "s3_access_key_id" {
  type        = string
  sensitive   = true
  default     = null
  description = "keychain runward-hosted-s3 / access-key-id, phase 2 only"
}
variable "s3_secret_access_key" {
  type        = string
  sensitive   = true
  default     = null
  description = "keychain runward-hosted-s3 / secret-access-key, phase 2 only"
}
variable "operator_token_sha256" {
  type        = string
  default     = ""
  description = "the sha256 (64 hex) of the operator's token (keychain runward-hosted-operator / token; GitHub secret RW_OPERATOR_TOKEN). Not a secret: the token cannot be recovered from it"
  validation {
    condition     = var.operator_token_sha256 == "" || can(regex("^[0-9a-f]{64}$", var.operator_token_sha256))
    error_message = "operator_token_sha256 is the sha256 of the token, 64 lower-case hex characters"
  }
}
variable "app_domain" {
  type        = bool
  default     = false
  description = "attach app.runward.dev to the service: only once its CNAME resolves to the service's endpoint (output service_endpoint), else the hoster's HTTP-01 check fails"
}

locals {
  phase2   = !can(regex("@sha256:0{64}$", var.image))
  database = "runward_hosted"
  pn       = scaleway_rdb_instance.rw.private_network[0]
  db_host  = var.database_host != "" ? var.database_host : local.pn.ip
  db_port  = local.pn.port
  # a password may hold any character: it is URL-encoded in the connection URL
  # admin names the hoster's default database: `roles` acts on what the whole server shares, and opens its
  # own session on the service database for the comparison of the grants (scripts/roles.mjs, 2026-11-11)
  db_url = { for k, v in {
    admin    = { user = "rw_admin", credential = var.operator_db_password_admin, database = "rdb" }
    rw_owner = { user = "rw_owner", credential = var.operator_db_password_rw_owner, database = local.database }
    rw_maint = { user = "rw_maint", credential = var.operator_db_password_rw_maint, database = local.database }
    rw_app   = { user = "rw_app", credential = var.container_db_password, database = local.database }
  } : k => format("postgres://%s:%s@%s:%d/%s", v.user, urlencode(coalesce(v.credential, "missing")), local.db_host, local.db_port, v.database) }
  # the instance's certificate is public: it is how a client checks the server (DATABASE_SSL=verify-full).
  # Read on 2026-11-08: subject CN=172.16.16.2, SAN DNS:172.16.16.2 and IP:172.16.16.2, so verify-full by
  # the private IP holds.
  database_ca = scaleway_rdb_instance.rw.certificate
  common_env = {
    NODE_ENV     = "production"
    RW_ORIGIN    = "https://app.runward.dev"
    RW_STORE     = "postgres"
    S3_ENDPOINT  = "https://s3.fr-par.scw.cloud"
    S3_REGION    = "fr-par"
    S3_BUCKET    = scaleway_object_bucket.rw.name
    DATABASE_SSL = "verify-full"
    DATABASE_CA  = local.database_ca
    # the hoster's edge is the one proxy in front of both containers (read by the service's rate limits)
    RW_TRUST_PROXY = "1"
  }
  # what phase 2 lacks, said by name (whether a value is set is not itself a secret)
  phase2_inputs_missing = compact([
    nonsensitive(var.s3_access_key_id == null || var.s3_secret_access_key == null) ? "the bucket's key: store it in the keychain (service runward-hosted-s3, accounts access-key-id and secret-access-key) and pass TF_VAR_s3_access_key_id and TF_VAR_s3_secret_access_key" : "",
    nonsensitive(var.container_db_password == null) ? "TF_VAR_container_db_password (keychain runward-hosted-db / rw_app)" : "",
    nonsensitive(var.operator_db_password_admin == null || var.operator_db_password_rw_owner == null || var.operator_db_password_rw_maint == null) ? "TF_VAR_operator_db_password_admin, _rw_owner, _rw_maint (keychain runward-hosted-db / admin, rw_owner, rw_maint)" : "",
    var.operator_token_sha256 == "" ? "-var operator_token_sha256=<sha256 of the token in keychain runward-hosted-operator / token>" : "",
  ])
}


# ---------------------------------------------------------------------------------------------- phase 1
resource "scaleway_vpc_private_network" "rw" {
  name = "runward-hosted"
}

# the registry (private), a few images of 100 to 200 MB
resource "scaleway_registry_namespace" "rw" {
  name      = "runward"
  is_public = false
}

resource "scaleway_container_namespace" "rw" {
  name = "runward-hosted"
}

# the object store: no versioning (PADR-0017 point 6), incomplete uploads aborted after 1 day
resource "scaleway_object_bucket" "rw" {
  name = "runward-hosted-objects"
  versioning {
    enabled = false
  }
  lifecycle_rule {
    id                                     = "abort-incomplete"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 1
  }
}

# the database: DB-DEV-S, one node, no HA, sbs_5k 5 GB, daily backups kept 7 days, encrypted at rest,
# ONE endpoint, in the private network (no load_balancer block: no public endpoint)
resource "scaleway_rdb_instance" "rw" {
  name                      = "runward-hosted"
  node_type                 = "DB-DEV-S"
  engine                    = "PostgreSQL-16"
  is_ha_cluster             = false
  volume_type               = "sbs_5k"
  volume_size_in_gb         = 5
  disable_backup            = false
  backup_schedule_frequency = 24
  backup_schedule_retention = 7
  backup_same_region        = true
  encryption_at_rest        = true
  user_name                 = "rw_admin"
  password_wo               = var.db_password_admin
  password_wo_version       = var.credentials_version
  private_network {
    pn_id       = scaleway_vpc_private_network.rw.id
    enable_ipam = true
  }
  lifecycle {
    precondition {
      condition     = var.db_password_admin != null && var.db_password_rw_owner != null && var.db_password_rw_app != null && var.db_password_rw_maint != null
      error_message = "the four database passwords are read from the keychain (TF_VAR_db_password_*): one is missing"
    }
    postcondition {
      condition     = length(self.load_balancer) == 0
      error_message = "the database has a public endpoint: remove it now (the database is reachable from the private network only)"
    }
  }
}

resource "scaleway_rdb_database" "rw" {
  instance_id = scaleway_rdb_instance.rw.id
  name        = local.database
}

# The service's login roles. The hoster's API creates LOGIN users only, with no attribute to set
# (no NOLOGIN, no BYPASSRLS, no membership): rw_resolve and `grant rw_resolve to rw_owner` are made by
# scripts/roles.mjs, run as rw_admin, which also checks that rw_app and rw_maint do not bypass RLS.
resource "scaleway_rdb_user" "rw_owner" {
  instance_id         = scaleway_rdb_instance.rw.id
  name                = "rw_owner"
  is_admin            = false
  password_wo         = var.db_password_rw_owner
  password_wo_version = var.credentials_version
  depends_on          = [scaleway_rdb_database.rw] # one operation at a time on the instance
}
resource "scaleway_rdb_user" "rw_app" {
  instance_id         = scaleway_rdb_instance.rw.id
  name                = "rw_app"
  is_admin            = false
  password_wo         = var.db_password_rw_app
  password_wo_version = var.credentials_version
  depends_on          = [scaleway_rdb_user.rw_owner] # one operation at a time on the instance
}
resource "scaleway_rdb_user" "rw_maint" {
  instance_id         = scaleway_rdb_instance.rw.id
  name                = "rw_maint"
  is_admin            = false
  password_wo         = var.db_password_rw_maint
  password_wo_version = var.credentials_version
  depends_on          = [scaleway_rdb_user.rw_app] # one operation at a time on the instance
}

# Privileges on runward_hosted. The API offers none, readonly, readwrite, all, and nothing finer:
#   rw_owner "all": CONNECT, CREATE (the migrations create the schemas rw and rw_meta, and own them);
#   rw_app, rw_maint "readonly": the smallest level that carries CONNECT; its table rights apply to the
#   schema public, which the service does not use. Everything in the schema rw comes from db/grants.sql.
# For rw_app and rw_maint, `permission` is what OpenTofu sets when it CREATES the privilege, and nothing
# after that (found on 2026-11-10, in the first plan after `roles` and `migrate`). Once db/grants.sql has
# granted them their rights on the schema rw, the hoster reports their level as "custom" (the provider
# 2.88.0 writes the level the API reports into `permission`), and the plan proposed "custom" -> "readonly":
# the provider documents that apply as reapplying the preset "to all objects (existing and new)", which
# would put the hoster's hand on rights that db/grants.sql and the isolation suite own. `ignore_changes`
# leaves them alone. What it costs: a later change of the level of these two users (in the hoster's
# console, or of `permission` in this file) no longer shows in a plan. What is checked instead, at each
# deploy, through the operator's gateway, the deploy stopping before the service switches:
#   - `roles` (rw_admin), before `migrate`: the two roles exist, log in, are no superuser, create no role
#     or database, do not bypass row level security, and may CONNECT;
#   - `roles` with grants (rw_admin), after `migrate`: what the two roles may do IN EFFECT (their own
#     grants, PUBLIC's, a membership's) on every table of the schemas rw and rw_meta, USAGE and CREATE on
#     those two schemas, CONNECT and CREATE on the database, is exactly the grant lines of
#     db/schema.snapshot.txt, no more, no fewer (scripts/roles.mjs; test/pg/isolation.test.js plants each
#     kind of drift);
#   - `isolation` (rw_app), after the smoke: no row crosses between the two witness tenants.
# What is NOT checked: their rights on the schema public and on any other schema (the service has nothing
# there; the hoster's preset applies there), on functions and on sequences, and TEMPORARY on the database
# (read and said by `roles`, not refused: it depends on what the hoster lets its administrator revoke).
# Whether the hoster's preset reaches the tables of the schema rw at all has not been observed.
# rw_owner keeps no such rule: it owns what the migrations create, its level stays "all", and a plan
# that shows it otherwise is a signal to read.
resource "scaleway_rdb_privilege" "rw_owner" {
  instance_id   = scaleway_rdb_instance.rw.id
  user_name     = scaleway_rdb_user.rw_owner.name
  database_name = scaleway_rdb_database.rw.name
  permission    = "all"
  depends_on    = [scaleway_rdb_user.rw_maint]
}
resource "scaleway_rdb_privilege" "rw_app" {
  instance_id   = scaleway_rdb_instance.rw.id
  user_name     = scaleway_rdb_user.rw_app.name
  database_name = scaleway_rdb_database.rw.name
  permission    = "readonly" # at creation only: "custom" once db/grants.sql is applied (see above)
  depends_on    = [scaleway_rdb_privilege.rw_owner]
  lifecycle {
    ignore_changes = [permission]
  }
}
resource "scaleway_rdb_privilege" "rw_maint" {
  instance_id   = scaleway_rdb_instance.rw.id
  user_name     = scaleway_rdb_user.rw_maint.name
  database_name = scaleway_rdb_database.rw.name
  permission    = "readonly" # at creation only: "custom" once db/grants.sql is applied (see above)
  depends_on    = [scaleway_rdb_privilege.rw_app]
  lifecycle {
    ignore_changes = [permission]
  }
}

# ---------------------------------------------------------------------------------------------- phase 2
# The service: 0.25 vCPU, 536 MB, scale 0 to 1, public, in the private network. The CI deploys (image,
# RW_COMMIT, RW_IMAGE); OpenTofu owns the rest.
# The memory is written as the hoster stores it. It counts in MB of 10^6 bytes: asked for 512 MiB
# (536870912), it kept 536000000 (536 MB, about 511.2 MiB) and every plan proposed to change it back
# (found on 2026-11-10). The stored value is the truth of what runs, and written here it is still
# compared at each plan: a change of the memory, here or at the hoster, shows. Same for the gateway.
resource "scaleway_container" "rw" {
  count                  = local.phase2 ? 1 : 0
  name                   = "runward-hosted"
  namespace_id           = scaleway_container_namespace.rw.id
  image                  = var.image
  port                   = 8080
  cpu_limit              = 250
  memory_limit_bytes     = 536000000 # 536 MB as the hoster stores it (512 MiB asked)
  min_scale              = 0
  max_scale              = 1
  privacy                = "public"
  protocol               = "http1"
  https_connections_only = true # HTTP is redirected to HTTPS
  private_network_id     = scaleway_vpc_private_network.rw.id
  # an empty value is left out rather than sent empty
  environment_variables = { for k, v in merge(local.common_env, {
    RW_SEND_WORKFLOW_SHAS = var.send_workflow_shas
  }) : k => v if v != "" }
  secret_environment_variables = {
    DATABASE_URL         = local.db_url.rw_app
    S3_ACCESS_KEY_ID     = coalesce(var.s3_access_key_id, "missing")
    S3_SECRET_ACCESS_KEY = coalesce(var.s3_secret_access_key, "missing")
  }
  lifecycle {
    ignore_changes = [image, registry_image, environment_variables["RW_COMMIT"], environment_variables["RW_IMAGE"]]
    precondition {
      condition     = length(local.phase2_inputs_missing) == 0
      error_message = "phase 2 needs: ${join("; ", local.phase2_inputs_missing)}"
    }
  }
}
resource "scaleway_container_domain" "app" {
  count        = local.phase2 && var.app_domain ? 1 : 0
  container_id = scaleway_container.rw[0].id
  hostname     = "app.runward.dev"
}

# The operator's gateway (ADR-0016): Serverless Jobs cannot join a Private Network, so every gesture that
# needs the private database and is not the service (roles, migrate, isolation, the operator's closed
# list, the two daily gestures) is one authenticated call to this container. Its own namespace, so an IAM
# rule (ContainersPrivateAccess, condition on the namespace) can open it alone. Private: the hoster
# refuses a call without X-Auth-Token; the gateway then refuses a call without the operator's token (it
# holds its sha256 only). Each gesture runs as a child process that receives one role's URL.
resource "scaleway_container_namespace" "operator" {
  count       = local.phase2 ? 1 : 0
  name        = "runward-hosted-operator"
  description = "the operator's gateway to the private database (ADR-0016)"
}
resource "scaleway_container" "operator" {
  count                  = local.phase2 ? 1 : 0
  name                   = "runward-hosted-operator"
  namespace_id           = scaleway_container_namespace.operator[0].id
  image                  = var.image
  command                = ["node"]
  args                   = ["src/operator-gateway.js"]
  port                   = 8080
  cpu_limit              = 250
  memory_limit_bytes     = 536000000 # 536 MB as the hoster stores it (512 MiB asked)
  min_scale              = 0
  max_scale              = 1   # one gesture at a time, in one process
  timeout                = 900 # above the longest gesture's own deadline (14 min), its kill and the note that follows (35 s)
  privacy                = "private"
  protocol               = "http1"
  https_connections_only = true
  private_network_id     = scaleway_vpc_private_network.rw.id
  environment_variables = { for k, v in merge(local.common_env, {
    RW_SEND_WORKFLOW_SHAS    = var.send_workflow_shas
    RW_WITNESS_TENANTS       = var.witness_tenants
    RW_OPERATOR_TOKEN_SHA256 = var.operator_token_sha256
  }) : k => v if v != "" }
  secret_environment_variables = {
    RW_OPERATOR_URL_ADMIN = local.db_url.admin
    RW_OPERATOR_URL_OWNER = local.db_url.rw_owner
    RW_OPERATOR_URL_MAINT = local.db_url.rw_maint
    RW_OPERATOR_URL_APP   = local.db_url.rw_app
    S3_ACCESS_KEY_ID      = coalesce(var.s3_access_key_id, "missing")
    S3_SECRET_ACCESS_KEY  = coalesce(var.s3_secret_access_key, "missing")
  }
  lifecycle {
    ignore_changes = [image, registry_image, environment_variables["RW_COMMIT"], environment_variables["RW_IMAGE"]]
    precondition {
      condition     = length(local.phase2_inputs_missing) == 0
      error_message = "phase 2 needs: ${join("; ", local.phase2_inputs_missing)}"
    }
  }
}

# The two daily gestures, at the hour of Paris (the trigger carries its time zone). The schedule cannot
# hold a secret in clear, so it calls /scheduled/<gesture>, which runs only these two idempotent,
# argument-free gestures; every other gesture needs the operator's token.
# verify-chains starts 30 minutes after retention: retention's own deadline is 14 minutes (the gateway's
# GESTURES), then the kill's grace and the gateway's note of a job that did not complete; the gateway runs
# one gesture at a time and would refuse (409) a job that starts while the other still runs (review finding
# of 2026-11-10: 03:37 was the very minute retention's deadline ended). test/unit/jobs.test.js holds the gap.
locals {
  scheduled = { retention = "23 3 * * *", verify-chains = "53 3 * * *" }
}
resource "scaleway_container_trigger" "scheduled" {
  for_each     = local.phase2 ? local.scheduled : {}
  container_id = scaleway_container.operator[0].id
  name         = "runward-hosted-${each.key}"
  description  = "daily ${each.key}, Europe/Paris (ADR-0016)"
  destination_config {
    http_path   = "/scheduled/${each.key}"
    http_method = "post"
  }
  cron {
    schedule = each.value
    timezone = "Europe/Paris"
  }
}

# ---------------------------------------------------------------------------------------------- outputs
output "database_private_ip" { value = local.pn.ip }
output "database_private_hostname" { value = local.pn.hostname }
output "database_ca" { value = local.database_ca }
output "container_id" { value = one(scaleway_container.rw[*].id) }
output "service_endpoint" {
  description = "the CNAME target of app.runward.dev"
  value       = one(scaleway_container.rw[*].public_endpoint)
}
output "operator_container_id" { value = one(scaleway_container.operator[*].id) }
output "operator_endpoint" {
  description = "the gateway's URL (vars.RW_OPERATOR_URL); a call needs X-Auth-Token and X-RW-Operator-Token"
  value       = one(scaleway_container.operator[*].public_endpoint)
}
