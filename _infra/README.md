# Infrastructure Setup

This directory contains Terraform configuration for deploying the Coach Builder system infrastructure to Google Cloud Platform.

## Prerequisites

1. **Google Cloud SDK**: Install and configure `gcloud`
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

2. **Terraform**: Install Terraform CLI
   ```bash
   # macOS
   brew install terraform
   
   # Or download from https://terraform.io/downloads
   ```

3. **Required APIs**: Enable the following GCP APIs:
   ```bash
   gcloud services enable cloudfunctions.googleapis.com
   gcloud services enable storage.googleapis.com
   gcloud services enable cloudscheduler.googleapis.com
   gcloud services enable secretmanager.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   ```

## Configuration

1. **Copy the example variables file**:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

2. **Edit `terraform.tfvars`** with your actual values:
   - GCP project ID
   - Supabase credentials
   - OpenAI API key
   - Stripe keys
   - Twilio credentials
   - Other service credentials

3. **Set up Terraform backend** (optional but recommended):
   - Create a GCS bucket for Terraform state
   - Update the backend configuration in `main.tf`

## Deployment

### Option 1: Using the Deploy Script (Recommended)
```bash
# From project root
./functions/deploy-coach-functions.sh
```

### Option 2: Manual Terraform Commands
```bash
cd _infra

# Initialize Terraform
terraform init

# Plan the deployment
terraform plan

# Apply the configuration
terraform apply
```

## What Gets Deployed

### Cloud Functions
- **Coach Content Processor**: Processes uploaded files, extracts text, generates embeddings
- **Coach Response Generator**: Generates AI responses using coach personality and content
- **Coach File Uploader**: Handles secure file uploads to GCS
- **Coach File Uploader Confirm**: Confirms uploads and triggers processing
- **Existing Functions**: All your current SMS, Stripe, and motivation functions

### Storage Buckets
- **Coach Content Bucket**: Stores uploaded coach training content
- **Conversation Bucket**: Stores user conversation history
- **Function Source Bucket**: Stores Cloud Function deployment packages

### Service Accounts & IAM
- Dedicated service accounts for each function
- Proper IAM roles and permissions
- Bucket access controls

## Environment Variables

After deployment, update your webapp's `.env.local` file:

```bash
# Get the function URLs
terraform output webapp_environment_variables
```

Copy the output to your webapp's environment configuration.

## Database Setup

Don't forget to run the database migrations:

```bash
cd supabase
supabase db push
```

## Monitoring & Logs

View function logs in the GCP Console:
```
https://console.cloud.google.com/functions/list
```

## Cleanup

To destroy all resources:
```bash
terraform destroy
```

## Troubleshooting

### Common Issues

1. **Permission Denied**: Ensure your gcloud account has the necessary IAM roles
2. **API Not Enabled**: Enable required GCP APIs (see prerequisites)
3. **Quota Exceeded**: Check GCP quotas for Cloud Functions and storage
4. **Function Timeout**: Increase timeout in the function module configuration

### Getting Help

- Check function logs in GCP Console
- Verify environment variables are set correctly
- Ensure Supabase database migrations are applied
- Test functions individually using the GCP Console

## Cost Optimization

- Functions use minimal memory allocations
- Storage buckets have lifecycle policies
- Consider setting up budget alerts in GCP Console

## Security Notes

- All functions use dedicated service accounts with minimal permissions
- Secrets are managed through environment variables (consider using Secret Manager for production)
- CORS is configured for webapp origins only
- All functions require proper authentication for sensitive operations 