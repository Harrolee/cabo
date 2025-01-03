# Create Artifact Registry Repository
resource "google_artifact_registry_repository" "webapp" {
  location      = var.region
  repository_id = var.repository_name
  description   = "Docker repository for workout motivation webapp"
  format        = "DOCKER"
}

# Create Workload Identity Pool
resource "google_iam_workload_identity_pool" "github_pool" {
  workload_identity_pool_id = "github-actions-pool"
  display_name             = "GitHub Actions Pool"
  description             = "Identity pool for GitHub Actions"
}

# Create Workload Identity Provider
resource "google_iam_workload_identity_pool_provider" "github_provider" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github_pool.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub provider"
  description                        = "OIDC identity pool provider for GitHub Actions"
  
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }
}

# Create Service Account for GitHub Actions
resource "google_service_account" "github_actions" {
  account_id   = "github-actions-webapp"
  display_name = "GitHub Actions Service Account"
  description  = "Service account for GitHub Actions to push to Artifact Registry"
}

# Grant Artifact Registry access to the service account
resource "google_artifact_registry_repository_iam_member" "github_actions_push" {
  location   = google_artifact_registry_repository.webapp.location
  repository = google_artifact_registry_repository.webapp.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.github_actions.email}"
}

# Allow GitHub Actions to impersonate the service account
resource "google_service_account_iam_binding" "workload_identity_user" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  members = [
    "principalSet://iam.googleapis.com/projects/${var.project_id}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github_pool.workload_identity_pool_id}/attribute.repository/${var.github_repo}"
  ]
} 