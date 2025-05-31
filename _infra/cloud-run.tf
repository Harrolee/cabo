# Cloud Run service
resource "google_cloud_run_service" "webapp" {
  name     = "workout-motivation-webapp"
  location = var.region

  template {
    spec {
      service_account_name = google_service_account.cloud_run_service_account.email
      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.repository_name}/${var.image_name}:latest"
        
        # Add environment variables for the webapp
        env {
          name  = "VITE_GCP_FUNCTION_BASE_URL"
          value = "https://${var.region}-${var.project_id}.cloudfunctions.net"
        }
        
        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }

        ports {
          container_port = 80
        }
      }
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/maxScale" = "5"
        "autoscaling.knative.dev/minScale" = "1"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  autogenerate_revision_name = true

  depends_on = [
    google_project_iam_member.secret_manager_access
  ]
}

# Create public access
resource "google_cloud_run_service_iam_member" "public_access" {
  location = google_cloud_run_service.webapp.location
  service  = google_cloud_run_service.webapp.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Create Secret for Supabase key
resource "google_secret_manager_secret" "supabase_key" {
  secret_id = "supabase-public-key"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "supabase_key_version" {
  secret      = google_secret_manager_secret.supabase_key.id
  secret_data = var.supabase_public_key
}

# Grant Cloud Run access to Secret Manager
resource "google_secret_manager_secret_iam_member" "secret_access" {
  secret_id = google_secret_manager_secret.supabase_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_service_account.email}"
}

# Create Secret for Replicate API key
resource "google_secret_manager_secret" "replicate_key" {
  secret_id = "replicate-api-key"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "replicate_key_version" {
  secret      = google_secret_manager_secret.replicate_key.id
  secret_data = var.replicate_api_key
}

# Grant Cloud Run access to Replicate secret
resource "google_secret_manager_secret_iam_member" "replicate_secret_access" {
  secret_id = google_secret_manager_secret.replicate_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_service_account.email}"
}

# Create Service Account for Cloud Run
resource "google_service_account" "cloud_run_service_account" {
  account_id   = "cloud-run-webapp"
  display_name = "Cloud Run Service Account"
  description  = "Service account for Cloud Run webapp"
}

# Grant Secret Manager access to the Cloud Run service account
resource "google_project_iam_member" "secret_manager_access" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run_service_account.email}"
}

# Add at the top of the file
data "google_project" "project" {
  project_id = var.project_id
}

# Add with other secrets
resource "google_secret_manager_secret" "supabase_service_key" {
  secret_id = "supabase-service-key"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "supabase_service_key_version" {
  secret      = google_secret_manager_secret.supabase_service_key.id
  secret_data = var.supabase_service_role_key
}

# Add IAM binding for the service key
resource "google_secret_manager_secret_iam_member" "supabase_service_key_access" {
  secret_id = google_secret_manager_secret.supabase_service_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_service_account.email}"
} 