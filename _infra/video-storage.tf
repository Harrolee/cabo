# Create a Cloud Storage bucket for videos
resource "google_storage_bucket" "workout_videos" {
  name                        = "${var.project_id}-workout-videos"
  location                    = var.region
  uniform_bucket_level_access = true
  
  # Enable website access
  website {
    main_page_suffix = "index.html"
  }

  # Optional: Configure CORS if needed
  cors {
    origin          = ["*"]  # You might want to restrict this to your domain
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }
}

# Make the bucket public
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.workout_videos.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Dynamically create storage objects for all MP4 files in assets directory
locals {
  video_files = fileset("${path.root}/../assets", "*.mp4")
}

resource "google_storage_bucket_object" "workout_videos" {
  for_each = local.video_files
  
  name   = "videos/${each.value}"
  source = "${path.root}/../assets/${each.value}"
  bucket = google_storage_bucket.workout_videos.name
} 