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

variable "conversation_bucket_name" {
  description = "Name of the bucket to store conversations"
  type        = string
  default     = "conversations"
}

variable "conversation_bucket_location" {
  description = "Location of the conversation bucket"
  type        = string
  default     = "US"
}

variable "function_source_bucket_name" {
  description = "Name of the bucket to store function source code"
  type        = string
  default     = "function-source"
} 