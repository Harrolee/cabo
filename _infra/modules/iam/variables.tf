variable "project_id" {
  description = "The Google Cloud Project ID"
  type        = string
}

variable "environment" {
  description = "The environment (dev/prod)"
  type        = string
}

variable "region" {
  description = "The region to deploy resources to"
  type        = string
}

variable "service_account_roles" {
  description = "Map of service account names to their roles"
  type = map(list(string))
  default = {
    "process-sms" = [
      "roles/cloudfunctions.invoker",
      "roles/storage.objectViewer",
      "roles/logging.logWriter"
    ],
    "motivational-images" = [
      "roles/cloudfunctions.invoker",
      "roles/storage.objectViewer",
      "roles/logging.logWriter"
    ],
    "signup" = [
      "roles/cloudfunctions.invoker",
      "roles/storage.objectViewer",
      "roles/logging.logWriter"
    ]
  }
} 