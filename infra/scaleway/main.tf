# runward hosted on Scaleway, Paris (PADR-0009, PADR-0015 point 7), project "runward", region fr-par.
# Two phases. Phase 1 (always): the network, the registry, the namespace, the bucket, the database, its
# users and their privileges, the Secret Manager entries of the jobs. Phase 2 (only when `image` names a
# real digest): the container, its domain, and the jobs (these also wait for `jobs_reach_database`).
# The CI runs `tofu init -backend=false && tofu validate` only; a session applies, after the author's
# approval of the paid resources (runward/runbook.md §11 and §12).
#
# No secret is written here, in the plan or (for phase 1) in the state:
#   - every database password is EPHEMERAL and lands only in WRITE-ONLY arguments (`password_wo`,
#     `data_wo`), which OpenTofu (>= 1.11) never records in a plan or a state;
#   - phase 2 is the exception the hoster imposes: a Serverless Container has no secret reference and no
#     write-only argument, so its DATABASE_URL and S3 keys are `sensitive` (not ephemeral) and are kept in
#     the state; the state and the plan are encrypted (block `encryption`, enforced) and live outside any
#     repository (the backend path is given at init, never committed).
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
variable "jobs_reach_database" {
  type        = bool
  default     = false
  description = "Serverless Jobs cannot join a Private Network (Scaleway FAQ, read 2026-11-08) and the database has no public endpoint: the jobs stay off until a path exists"
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

# phase 2 only: what the container keeps in its secret environment (kept in the encrypted state)
variable "container_db_password" {
  type        = string
  sensitive   = true
  default     = null
  description = "the rw_app password again (keychain runward-hosted-db / rw_app), for the container's DATABASE_URL"
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

locals {
  phase2   = !can(regex("@sha256:0{64}$", var.image))
  jobs     = local.phase2 && var.jobs_reach_database
  database = "runward_hosted"
  pn       = scaleway_rdb_instance.rw.private_network[0]
  db_host  = var.database_host != "" ? var.database_host : local.pn.ip
  db_port  = local.pn.port
  # the instance's certificate is public: it is how a client checks the server (DATABASE_SSL=verify-full)
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
  }
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
  permission    = "readonly"
  depends_on    = [scaleway_rdb_privilege.rw_owner]
}
resource "scaleway_rdb_privilege" "rw_maint" {
  instance_id   = scaleway_rdb_instance.rw.id
  user_name     = scaleway_rdb_user.rw_maint.name
  database_name = scaleway_rdb_database.rw.name
  permission    = "readonly"
  depends_on    = [scaleway_rdb_privilege.rw_app]
}

# Secret Manager: the connection URLs the jobs read by `secret_reference` (Jobs have no other secret
# channel). Values are written once per `credentials_version`, write-only, never in the state.
locals {
  db_secrets = {
    admin    = { user = "rw_admin", database = "rdb", description = "rw_admin, for the roles job (database rdb)" }
    rw_owner = { user = "rw_owner", database = local.database, description = "rw_owner, for the migrate job" }
    rw_maint = { user = "rw_maint", database = local.database, description = "rw_maint, for the operator jobs" }
    rw_app   = { user = "rw_app", database = local.database, description = "rw_app, for the isolation job" }
  }
}
resource "scaleway_secret" "db" {
  for_each    = local.db_secrets
  name        = "database-url-${replace(each.key, "_", "-")}"
  path        = "/runward-hosted"
  description = each.value.description
  type        = "opaque"
}
resource "scaleway_secret_version" "db" {
  for_each    = local.db_secrets
  secret_id   = scaleway_secret.db[each.key].id
  description = "credentials version ${var.credentials_version}"
  data_wo = format("postgres://%s:%s@%s:%d/%s", each.value.user, {
    admin    = var.db_password_admin
    rw_owner = var.db_password_rw_owner
    rw_maint = var.db_password_rw_maint
    rw_app   = var.db_password_rw_app
  }[each.key], local.db_host, local.db_port, each.value.database)
  data_wo_version = var.credentials_version
  depends_on      = [scaleway_rdb_user.rw_owner, scaleway_rdb_user.rw_app, scaleway_rdb_user.rw_maint]
}

# ---------------------------------------------------------------------------------------------- phase 2
resource "scaleway_secret" "s3" {
  for_each    = local.phase2 ? toset(["access-key-id", "secret-access-key"]) : toset([])
  name        = "s3-${each.key}"
  path        = "/runward-hosted"
  description = "the bucket's key, for the operator jobs"
  type        = "opaque"
}
resource "scaleway_secret_version" "s3" {
  for_each        = scaleway_secret.s3
  secret_id       = each.value.id
  description     = "credentials version ${var.credentials_version}"
  data_wo         = each.key == "access-key-id" ? var.s3_access_key_id : var.s3_secret_access_key
  data_wo_version = var.credentials_version
  lifecycle {
    precondition {
      condition     = var.s3_access_key_id != null && var.s3_secret_access_key != null
      error_message = "phase 2 needs the bucket's key: store it in the keychain (service runward-hosted-s3, accounts access-key-id and secret-access-key) and pass TF_VAR_s3_access_key_id and TF_VAR_s3_secret_access_key"
    }
  }
}

# the container: 0.25 vCPU, 512 MB, scale 0 to 1, public, in the private network. The CI deploys (image,
# RW_COMMIT, RW_IMAGE); OpenTofu owns the rest.
resource "scaleway_container" "rw" {
  count                  = local.phase2 ? 1 : 0
  name                   = "runward-hosted"
  namespace_id           = scaleway_container_namespace.rw.id
  image                  = var.image
  port                   = 8080
  cpu_limit              = 250
  memory_limit_bytes     = 536870912 # 512 MiB
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
    DATABASE_URL         = format("postgres://rw_app:%s@%s:%d/%s", coalesce(var.container_db_password, "missing"), local.db_host, local.db_port, local.database)
    S3_ACCESS_KEY_ID     = coalesce(var.s3_access_key_id, "missing")
    S3_SECRET_ACCESS_KEY = coalesce(var.s3_secret_access_key, "missing")
  }
  lifecycle {
    ignore_changes = [image, registry_image, environment_variables["RW_COMMIT"], environment_variables["RW_IMAGE"]]
    precondition {
      condition     = var.s3_access_key_id != null && var.s3_secret_access_key != null
      error_message = "phase 2 needs the bucket's key: store it in the keychain (service runward-hosted-s3, accounts access-key-id and secret-access-key) and pass TF_VAR_s3_access_key_id and TF_VAR_s3_secret_access_key"
    }
    precondition {
      condition     = var.container_db_password != null
      error_message = "phase 2 needs TF_VAR_container_db_password (the rw_app password, keychain runward-hosted-db / rw_app)"
    }
  }
}
resource "scaleway_container_domain" "app" {
  count        = local.phase2 ? 1 : 0
  container_id = scaleway_container.rw[0].id
  hostname     = "app.runward.dev"
}

# the jobs, same image. Each reads its connection URL (and the S3 key when it opens the store) from
# Secret Manager. OFF until they can reach the private database (variable jobs_reach_database).
locals {
  s3_refs = { S3_ACCESS_KEY_ID = "access-key-id", S3_SECRET_ACCESS_KEY = "secret-access-key" }
  job_specs = {
    roles         = { args = ["scripts/roles.mjs"], url_env = "ADMIN_URL", secret = "admin", s3 = false, cron = null }
    migrate       = { args = ["scripts/migrate.mjs"], url_env = "MIGRATE_URL", secret = "rw_owner", s3 = false, cron = null }
    retention     = { args = ["src/operator.js", "retention"], url_env = "DATABASE_URL", secret = "rw_maint", s3 = true, cron = "23 3 * * *" }
    verify-chains = { args = ["src/operator.js", "verify-chains"], url_env = "DATABASE_URL", secret = "rw_maint", s3 = true, cron = "37 3 * * *" }
    operator      = { args = ["src/operator.js"], url_env = "DATABASE_URL", secret = "rw_maint", s3 = true, cron = null }
    isolation     = { args = ["scripts/isolation-deployed.mjs"], url_env = "DATABASE_URL", secret = "rw_app", s3 = false, cron = null }
  }
}
resource "scaleway_job_definition" "rw" {
  for_each               = local.jobs ? local.job_specs : {}
  name                   = "runward-hosted-${each.key}"
  cpu_limit              = 250
  memory_limit           = 512
  local_storage_capacity = 1000
  image_uri              = var.image
  startup_command        = ["node"]
  args                   = each.value.args
  timeout                = "900s"
  env = { for k, v in merge(local.common_env, {
    RW_SEND_WORKFLOW_SHAS = var.send_workflow_shas
    RW_WITNESS_TENANTS    = var.witness_tenants
  }) : k => v if v != "" }
  secret_reference {
    secret_id      = scaleway_secret.db[each.value.secret].id
    secret_version = tostring(scaleway_secret_version.db[each.value.secret].revision)
    environment    = each.value.url_env
  }
  dynamic "secret_reference" {
    for_each = each.value.s3 ? local.s3_refs : {}
    content {
      secret_id      = scaleway_secret.s3[secret_reference.value].id
      secret_version = tostring(scaleway_secret_version.s3[secret_reference.value].revision)
      environment    = secret_reference.key
    }
  }
  dynamic "cron" {
    for_each = each.value.cron == null ? [] : [each.value.cron]
    content {
      schedule = cron.value
      timezone = "Europe/Paris"
    }
  }
}

# ---------------------------------------------------------------------------------------------- outputs
output "database_private_ip" { value = local.pn.ip }
output "database_private_hostname" { value = local.pn.hostname }
output "database_ca" { value = local.database_ca }
output "container_id" { value = one(scaleway_container.rw[*].id) }
output "job_ids" { value = { for k, j in scaleway_job_definition.rw : k => j.id } }
