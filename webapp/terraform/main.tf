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

# Create a ZIP archive of the function source
data "archive_file" "function_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions"
  output_path = "${path.root}/tmp/function.zip"
  excludes    = ["node_modules"]
}

# Upload the function source to Cloud Storage
resource "google_storage_bucket_object" "function_source" {
  name   = "function-source-${data.archive_file.function_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.function_zip.output_path
}

# Create the Cloud Function
resource "google_cloudfunctions2_function" "motivation_function" {
  name        = "send-motivational-images"
  location    = var.region
  description = "Function to send motivational images to users"

  build_config {
    runtime     = "nodejs18"
    entry_point = "sendMotivationalImages"
    source {
      storage_source {
        bucket = google_storage_bucket.function_bucket.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    max_instance_count = 1
    available_memory   = "256M"
    timeout_seconds    = 60
    environment_variables = {
      TWILIO_ACCOUNT_SID        = var.twilio_account_sid
      TWILIO_AUTH_TOKEN         = var.twilio_auth_token
      TWILIO_PHONE_NUMBER      = var.twilio_phone_number
      SUPABASE_URL             = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
      REPLICATE_API_TOKEN      = var.replicate_api_token
    }
  }
}

# Create Cloud Scheduler job to trigger the function daily
resource "google_cloud_scheduler_job" "daily_motivation" {
  name        = "trigger-daily-motivation"
  description = "Triggers the motivation function daily"
  schedule    = "0 9 * * *"  # Runs at 9 AM every day
  time_zone   = "UTC"

  http_target {
    http_method = "POST"
    uri         = google_cloudfunctions2_function.motivation_function.url

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
  project        = google_cloudfunctions2_function.motivation_function.project
  location       = google_cloudfunctions2_function.motivation_function.location
  cloud_function = google_cloudfunctions2_function.motivation_function.name
  role           = "roles/cloudfunctions.invoker"
  member         = "serviceAccount:${google_service_account.function_invoker.email}"
} 