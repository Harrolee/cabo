variable "project_id" {
  description = "The Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "The region to deploy resources to"
  type        = string
}

variable "environment" {
  description = "The environment (dev/prod)"
  type        = string
}

variable "function_source_bucket" {
  description = "The bucket object for function source code"
  type        = any
}

variable "service_accounts" {
  description = "Map of service accounts for functions"
  type        = map(any)
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

variable "supabase_anon_key" {
  description = "Supabase Anonymous Key"
  type        = string
  sensitive   = true
} 