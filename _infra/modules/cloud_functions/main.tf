# Cloud Functions
module "process_sms" {
  source = "../cloud_function"

  function_name     = "process-sms-${var.environment}"
  project_id        = var.project_id
  region           = var.region
  source_bucket    = var.function_source_bucket
  service_account  = var.service_accounts["process-sms"]
  
  environment_variables = {
    TWILIO_ACCOUNT_SID = var.twilio_account_sid
    TWILIO_AUTH_TOKEN  = var.twilio_auth_token
    TWILIO_PHONE_NUMBER = var.twilio_phone_number
    SUPABASE_URL       = var.supabase_url
    SUPABASE_ANON_KEY  = var.supabase_anon_key
    ENVIRONMENT        = var.environment
  }
}

module "motivational_images" {
  source = "../cloud_function"

  function_name     = "motivational-images-${var.environment}"
  project_id        = var.project_id
  region           = var.region
  source_bucket    = var.function_source_bucket
  service_account  = var.service_accounts["motivational-images"]
  
  environment_variables = {
    SUPABASE_URL      = var.supabase_url
    SUPABASE_ANON_KEY = var.supabase_anon_key
    ENVIRONMENT       = var.environment
  }
}

module "signup" {
  source = "../cloud_function"

  function_name     = "signup-${var.environment}"
  project_id        = var.project_id
  region           = var.region
  source_bucket    = var.function_source_bucket
  service_account  = var.service_accounts["signup"]
  
  environment_variables = {
    TWILIO_ACCOUNT_SID  = var.twilio_account_sid
    TWILIO_AUTH_TOKEN   = var.twilio_auth_token
    TWILIO_PHONE_NUMBER = var.twilio_phone_number
    SUPABASE_URL       = var.supabase_url
    SUPABASE_ANON_KEY  = var.supabase_anon_key
    ENVIRONMENT        = var.environment
  }
}

# Cloud Scheduler for daily motivation
resource "google_cloud_scheduler_job" "daily_motivation" {
  name        = "trigger-daily-motivation-${var.environment}"
  description = "Triggers the motivation function daily"
  schedule    = "0 9 * * *"
  time_zone   = "America/New_York"

  http_target {
    http_method = "POST"
    uri         = module.motivational_images.function_url

    oidc_token {
      service_account_email = var.service_accounts["motivational-images"].email
    }
  }
} 