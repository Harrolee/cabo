resource "google_pubsub_topic" "profile_image_responses" {
  name = "profile-image-responses"
  project = var.project_id
  
  message_retention_duration = "86400s"  # 24 hours
  
  labels = {
    purpose = "profile-image-processing"
  }
}

resource "google_pubsub_subscription" "profile_image_responses" {
  name  = "profile-image-responses-sub"
  topic = google_pubsub_topic.profile_image_responses.name
  
  ack_deadline_seconds = 600  # 10 minutes
  
  expiration_policy {
    ttl = "2592000s"  # 30 days
  }
  
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"  # 10 minutes
  }
  
  push_config {
    push_endpoint = module.profile_image_response_function.function_url
    
    attributes = {
      x-goog-version = "v1"
    }
  }
} 