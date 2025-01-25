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
  description = "Supabase service role key for backend access"
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

variable "replicate_api_key" {
  description = "API key for Replicate AI service"
  type        = string
  sensitive   = true
}



variable "allowed_origins" {
  description = "Comma-separated list of allowed origins for CORS"
  type        = string
  default     = "http://localhost:5173"
}

variable "openai_api_key" {
  description = "API key for OpenAI"
  type        = string
  sensitive   = true
}

variable "stripe_secret_key" {
  description = "Stripe Secret Key"
  type        = string
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Stripe Webhook Secret"
  type        = string
  sensitive   = true
}

variable "stripe_price_id" {
  description = "Stripe Price ID for subscription"
  type        = string
}

variable "stripe_public_key" {
  description = "Stripe Public Key"
  type        = string
  sensitive   = true
} 