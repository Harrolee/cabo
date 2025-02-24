# Create service accounts for each function
resource "google_service_account" "function_service_accounts" {
  for_each     = var.service_account_roles
  account_id   = "${each.key}-${var.environment}"
  display_name = "Service Account for ${each.key} (${var.environment})"
  project      = var.project_id
}

# Assign roles to service accounts
resource "google_project_iam_member" "function_roles" {
  for_each = {
    for pair in flatten([
      for sa_name, roles in var.service_account_roles : [
        for role in roles : {
          sa_name = sa_name
          role    = role
        }
      ]
    ]) : "${pair.sa_name}-${pair.role}" => pair
  }

  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.function_service_accounts[each.value.sa_name].email}"
}

# Create a service account for Cloud Run
resource "google_service_account" "cloud_run" {
  account_id   = "cloud-run-${var.environment}"
  display_name = "Cloud Run Service Account (${var.environment})"
  project      = var.project_id
}

# Create a service account for function invocation
resource "google_service_account" "function_invoker" {
  account_id   = "function-invoker-${var.environment}"
  display_name = "Function Invoker Service Account (${var.environment})"
  project      = var.project_id
} 