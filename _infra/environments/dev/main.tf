# Import shared configurations
module "shared" {
  source = "../../shared"
}

# Storage module
module "storage" {
  source = "../../modules/storage"

  project_id   = var.project_id
  region       = var.region
  environment  = "dev"
}

# Variables for the environment
variable "project_id" {
  description = "The Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "The region to deploy resources to"
  type        = string
  default     = "us-central1"
} 