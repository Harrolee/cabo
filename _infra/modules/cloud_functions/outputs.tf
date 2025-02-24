output "process_sms_function" {
  description = "The process SMS function"
  value       = module.process_sms
}

output "motivational_images_function" {
  description = "The motivational images function"
  value       = module.motivational_images
}

output "signup_function" {
  description = "The signup function"
  value       = module.signup
}

output "scheduler_job" {
  description = "The Cloud Scheduler job"
  value       = google_cloud_scheduler_job.daily_motivation
} 