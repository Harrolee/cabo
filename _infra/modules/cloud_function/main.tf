variable "name" {
  description = "Name of the Cloud Function"
  type        = string
}

variable "description" {
  description = "Description of the Cloud Function"
  type        = string
}

variable "region" {
  description = "Region to deploy the function"
  type        = string
}

variable "bucket_name" {
  description = "Name of the storage bucket containing the function source"
  type        = string
}

variable "source_object" {
  description = "Name of the storage object containing the function source"
  type        = string
}

variable "entry_point" {
  description = "Entry point for the function"
  type        = string
}

variable "environment_variables" {
  description = "Environment variables for the function"
  type        = map(string)
  default     = {}
}

variable "service_account_email" {
  description = "Service account email for the function"
  type        = string
  default     = null
}

variable "memory" {
  description = "Available memory for the function"
  type        = string
  default     = "256M"
}

variable "timeout" {
  description = "Timeout in seconds"
  type        = number
  default     = 60
}

resource "google_cloudfunctions2_function" "function" {
  name        = var.name
  location    = var.region
  description = var.description

  build_config {
    runtime     = "nodejs18"
    entry_point = var.entry_point
    source {
      storage_source {
        bucket = var.bucket_name
        object = var.source_object
      }
    }
  }

  service_config {
    max_instance_count = 1
    available_memory   = var.memory
    timeout_seconds    = var.timeout
    environment_variables = var.environment_variables
    ingress_settings = "ALLOW_ALL"
    all_traffic_on_latest_revision = true
    service_account_email = var.service_account_email
  }
}

resource "google_cloudfunctions2_function_iam_member" "invoker" {
  project        = google_cloudfunctions2_function.function.project
  location       = google_cloudfunctions2_function.function.location
  cloud_function = google_cloudfunctions2_function.function.name
  role           = "roles/cloudfunctions.invoker"
  member         = "allUsers"
}

output "function" {
  value = google_cloudfunctions2_function.function
}

output "url" {
  value = google_cloudfunctions2_function.function.url
} 