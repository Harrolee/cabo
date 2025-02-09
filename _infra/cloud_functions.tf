# Create ZIP archives for each function
data "archive_file" "motivational_images_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/motivational-images"
  output_path = "${path.root}/tmp/motivational-images.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "signup_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/signup"
  output_path = "${path.root}/tmp/signup.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "setup_stripe_subscription_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/setup-stripe-subscription"
  output_path = "${path.root}/tmp/setup-stripe-subscription.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "stripe_webhook_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/stripe-webhook"
  output_path = "${path.root}/tmp/stripe-webhook.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "process_sms_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/process-sms"
  output_path = "${path.root}/tmp/process-sms.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "get_user_data_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/get-user-data"
  output_path = "${path.root}/tmp/get-user-data.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "create_stripe_subscription_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/create-stripe-subscription"
  output_path = "${path.root}/tmp/create-stripe-subscription.zip"
  excludes    = ["node_modules"]
}

# Upload the function sources to Cloud Storage
resource "google_storage_bucket_object" "motivational_images_source" {
  name   = "motivational-images-${data.archive_file.motivational_images_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.motivational_images_zip.output_path
}

resource "google_storage_bucket_object" "signup_source" {
  name   = "signup-${data.archive_file.signup_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.signup_zip.output_path
}

resource "google_storage_bucket_object" "setup_stripe_subscription_source" {
  name   = "setup-stripe-subscription-${data.archive_file.setup_stripe_subscription_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.setup_stripe_subscription_zip.output_path
}

resource "google_storage_bucket_object" "stripe_webhook_source" {
  name   = "stripe-webhook-${data.archive_file.stripe_webhook_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.stripe_webhook_zip.output_path
}

resource "google_storage_bucket_object" "process_sms_source" {
  name   = "process-sms-${data.archive_file.process_sms_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.process_sms_zip.output_path
}

resource "google_storage_bucket_object" "get_user_data_source" {
  name   = "get-user-data-${data.archive_file.get_user_data_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.get_user_data_zip.output_path
}

resource "google_storage_bucket_object" "create_stripe_subscription_source" {
  name   = "create-stripe-subscription-${data.archive_file.create_stripe_subscription_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.create_stripe_subscription_zip.output_path
}

# Deploy Cloud Functions using the module
module "motivation_function" {
  source = "./modules/cloud_function"
  
  name        = "send-motivational-images"
  description = "Function to send motivational images to users"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.motivational_images_source.name
  entry_point = "sendMotivationalImages"
  memory      = "256M"
  timeout     = 300
  
  environment_variables = {
    PROJECT_ID              = var.project_id
    TWILIO_ACCOUNT_SID     = var.twilio_account_sid
    TWILIO_AUTH_TOKEN      = var.twilio_auth_token
    TWILIO_PHONE_NUMBER    = var.twilio_phone_number
    SUPABASE_URL           = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    REPLICATE_API_TOKEN    = var.replicate_api_key
    ALLOWED_ORIGINS        = var.allowed_origins
    OPENAI_API_KEY         = var.openai_api_key
  }
  depends_on = [google_storage_bucket_object.motivational_images_source]
}

module "signup_function" {
  source = "./modules/cloud_function"
  
  name        = "handle-user-signup"
  description = "Function to handle new user signups"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.signup_source.name
  entry_point = "handleSignup"
  
  environment_variables = {
    SUPABASE_URL             = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    ALLOWED_ORIGINS          = var.allowed_origins
    TWILIO_ACCOUNT_SID       = var.twilio_account_sid
    TWILIO_AUTH_TOKEN        = var.twilio_auth_token
    TWILIO_PHONE_NUMBER      = var.twilio_phone_number
  }
  depends_on = [google_storage_bucket_object.signup_source]
}

module "setup_stripe_subscription_function" {
  source = "./modules/cloud_function"
  
  name        = "setup-stripe-subscription"
  description = "Function to create Stripe subscriptions"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.setup_stripe_subscription_source.name
  entry_point = "setupStripeSubscription"
  service_account_email = google_service_account.function_invoker.email
  
  environment_variables = {
    STRIPE_SECRET_KEY = var.stripe_secret_key
    STRIPE_PRICE_ID   = var.stripe_price_id
    ALLOWED_ORIGINS   = var.allowed_origins
    SUPABASE_URL            = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
  }
  depends_on = [google_storage_bucket_object.setup_stripe_subscription_source]
}

module "stripe_webhook_function" {
  source = "./modules/cloud_function"
  
  name        = "stripe-webhook"
  description = "Function to handle Stripe webhook events"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.stripe_webhook_source.name
  entry_point = "stripeWebhook"
  
  environment_variables = {
    STRIPE_SECRET_KEY        = var.stripe_secret_key
    STRIPE_WEBHOOK_SECRET    = var.stripe_webhook_secret
    SUPABASE_URL            = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
  }
  depends_on = [google_storage_bucket_object.stripe_webhook_source]
}

module "process_sms_function" {
  source = "./modules/cloud_function"
  
  name        = "process-sms"
  description = "Function to process incoming SMS messages and set user spice levels"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.process_sms_source.name
  entry_point = "processSms"
  
  environment_variables = {
    OPENAI_API_KEY         = var.openai_api_key
    TWILIO_ACCOUNT_SID     = var.twilio_account_sid
    TWILIO_AUTH_TOKEN      = var.twilio_auth_token
    TWILIO_PHONE_NUMBER    = var.twilio_phone_number
    SUPABASE_URL          = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    FUNCTION_URL          = "https://${var.region}-${var.project_id}.cloudfunctions.net/process-sms"
  }
  depends_on = [google_storage_bucket_object.process_sms_source]
}

module "get_user_data_function" {
  source = "./modules/cloud_function"
  
  name        = "get-user-data"
  description = "Function to get user data for payment form"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.get_user_data_source.name
  entry_point = "getUserData"
  
  environment_variables = {
    SUPABASE_URL             = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    ALLOWED_ORIGINS          = var.allowed_origins
  }
  depends_on = [google_storage_bucket_object.get_user_data_source]
}

module "create_stripe_subscription_function" {
  source = "./modules/cloud_function"
  
  name        = "create-stripe-subscription"
  description = "Function to create Stripe subscriptions"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.create_stripe_subscription_source.name
  entry_point = "createStripeSubscription"
  
  environment_variables = {
    STRIPE_SECRET_KEY = var.stripe_secret_key
    STRIPE_PRICE_ID   = var.stripe_price_id
    ALLOWED_ORIGINS   = var.allowed_origins
  }
  depends_on = [google_storage_bucket_object.create_stripe_subscription_source]
}

# IAM policies for functions
resource "google_cloud_run_service_iam_member" "setup_stripe_subscription_invoker" {
  location = module.setup_stripe_subscription_function.function.location
  service  = module.setup_stripe_subscription_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "process_sms_invoker" {
  location = module.process_sms_function.function.location
  service  = module.process_sms_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "stripe_webhook_invoker" {
  location = module.stripe_webhook_function.function.location
  service  = module.stripe_webhook_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "get_user_data_invoker" {
  location = module.get_user_data_function.function.location
  service  = module.get_user_data_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "create_stripe_subscription_invoker" {
  location = module.create_stripe_subscription_function.function.location
  service  = module.create_stripe_subscription_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
} 