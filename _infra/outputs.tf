output "function_url" {
  description = "The URL of the deployed Cloud Function"
  value       = google_cloudfunctions2_function.motivation_function.url
}

output "function_status" {
  description = "The deployment status of the Cloud Function"
  value       = google_cloudfunctions2_function.motivation_function.state
}

output "scheduler_job_name" {
  description = "The name of the Cloud Scheduler job"
  value       = google_cloud_scheduler_job.daily_motivation.name
}

output "artifact_registry_repository" {
  description = "The Artifact Registry repository URL"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.webapp.repository_id}"
}

output "workload_identity_provider" {
  description = "Workload Identity Provider resource name"
  value       = google_iam_workload_identity_pool_provider.github_provider.name
}

output "service_account_email" {
  description = "Service account email for GitHub Actions"
  value       = google_service_account.github_actions.email
}

output "cloud_run_url" {
  description = "URL of the Cloud Run service"
  value       = google_cloud_run_service.webapp.status[0].url
}

output "cloud_run_service_account" {
  description = "Service account used by Cloud Run"
  value       = google_service_account.cloud_run_service_account.email
} 