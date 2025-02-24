output "function_service_accounts" {
  description = "Map of function service accounts"
  value       = google_service_account.function_service_accounts
}

output "cloud_run_service_account" {
  description = "The Cloud Run service account"
  value       = google_service_account.cloud_run
}

output "function_invoker_service_account" {
  description = "The function invoker service account"
  value       = google_service_account.function_invoker
} 