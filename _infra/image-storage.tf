resource "google_storage_bucket" "image_bucket" {
  name                        = "${var.project_id}-image-bucket"
  location                    = var.region
  uniform_bucket_level_access = true

  # Optional: Configure CORS if needed
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }

  # Add lifecycle rule to clean up old generated images
  lifecycle_rule {
    condition {
      age = 7  # Delete generated images after 7 days
      matches_prefix = ["generated-images/"]
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_object" "call_to_action_image" {
  name   = "call-to-action.jpg"
  source = "${path.root}/../static_assets/call-to-action.jpg"
  bucket = google_storage_bucket.image_bucket.name
}

resource "google_storage_bucket_iam_member" "public_read_image" {
  bucket = google_storage_bucket.image_bucket.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_storage_bucket_object" "expanded_call_to_action_image" {
  name   = "expanded-call-to-action.jpg"
  source = "${path.root}/../static_assets/expanded-call-to-action.jpg"
  bucket = google_storage_bucket.image_bucket.name
}

resource "google_storage_bucket_iam_member" "public_read_expanded_image" {
  bucket = google_storage_bucket.image_bucket.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Create empty folder for generated images
resource "google_storage_bucket_object" "generated_images_folder" {
  name    = "generated-images/"  # Trailing slash is important
  content = " "                  # Single space as content
  bucket  = google_storage_bucket.image_bucket.name
} 