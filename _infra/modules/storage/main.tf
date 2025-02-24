# Function source bucket
resource "google_storage_bucket" "function_source" {
  name          = "${var.project_id}-${var.environment}-${var.function_source_bucket_name}"
  location      = var.region
  force_destroy = true

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }
}

# Conversation storage bucket
resource "google_storage_bucket" "conversation_storage" {
  name          = "${var.project_id}-${var.environment}-${var.conversation_bucket_name}"
  location      = var.conversation_bucket_location
  force_destroy = true

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = 365  # Keep conversations for 1 year
    }
    action {
      type = "Delete"
    }
  }
} 