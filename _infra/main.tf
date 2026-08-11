# Configure the Google Cloud provider
provider "google" {
  project = var.project_id
  region  = var.region
}

terraform {
  backend "gcs" {
    bucket = "cabo-446722-terraform-state"
    prefix = "terraform/state"
  }
}

# Create a Cloud Storage bucket for the function source
resource "google_storage_bucket" "function_bucket" {
  name     = "${var.project_id}-function-source"
  location = var.region
  uniform_bucket_level_access = true
}

# Create a Cloud Storage bucket for coach content
resource "google_storage_bucket" "coach_content_bucket" {
  name          = "${var.project_id}-${var.coach_content_bucket_name}"
  location      = var.coach_content_bucket_location
  force_destroy = true

  uniform_bucket_level_access = true

  # CORS configuration for direct uploads from webapp
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "PUT", "POST", "DELETE"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    condition {
      age = 730  # Keep coach content for 2 years
    }
    action {
      type = "Delete"
    }
  }

  # Versioning for content safety
  versioning {
    enabled = true
  }
}

/*
  Member-supplied media — today, the reference photo the visualiser hands to
  PhotoMaker so the person in the picture is actually them.

  Deliberately not the coach-content or image buckets: those are versioned and
  public-read respectively, and a photograph of a member must be neither. The
  settings here all serve one promise — that withdrawing consent deletes the
  photo:

    public_access_prevention   nothing here is ever fetched without a signed URL
    versioning off             a delete does not leave a previous generation
    soft_delete retention 0    a delete is not recoverable for a week afterwards
    lifecycle 365 days         an account nobody comes back to expires anyway

  The bucket is written and read only by the coach-visualizer service account.
*/
resource "google_storage_bucket" "member_media_bucket" {
  name          = "${var.project_id}-${var.member_media_bucket_name}"
  location      = var.member_media_bucket_location
  force_destroy = false

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = false
  }

  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type = "Delete"
    }
  }
}

# Cloud Scheduler configuration
#
# Kept deliberately: SMS stays a first-class acquisition channel (signup by
# text is far less friction than an app install), so the daily image job was
# generalised rather than retired. See docs/multi-domain-coaches.md.
resource "google_cloud_scheduler_job" "daily_motivation" {
  name        = "trigger-daily-motivation"
  description = "Triggers the daily goal-driven image for SMS members"
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