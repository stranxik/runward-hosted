# runward hosted on Scaleway, Paris (PADR-0009, PADR-0015 point 7). DESCRIBED, NOT CREATED: the CI runs
# `tofu validate` only. Creating these resources is paid and waits for the author's approval of each one
# (runward/runbook.md, "Resources to create", with their prices from the framing note §8).
# Nothing specific to the hoster enters the data path: an OCI container, PostgreSQL, an S3 bucket.
terraform {
  required_version = ">= 1.12.0"
  required_providers {
    scaleway = { source = "scaleway/scaleway", version = "= 2.88.0" }
  }
}

provider "scaleway" {
  region     = "fr-par"
  zone       = "fr-par-1"
  project_id = var.project_id
}

variable "project_id" {
  type        = string
  description = "the Scaleway project 'runward' (already open; holds nothing paid yet)"
}
variable "image" {
  type        = string
  description = "the registry image to serve, BY DIGEST (rg.fr-par.scw.cloud/runward/runward-hosted@sha256:...)"
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

resource "scaleway_vpc_private_network" "rw" {
  name = "runward-hosted"
}

# ---- the registry (private), a few images of 100 to 200 MB: < 0.10 EUR per month
resource "scaleway_registry_namespace" "rw" {
  name      = "runward"
  is_public = false
}

# ---- the database: DB-DEV-S, one node, no high availability, backups kept 7 days (PADR-0017 point 7)
# about 11.40 EUR per month (0.0156 EUR per hour) plus storage and backups at 0.03 EUR per GB
resource "scaleway_rdb_instance" "rw" {
  name                      = "runward-hosted"
  node_type                 = "DB-DEV-S"
  engine                    = "PostgreSQL-16"
  is_ha_cluster             = false
  disable_backup            = false
  backup_schedule_frequency = 24
  backup_schedule_retention = 7
  encryption_at_rest        = true
  private_network {
    pn_id       = scaleway_vpc_private_network.rw.id
    enable_ipam = true
  }
}
resource "scaleway_rdb_database" "rw" {
  instance_id = scaleway_rdb_instance.rw.id
  name        = "runward_hosted"
}

# ---- the object store: Standard, NO versioning (PADR-0017 point 6), incomplete uploads expire in 1 day
# a few MB: < 0.10 EUR per month
resource "scaleway_object_bucket" "rw" {
  name = "runward-hosted-objects"
  versioning { enabled = false }
  lifecycle_rule {
    id                                     = "abort-incomplete"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 1
  }
}

# ---- the container: 0.25 vCPU, 512 MB, scale 0 to 1 (Q4), about 0 EUR within the monthly free tier
resource "scaleway_container_namespace" "rw" {
  name = "runward-hosted"
}
resource "scaleway_container" "rw" {
  name            = "runward-hosted"
  namespace_id    = scaleway_container_namespace.rw.id
  registry_image  = var.image
  port            = 8080
  cpu_limit       = 250
  memory_limit    = 512
  min_scale       = 0
  max_scale       = 1
  privacy         = "public"
  protocol        = "http1"
  http_option     = "redirected"
  deploy          = true
  private_network_id = scaleway_vpc_private_network.rw.id
  environment_variables = local.service_env
  # DATABASE_URL (role rw_app), S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are secret environment variables,
  # set at the console or by `scw container container update ... secret-environment-variables`, never here.
}
# What the service and its jobs read that is not a secret. DATABASE_CA is the instance's own certificate
# (public): TLS to PostgreSQL is verify-full, and the service refuses to start in production without it.
locals {
  service_env = {
    NODE_ENV              = "production"
    RW_ORIGIN             = "https://app.runward.dev"
    RW_STORE              = "postgres"
    S3_ENDPOINT           = "https://s3.fr-par.scw.cloud"
    S3_REGION             = "fr-par"
    S3_BUCKET             = scaleway_object_bucket.rw.name
    RW_SEND_WORKFLOW_SHAS = var.send_workflow_shas
    RW_TRUST_PROXY        = "1"
    DATABASE_SSL          = "verify-full"
    DATABASE_CA           = scaleway_rdb_instance.rw.certificate
  }
}
resource "scaleway_container_domain" "app" {
  container_id = scaleway_container.rw.id
  hostname     = "app.runward.dev"
}

# ---- the hoster's jobs, same image, in the private network (PADR-0018 point 7): a few seconds a day
resource "scaleway_job_definition" "retention" {
  name         = "runward-hosted-retention"
  cpu_limit              = 250
  memory_limit           = 512
  local_storage_capacity = 1000
  image_uri              = var.image
  env                    = local.service_env
  command      = "node src/operator.js retention"
  cron {
    schedule = "23 3 * * *"
    timezone = "Europe/Paris"
  }
}
resource "scaleway_job_definition" "verify_chains" {
  name         = "runward-hosted-verify-chains"
  cpu_limit              = 250
  memory_limit           = 512
  local_storage_capacity = 1000
  image_uri              = var.image
  env                    = local.service_env
  command      = "node src/operator.js verify-chains"
  cron {
    schedule = "37 3 * * *"
    timezone = "Europe/Paris"
  }
}
resource "scaleway_job_definition" "operator" {
  name         = "runward-hosted-operator"
  cpu_limit              = 250
  memory_limit           = 512
  local_storage_capacity = 1000
  image_uri              = var.image
  env                    = local.service_env
  command      = "node src/operator.js"
}
resource "scaleway_job_definition" "isolation" {
  name         = "runward-hosted-isolation"
  cpu_limit              = 250
  memory_limit           = 512
  local_storage_capacity = 1000
  image_uri              = var.image
  env                    = local.service_env
  command      = "node scripts/isolation-deployed.mjs"
}

output "container_id" { value = scaleway_container.rw.id }
output "database_private_ip" { value = scaleway_rdb_instance.rw.private_network[0].ip }
