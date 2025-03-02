# Service account for MCP Logs Server Cloud Run service
resource "google_service_account" "mcp_logs_server_run" {
  account_id   = "mcp-logs-server-run"
  display_name = "Service Account for MCP Logs Server Cloud Run"
  project      = var.project_id
}

# Grant the logs viewer role to the service account
resource "google_project_iam_member" "mcp_logs_server_run_roles" {
  for_each = toset([
    "roles/logging.viewer",
    "roles/logging.logWriter"
  ])
  
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.mcp_logs_server_run.email}"
}

# Cloud Build trigger for MCP Logs Server
resource "google_cloudbuild_trigger" "mcp_logs_server_trigger" {
  name        = "mcp-logs-server-build"
  description = "Build and deploy MCP Logs Server to Cloud Run"
  
  github {
    owner = "your-github-org"
    name  = "your-repo-name"
    push {
      branch = "^main$"
    }
  }
  
  included_files = ["functions/logs-mcp-server/**"]
  
  build {
    step {
      name = "gcr.io/cloud-builders/docker"
      args = [
        "build",
        "-t", "${var.region}-docker.pkg.dev/${var.project_id}/${var.repository_name}/mcp-logs-server:latest",
        "./functions/logs-mcp-server"
      ]
    }
    step {
      name = "gcr.io/cloud-builders/docker"
      args = [
        "push",
        "${var.region}-docker.pkg.dev/${var.project_id}/${var.repository_name}/mcp-logs-server:latest"
      ]
    }
    step {
      name = "gcr.io/google.com/cloudsdktool/cloud-sdk"
      entrypoint = "gcloud"
      args = [
        "run", "deploy", "mcp-logs-server",
        "--image", "${var.region}-docker.pkg.dev/${var.project_id}/${var.repository_name}/mcp-logs-server:latest",
        "--region", var.region,
        "--platform", "managed",
        "--service-account", google_service_account.mcp_logs_server_run.email,
        "--allow-unauthenticated",
        "--memory", "512Mi",
        "--timeout", "3600s",
        "--cpu", "1",
        "--min-instances", "1",
        "--max-instances", "10",
        "--set-env-vars", "PROJECT_ID=${var.project_id}"
      ]
    }
  }
}

# Cloud Run service for MCP Logs Server
resource "google_cloud_run_service" "mcp_logs_server" {
  name     = "mcp-logs-server"
  location = var.region

  template {
    spec {
      service_account_name = google_service_account.mcp_logs_server_run.email
      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.repository_name}/mcp-logs-server:latest"
        
        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }

        ports {
          container_port = 8080
        }

        env {
          name  = "PROJECT_ID"
          value = var.project_id
        }
      }
      timeout_seconds = 3600
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/maxScale" = "10"
        "autoscaling.knative.dev/minScale" = "1"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  autogenerate_revision_name = true
}

# Create public access
resource "google_cloud_run_service_iam_member" "mcp_logs_server_public_access" {
  location = google_cloud_run_service.mcp_logs_server.location
  service  = google_cloud_run_service.mcp_logs_server.name
  role     = "roles/run.invoker"
  member   = "allUsers"
} 