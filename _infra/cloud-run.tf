# Cloud Run service
resource "google_cloud_run_service" "webapp" {
  name     = "workout-motivation-webapp"
  location = var.region

  template {
    spec {
      service_account_name = google_service_account.cloud_run_service_account.email
      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.repository_name}/${var.image_name}:latest"
        
        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }

        # Environment variables if needed
        env {
          name  = "VITE_SUPABASE_URL"
          value = var.supabase_url
        }
        env {
          name  = "VITE_SUPABASE_PUBLIC_KEY"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.supabase_key.secret_id
              key  = "latest"
            }
          }
        }

        env {
          name  = "REPLICATE_API_TOKEN"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.replicate_key.secret_id
              key  = "latest"
            }
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
  service  = google_cloud_run_service.webapp.name
  location = google_cloud_run_service.webapp.location
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