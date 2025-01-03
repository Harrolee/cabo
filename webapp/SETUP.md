# Workout Motivation App - Setup Guide

This guide covers the complete setup process for deploying the workout motivation application on Google Cloud Platform.

## Prerequisites

1. Google Cloud Platform account with billing enabled
2. GitHub repository
3. Twilio account
4. Supabase account
5. Terraform installed locally
6. Google Cloud CLI installed locally

## Initial Setup

### 1. Google Cloud Project Setup

#### Set your project ID

export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID

#### Enable required APIs

```bash
gcloud services enable \
cloudfunctions.googleapis.com \
cloudscheduler.googleapis.com \
artifactregistry.googleapis.com \
run.googleapis.com \
secretmanager.googleapis.com \
iam.googleapis.com
```

### 2. Create terraform.tfvars

Create `webapp/terraform/terraform.tfvars` with the following content:

```hcl
project_id = "your-project-id"
region = "us-central1"
twilio_account_sid = "your-twilio-sid"
twilio_auth_token = "your-twilio-token"
twilio_phone_number = "your-twilio-number"
supabase_url = "your-supabase-url"
supabase_service_role_key = "your-supabase-service-role-key"
supabase_public_key = "your-supabase-anon-key"
github_repo = "your-org/your-repo"
```

### 3. GitHub Repository Setup

Add these secrets to your GitHub repository:

- `GCP_PROJECT_ID`: Your Google Cloud project ID
- `GCP_SA_EMAIL`: Service account email (available after Terraform apply)
- `GCP_WORKLOAD_IDENTITY_PROVIDER`: Workload Identity Provider name (available after Terraform apply)

## Deployment Steps

### 1. Initialize and Apply Terraform

```bash
cd webapp/terraform
terraform init
terraform plan
terraform apply
```

### 2. Configure GitHub Actions

After Terraform apply completes, get the required values for GitHub secrets:

```bash
terraform output service_account_email # Use for GCP_SA_EMAIL
terraform output workload_identity_provider # Use for GCP_WORKLOAD_IDENTITY_PROVIDER
```

### 3. Initial Container Deployment

Push your first commit to the main branch to trigger the GitHub Actions workflow, which will:

1. Build the Docker container
2. Push it to Artifact Registry
3. Deploy it to Cloud Run

## Infrastructure Components

### Cloud Function

- Runs on a schedule to generate and send motivational images
- Environment variables needed:
  - TWILIO_ACCOUNT_SID
  - TWILIO_AUTH_TOKEN
  - TWILIO_PHONE_NUMBER
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY

### Cloud Run

- Hosts the web application
- Environment variables configured:
  - SUPABASE_URL
  - SUPABASE_PUBLIC_KEY (stored in Secret Manager)

### Artifact Registry

- Stores Docker container images
- Configured with GitHub Actions for automated deployments

### Secret Manager

- Stores sensitive environment variables
- Currently storing:
  - Supabase public key

## Security Considerations

1. Service Accounts:

   - GitHub Actions service account: Limited to Artifact Registry push access
   - Cloud Run service account: Limited to Secret Manager access
   - Cloud Function service account: Access to Twilio and Supabase

2. Workload Identity:

   - GitHub Actions authenticated via Workload Identity Federation
   - No long-lived credentials stored in GitHub

3. Secrets:
   - All sensitive values stored in Secret Manager or environment variables
   - No secrets committed to the repository

## Monitoring and Maintenance

1. Cloud Function logs:

```bash
gcloud functions logs read send-motivational-images
```

2. Cloud Run logs:

```bash
gcloud run services logs read workout-motivation-webapp
```

3. Container Images:

```bash
gcloud artifacts docker images list \
${REGION}-docker.pkg.dev/${PROJECT_ID}/workout-app/workout-webapp
```

## Troubleshooting

1. If GitHub Actions fail:

   - Verify the GitHub secrets are correctly set
   - Check the service account permissions
   - Verify the Workload Identity configuration

2. If Cloud Run deployment fails:

   - Check the container logs
   - Verify the environment variables
   - Check the service account permissions

3. If Cloud Function fails:
   - Check the function logs
   - Verify Twilio credentials
   - Check Supabase connection

## Cleanup

To destroy all resources:

```bash
cd webapp/terraform
terraform destroy
```

Note: This will remove all infrastructure components. Make sure to backup any important data before proceeding.
