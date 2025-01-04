variable "project_id" {
  description = "The Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "The region to deploy resources to"
  type        = string
  default     = "us-central1"
}

variable "twilio_account_sid" {
  description = "Twilio Account SID"
  type        = string
  sensitive   = true
}

variable "twilio_auth_token" {
  description = "Twilio Auth Token"
  type        = string
  sensitive   = true
}

variable "twilio_phone_number" {
  description = "Twilio Phone Number"
  type        = string
}

variable "supabase_url" {
  description = "Supabase Project URL"
  type        = string
}

variable "supabase_service_role_key" {
  description = "Supabase Service Role Key"
  type        = string
  sensitive   = true
}

variable "repository_name" {
  description = "Name of the Artifact Registry repository"
  type        = string
  default     = "workout-app"
}

variable "github_repo" {
  description = "GitHub repository in format: OWNER/REPOSITORY"
  type        = string
}

variable "image_name" {
  description = "Name of the container image"
  type        = string
  default     = "workout-webapp"
}

variable "supabase_public_key" {
  description = "Supabase Public Key (anon key)"
  type        = string
  sensitive   = true
}

variable "replicate_api_token" {
  description = "Replicate API Token"
  type        = string
  sensitive   = true
}

variable "cloud_function_url" {
  description = "URL of the Cloud Function"
  type        = string
}

variable "signup_function_url" {
  description = "URL of the Signup Cloud Function"
  type        = string
}

variable "allowed_origins" {
  description = "Comma-separated list of allowed origins for CORS"
  type        = string
  default     = "http://localhost:5173,https://workout-motivation-webapp-206335683265.us-central1.run.app"
} 