# Create service accounts for cloud functions
resource "google_service_account" "process_sms" {
  account_id   = "process-sms-function"
  display_name = "Service Account for Process SMS Function"
  project      = var.project_id
}

resource "google_service_account" "motivational_images" {
  account_id   = "motivational-images-function"
  display_name = "Service Account for Motivational Images Function"
  project      = var.project_id
}

resource "google_service_account" "signup" {
  account_id   = "signup-function"
  display_name = "Service Account for Signup Function"
  project      = var.project_id
}

resource "google_service_account" "cancel_stripe_subscription" {
  account_id   = "cancel-stripe-sub"
  display_name = "Service Account for Cancel Stripe Subscription Function"
  project      = var.project_id
}

# Coach Builder service accounts
resource "google_service_account" "coach_content_processor" {
  account_id   = "coach-content-processor"
  display_name = "Service Account for Coach Content Processor Function"
  project      = var.project_id
}

resource "google_service_account" "coach_response_generator" {
  account_id   = "coach-response-generator"
  display_name = "Service Account for Coach Response Generator Function"
  project      = var.project_id
}

resource "google_service_account" "coach_file_uploader" {
  account_id   = "coach-file-uploader"
  display_name = "Service Account for Coach File Uploader Function"
  project      = var.project_id
}

resource "google_service_account" "coach_avatar_generator" {
  account_id   = "coach-avatar-generator"
  display_name = "Service Account for Coach Avatar Generator Function"
  project      = var.project_id
}

# Create conversation storage bucket
resource "google_storage_bucket" "conversation_storage" {
  name          = "${var.project_id}-${var.conversation_bucket_name}"
  location      = var.conversation_bucket_location
  force_destroy = true

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = 365  # Keep conversations for 1 year
    }
    action {
      type = "Delete"
    }
  }
}

# Grant necessary roles to the service accounts
resource "google_project_iam_member" "process_sms_roles" {
  for_each = toset([
    "roles/cloudfunctions.invoker",
    "roles/storage.objectViewer",
    "roles/logging.logWriter"
  ])
  
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.process_sms.email}"
}

resource "google_project_iam_member" "signup_roles" {
  for_each = toset([
    "roles/cloudfunctions.invoker",
    "roles/storage.objectViewer",
    "roles/logging.logWriter"
  ])
  
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.signup.email}"
}

resource "google_project_iam_member" "cancel_stripe_subscription_roles" {
  for_each = toset([
    "roles/cloudfunctions.invoker",
    "roles/logging.logWriter"
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.cancel_stripe_subscription.email}"
}

# Coach Builder service account roles
resource "google_project_iam_member" "coach_content_processor_roles" {
  for_each = toset([
    "roles/cloudfunctions.invoker",
    "roles/storage.objectViewer",
    "roles/storage.objectUser",
    "roles/logging.logWriter"
  ])
  
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.coach_content_processor.email}"
}

resource "google_project_iam_member" "coach_response_generator_roles" {
  for_each = toset([
    "roles/cloudfunctions.invoker",
    "roles/logging.logWriter"
  ])
  
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.coach_response_generator.email}"
}

resource "google_project_iam_member" "coach_file_uploader_roles" {
  for_each = toset([
    "roles/cloudfunctions.invoker",
    "roles/storage.objectUser",
    "roles/logging.logWriter",
    "roles/iam.serviceAccountTokenCreator"
  ])
  
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.coach_file_uploader.email}"
}

resource "google_project_iam_member" "coach_avatar_generator_roles" {
  for_each = toset([
    "roles/cloudfunctions.invoker",
    "roles/storage.objectUser",
    "roles/logging.logWriter",
    "roles/iam.serviceAccountTokenCreator"
  ])
  
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.coach_avatar_generator.email}"
}

# Allow the coach file uploader service account to create tokens for itself
resource "google_service_account_iam_member" "coach_file_uploader_self_token_creator" {
  service_account_id = google_service_account.coach_file_uploader.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.coach_file_uploader.email}"
}

# Grant the cloud functions access to the conversation bucket
resource "google_storage_bucket_iam_member" "process_sms_conversation_access" {
  bucket = google_storage_bucket.conversation_storage.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.process_sms.email}"
}

resource "google_storage_bucket_iam_member" "signup_conversation_access" {
  bucket = google_storage_bucket.conversation_storage.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.signup.email}"
}

resource "google_storage_bucket_iam_member" "motivational_images_conversation_access" {
  bucket = google_storage_bucket.conversation_storage.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.motivational_images.email}"
}

# Grant Coach Builder functions access to the coach content bucket
resource "google_storage_bucket_iam_member" "coach_content_processor_bucket_access" {
  bucket = google_storage_bucket.coach_content_bucket.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.coach_content_processor.email}"
}

resource "google_storage_bucket_iam_member" "coach_file_uploader_bucket_access" {
  bucket = google_storage_bucket.coach_content_bucket.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.coach_file_uploader.email}"
}

resource "google_storage_bucket_iam_member" "coach_avatar_generator_content_bucket_access" {
  bucket = google_storage_bucket.coach_content_bucket.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.coach_avatar_generator.email}"
}

# Grant the motivational images function access to the image bucket
resource "google_storage_bucket_iam_member" "motivational_images_bucket_access" {
  bucket = "${var.project_id}-image-bucket"
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.motivational_images.email}"
}

# Grant the avatar generator function access to the image bucket
resource "google_storage_bucket_iam_member" "coach_avatar_generator_image_bucket_access" {
  bucket = "${var.project_id}-image-bucket"
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.coach_avatar_generator.email}"
}

resource "google_project_iam_member" "motivational_images_roles" {
  for_each = toset([
    "roles/cloudfunctions.invoker",
    "roles/storage.objectViewer",
    "roles/logging.logWriter",
    "roles/iam.serviceAccountTokenCreator"
  ])
  
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.motivational_images.email}"
}

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

data "archive_file" "create_setup_intent_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/create-setup-intent"
  output_path = "${path.root}/tmp/create-setup-intent.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "cancel_stripe_subscription_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/cancel-stripe-subscription"
  output_path = "${path.root}/tmp/cancel-stripe-subscription.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "admin_api_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/admin-api"
  output_path = "${path.root}/tmp/admin-api.zip"
  excludes    = ["node_modules"]
}

# Coach Builder function ZIP archives
data "archive_file" "coach_content_processor_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/coach-content-processor"
  output_path = "${path.root}/tmp/coach-content-processor.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "coach_response_generator_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/coach-response-generator"
  output_path = "${path.root}/tmp/coach-response-generator.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "coach_file_uploader_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/coach-file-uploader"
  output_path = "${path.root}/tmp/coach-file-uploader.zip"
  excludes    = ["node_modules"]
}

data "archive_file" "coach_avatar_generator_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/coach-avatar-generator"
  output_path = "${path.root}/tmp/coach-avatar-generator.zip"
  excludes    = ["node_modules"]
}

# Engagement orchestrator package
data "archive_file" "engagement_orchestrator_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/engagement-orchestrator"
  output_path = "${path.root}/tmp/engagement-orchestrator.zip"
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

resource "google_storage_bucket_object" "create_setup_intent_source" {
  name   = "create-setup-intent-${data.archive_file.create_setup_intent_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.create_setup_intent_zip.output_path
}

resource "google_storage_bucket_object" "cancel_stripe_subscription_source" {
  name   = "cancel-stripe-subscription-${data.archive_file.cancel_stripe_subscription_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.cancel_stripe_subscription_zip.output_path
}

resource "google_storage_bucket_object" "admin_api_source" {
  name   = "admin-api-${data.archive_file.admin_api_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.admin_api_zip.output_path
}

# Coach Builder function sources
resource "google_storage_bucket_object" "coach_content_processor_source" {
  name   = "coach-content-processor-${data.archive_file.coach_content_processor_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.coach_content_processor_zip.output_path
}

resource "google_storage_bucket_object" "coach_response_generator_source" {
  name   = "coach-response-generator-${data.archive_file.coach_response_generator_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.coach_response_generator_zip.output_path
}

resource "google_storage_bucket_object" "coach_file_uploader_source" {
  name   = "coach-file-uploader-${data.archive_file.coach_file_uploader_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.coach_file_uploader_zip.output_path
}

resource "google_storage_bucket_object" "coach_avatar_generator_source" {
  name   = "coach-avatar-generator-${data.archive_file.coach_avatar_generator_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.coach_avatar_generator_zip.output_path
}

resource "google_storage_bucket_object" "engagement_orchestrator_source" {
  name   = "engagement-orchestrator-${data.archive_file.engagement_orchestrator_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.engagement_orchestrator_zip.output_path
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
  service_account_email = google_service_account.motivational_images.email
  
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
    CONVERSATION_BUCKET_NAME = var.conversation_bucket_name
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
  service_account_email = google_service_account.signup.email
  
  environment_variables = {
    SUPABASE_URL             = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    ALLOWED_ORIGINS          = var.allowed_origins
    TWILIO_ACCOUNT_SID       = var.twilio_account_sid
    TWILIO_AUTH_TOKEN        = var.twilio_auth_token
    TWILIO_PHONE_NUMBER      = var.twilio_phone_number
    CONVERSATION_BUCKET_NAME = var.conversation_bucket_name
    PROJECT_ID              = var.project_id
  }
  depends_on = [google_storage_bucket_object.signup_source]
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
  service_account_email = google_service_account.process_sms.email
  
  environment_variables = {
    OPENAI_API_KEY             = var.openai_api_key
    SUPABASE_URL              = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    TWILIO_ACCOUNT_SID        = var.twilio_account_sid
    TWILIO_AUTH_TOKEN         = var.twilio_auth_token
    PROJECT_ID                = var.project_id
    CONVERSATION_BUCKET_NAME  = var.conversation_bucket_name
    GCP_FUNCTION_BASE_URL     = "https://us-central1-${var.project_id}.cloudfunctions.net"
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
    STRIPE_SECRET_KEY        = var.stripe_secret_key
    STRIPE_PRICE_ID          = var.stripe_price_id
    ALLOWED_ORIGINS         = var.allowed_origins
    SUPABASE_URL           = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
  }
  depends_on = [google_storage_bucket_object.create_stripe_subscription_source]
}

module "create_setup_intent_function" {
  source = "./modules/cloud_function"
  
  name        = "create-setup-intent"
  description = "Function to create Stripe setup intents"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.create_setup_intent_source.name
  entry_point = "createSetupIntent"
  
  environment_variables = {
    STRIPE_SECRET_KEY        = var.stripe_secret_key
    ALLOWED_ORIGINS         = var.allowed_origins
    SUPABASE_URL           = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
  }
  depends_on = [google_storage_bucket_object.create_setup_intent_source]
}

module "cancel_stripe_subscription_function" {
  source = "./modules/cloud_function"
  
  name        = "cancel-stripe-subscription"
  description = "Function to cancel Stripe subscriptions"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.cancel_stripe_subscription_source.name
  entry_point = "cancelStripeSubscription"
  service_account_email = google_service_account.cancel_stripe_subscription.email
  
  environment_variables = {
    STRIPE_SECRET_KEY        = var.stripe_secret_key
    SUPABASE_URL             = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    ALLOWED_ORIGINS          = var.allowed_origins
  }
  depends_on = [google_storage_bucket_object.cancel_stripe_subscription_source]
}

module "admin_api_function" {
  source = "./modules/cloud_function"

  name        = "admin-api"
  description = "Admin API for user management and chat logs"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.admin_api_source.name
  entry_point = "adminApi"

  environment_variables = {
    PROJECT_ID                = var.project_id
    SUPABASE_URL              = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    CONVERSATION_BUCKET_NAME  = var.conversation_bucket_name
    ADMIN_EMAILS              = var.admin_emails
    ADMIN_PHONES              = var.admin_phones
    ALLOWED_ORIGINS           = var.allowed_origins
  }

  depends_on = [google_storage_bucket_object.admin_api_source]
}

# Coach Builder Cloud Functions
module "coach_content_processor_function" {
  source = "./modules/cloud_function"
  
  name        = "coach-content-processor"
  description = "Function to process uploaded coach content files"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.coach_content_processor_source.name
  entry_point = "processCoachContent"
  memory      = "1Gi"
  timeout     = 300
  service_account_email = google_service_account.coach_content_processor.email
  
  environment_variables = {
    PROJECT_ID               = var.project_id
    GCP_STORAGE_BUCKET      = google_storage_bucket.coach_content_bucket.name
    SUPABASE_URL            = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    OPENAI_API_KEY          = var.openai_api_key
    ALLOWED_ORIGINS         = var.allowed_origins
  }
  depends_on = [google_storage_bucket_object.coach_content_processor_source]
}

module "coach_response_generator_function" {
  source = "./modules/cloud_function"
  
  name        = "coach-response-generator"
  description = "Function to generate AI coach responses"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.coach_response_generator_source.name
  entry_point = "generateCoachResponse"
  memory      = "512M"
  timeout     = 60
  service_account_email = google_service_account.coach_response_generator.email
  
  environment_variables = {
    PROJECT_ID               = var.project_id
    SUPABASE_URL            = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    OPENAI_API_KEY          = var.openai_api_key
    ALLOWED_ORIGINS         = var.allowed_origins
  }
  depends_on = [google_storage_bucket_object.coach_response_generator_source]
}

module "coach_file_uploader_function" {
  source = "./modules/cloud_function"
  
  name        = "coach-file-uploader"
  description = "Function to handle coach content file uploads"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.coach_file_uploader_source.name
  entry_point = "coachFileUploader"
  memory      = "256M"
  timeout     = 60
  service_account_email = google_service_account.coach_file_uploader.email
  
  environment_variables = {
    PROJECT_ID                    = var.project_id
    GCP_STORAGE_BUCKET           = google_storage_bucket.coach_content_bucket.name
    SUPABASE_URL                 = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY    = var.supabase_service_role_key
    COACH_CONTENT_PROCESSOR_URL  = module.coach_content_processor_function.url
    ALLOWED_ORIGINS              = var.allowed_origins
  }
  depends_on = [
    google_storage_bucket_object.coach_file_uploader_source,
    module.coach_content_processor_function
  ]
}

module "coach_avatar_generator_function" {
  source = "./modules/cloud_function"
  
  name        = "coach-avatar-generator"
  description = "Function to generate professional avatars from coach selfies"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.coach_avatar_generator_source.name
  entry_point = "generateCoachAvatar"
  memory      = "1Gi"
  timeout     = 540  # 9 minutes for AI image generation
  service_account_email = google_service_account.coach_avatar_generator.email
  
  environment_variables = {
    PROJECT_ID               = var.project_id
    SUPABASE_URL            = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    REPLICATE_API_TOKEN     = var.replicate_api_key
    ALLOWED_ORIGINS         = var.allowed_origins
  }
  depends_on = [google_storage_bucket_object.coach_avatar_generator_source]
}

module "engagement_orchestrator_function" {
  source = "./modules/cloud_function"
  name        = "engagement-orchestrator"
  description = "Orchestrates text/image content generation for engagements"
  region      = var.region
  bucket_name = google_storage_bucket.function_bucket.name
  source_object = google_storage_bucket_object.engagement_orchestrator_source.name
  entry_point = "orchestrateEngagement"
  memory      = "512M"
  timeout     = 120
  service_account_email = google_service_account.coach_avatar_generator.email
  environment_variables = {
    SUPABASE_URL              = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    GCP_FUNCTION_BASE_URL     = module.coach_response_generator_function.url
    ALLOWED_ORIGINS           = var.allowed_origins
  }
  depends_on = [google_storage_bucket_object.engagement_orchestrator_source, module.coach_response_generator_function]
}

resource "google_cloud_run_service_iam_member" "engagement_orchestrator_invoker" {
  location = module.engagement_orchestrator_function.function.location
  service  = module.engagement_orchestrator_function.function.name
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

resource "google_cloud_run_service_iam_member" "create_setup_intent_invoker" {
  location = module.create_setup_intent_function.function.location
  service  = module.create_setup_intent_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "cancel_stripe_subscription_invoker" {
  location = module.cancel_stripe_subscription_function.function.location
  service  = module.cancel_stripe_subscription_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "admin_api_invoker" {
  location = module.admin_api_function.function.location
  service  = module.admin_api_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Coach Builder function invokers
resource "google_cloud_run_service_iam_member" "coach_content_processor_invoker" {
  location = module.coach_content_processor_function.function.location
  service  = module.coach_content_processor_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "coach_response_generator_invoker" {
  location = module.coach_response_generator_function.function.location
  service  = module.coach_response_generator_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "coach_file_uploader_invoker" {
  location = module.coach_file_uploader_function.function.location
  service  = module.coach_file_uploader_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "coach_avatar_generator_invoker" {
  location = module.coach_avatar_generator_function.function.location
  service  = module.coach_avatar_generator_function.function.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}