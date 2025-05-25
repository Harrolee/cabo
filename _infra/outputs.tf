output "motivation_function_url" {
  description = "URL of the motivational images function"
  value       = module.motivation_function.url
}

output "motivation_function_status" {
  description = "The deployment status of the motivation Cloud Function"
  value       = module.motivation_function.function.state
}

output "signup_function_url" {
  description = "URL of the signup function"
  value       = module.signup_function.url
}

output "stripe_webhook_url" {
  description = "URL of the Stripe webhook function"
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
  description = "URL of the SMS processing function"
  value       = module.process_sms_function.url
}

output "get_user_data_url" {
  description = "URL of the get user data function"
  value       = module.get_user_data_function.url
}

output "create_stripe_subscription_url" {
  description = "URL of the create Stripe subscription function"
  value       = module.create_stripe_subscription_function.url
}

output "create_setup_intent_url" {
  description = "URL of the create setup intent function"
  value       = module.create_setup_intent_function.url
}

output "cancel_stripe_subscription_url" {
  description = "URL of the cancel Stripe subscription function"
  value       = module.cancel_stripe_subscription_function.url
}

output "coach_content_processor_url" {
  description = "URL of the coach content processor function"
  value       = module.coach_content_processor_function.url
}

output "coach_response_generator_url" {
  description = "URL of the coach response generator function"
  value       = module.coach_response_generator_function.url
}

output "coach_file_uploader_url" {
  description = "URL of the coach file uploader function"
  value       = module.coach_file_uploader_function.url
}

output "conversation_bucket_name" {
  description = "Name of the conversation storage bucket"
  value       = google_storage_bucket.conversation_storage.name
}

output "coach_content_bucket_name" {
  description = "Name of the coach content storage bucket"
  value       = google_storage_bucket.coach_content_bucket.name
}

output "function_bucket_name" {
  description = "Name of the function source storage bucket"
  value       = google_storage_bucket.function_bucket.name
}

output "webapp_environment_variables" {
  description = "Environment variables needed for the webapp"
  value = {
    VITE_GCP_FUNCTION_BASE_URL = "https://${var.region}-${var.project_id}.cloudfunctions.net"
    VITE_COACH_CONTENT_PROCESSOR_URL = module.coach_content_processor_function.url
    VITE_COACH_RESPONSE_GENERATOR_URL = module.coach_response_generator_function.url
    VITE_COACH_FILE_UPLOADER_URL = module.coach_file_uploader_function.url
  }
  sensitive = false
}