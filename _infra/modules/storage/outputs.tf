output "function_source_bucket" {
  description = "The bucket object for function source code"
  value       = google_storage_bucket.function_source
}

output "conversation_storage_bucket" {
  description = "The bucket object for conversation storage"
  value       = google_storage_bucket.conversation_storage
}

output "function_source_bucket_name" {
  description = "The name of the function source bucket"
  value       = google_storage_bucket.function_source.name
}

output "conversation_storage_bucket_name" {
  description = "The name of the conversation storage bucket"
  value       = google_storage_bucket.conversation_storage.name
} 