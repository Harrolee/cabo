# Configure the Google Cloud provider
provider "google" {
  project = var.project_id
  region  = var.region
}

# Create a Cloud Storage bucket for the function source
resource "google_storage_bucket" "function_bucket" {
  name     = "${var.project_id}-function-source"
  location = var.region
  uniform_bucket_level_access = true
}

# Cloud Scheduler configuration
resource "google_cloud_scheduler_job" "daily_motivation" {
  name        = "trigger-daily-motivation"
  description = "Triggers the motivation function daily"
  schedule    = "0 9 * * *"
  time_zone   = "America/New_York"

  http_target {
    http_method = "POST"
    uri         = module.motivation_function.url

    oidc_token {
      service_account_email = google_service_account.function_invoker.email
    }
  }
}

# Create a service account for the Cloud Scheduler
resource "google_service_account" "function_invoker" {
  account_id   = "function-invoker"
  display_name = "Function Invoker Service Account"
}

# Grant the service account permission to invoke the function
resource "google_cloudfunctions2_function_iam_member" "invoker" {
  project        = module.motivation_function.function.project
  location       = module.motivation_function.function.location
  cloud_function = module.motivation_function.function.name
  role           = "roles/cloudfunctions.invoker"
  member         = "serviceAccount:${google_service_account.function_invoker.email}"
} 