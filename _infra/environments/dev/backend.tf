terraform {
  backend "gcs" {
    bucket = "dev-cabo-451902-terraform-state"
    prefix = "terraform/state"
  }
} 