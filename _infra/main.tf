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

# Create ZIP archives for each function
data "archive_file" "motivational_images_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/motivational-images"
  output_path = "${path.root}/tmp/motivational-images.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "signup_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/signup"
  output_path = "${path.root}/tmp/signup.zip"
  excludes    = ["node_modules"]
}

# Upload the function sources to Cloud Storage
resource "google_storage_bucket_object" "motivational_images_source" {
  name   = "motivational-images-${data.archive_file.motivational_images_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.motivational_images_zip.output_path
}

resource "google_storage_bucket_object" "signup_source" {
  name   = "signup-${data.archive_file.signup_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.signup_zip.output_path
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
        object = google_storage_bucket_object.motivational_images_source.name
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
      TWILIO_PHONE_NUMBER       = var.twilio_phone_number
      SUPABASE_URL             = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
      REPLICATE_API_TOKEN       = var.replicate_api_key
      ALLOWED_ORIGINS          = var.allowed_origins
    }
    ingress_settings = "ALLOW_ALL"
    all_traffic_on_latest_revision = true
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

resource "google_cloudfunctions2_function" "signup_function" {
  name        = "handle-user-signup"
  location    = var.region
  description = "Function to handle new user signups"

  build_config {
    runtime     = "nodejs18"
    entry_point = "handleSignup"
    source {
      storage_source {
        bucket = google_storage_bucket.function_bucket.name
        object = google_storage_bucket_object.signup_source.name
      }
    }
  }

  service_config {
    max_instance_count = 1
    available_memory   = "256M"
    timeout_seconds    = 60
    environment_variables = {
      SUPABASE_URL             = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
      ALLOWED_ORIGINS          = var.allowed_origins
    }
    ingress_settings = "ALLOW_ALL"
    all_traffic_on_latest_revision = true
  }

  # Ensure the bucket object is fully created before creating function
  depends_on = [
    google_storage_bucket_object.signup_source
  ]
}

# IAM binding for the signup function
resource "google_cloudfunctions2_function_iam_member" "signup_invoker" {
  project        = google_cloudfunctions2_function.signup_function.project
  location       = google_cloudfunctions2_function.signup_function.location
  cloud_function = google_cloudfunctions2_function.signup_function.name
  role           = "roles/cloudfunctions.invoker"
  member         = "allUsers"
} 