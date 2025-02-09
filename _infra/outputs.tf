output "motivation_function_url" {
  description = "The URL of the motivation Cloud Function"
  value       = module.motivation_function.url
}

output "motivation_function_status" {
  description = "The deployment status of the motivation Cloud Function"
  value       = module.motivation_function.function.state
}

output "signup_function_url" {
  description = "The URL of the signup Cloud Function"
  value       = module.signup_function.url
}

output "stripe_webhook_url" {
  description = "URL of the stripe-webhook function"
  value       = module.stripe_webhook_function.url
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

output "video_bucket_url" {
  description = "Base URL for the video bucket"
  value       = "https://storage.googleapis.com/${google_storage_bucket.workout_videos.name}"
}

output "video_urls" {
  description = "URLs for the workout videos"
  value = [
    for video in local.video_files :
    "https://storage.googleapis.com/${google_storage_bucket.workout_videos.name}/videos/${video}"
  ]
}

output "call_to_action_image_url" {
  description = "Public URL of the call-to-action image"
  value       = "https://storage.googleapis.com/${google_storage_bucket.image_bucket.name}/${google_storage_bucket_object.call_to_action_image.name}"
}

output "process_sms_url" {
  description = "URL of the process-sms function"
  value       = module.process_sms_function.url
} 