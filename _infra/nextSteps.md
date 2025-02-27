# Next Steps for Dev Environment Setup

## 1. Create Terraform State Bucket
```bash
# Create the state bucket
gsutil mb -p dev-cabo-451902 -l us-central1 gs://dev-cabo-451902-terraform-state

# Enable versioning
gsutil versioning set on gs://dev-cabo-451902-terraform-state
```

## 2. Set Up Supabase Dev Environment
1. Create a new Supabase project for dev:
   - Go to https://app.supabase.com/new/project
   - Name: `cabo-dev`
   - Database Password: Generate a secure password
   - Region: Choose the same region as your GCP resources if possible
   - Pricing Plan: Free tier is fine for dev

2. After project creation:
   - Go to Project Settings > API
   - Copy the Project URL
   - Copy the `anon` public key
   - Copy the `service_role` key
   - Update these values in `environments/dev/terraform.tfvars`

3. Migrate your database schema:
   ```bash
   # Install Supabase CLI if not already installed
   brew install supabase/tap/supabase

   # Login to Supabase
   supabase login

   # Initialize Supabase in your project (if not already done)
   supabase init

   # Link to your dev project
   supabase link --project-ref your-dev-project-ref

   # Push your database schema
   supabase db push
   ```

4. Update your application configuration to use environment-specific Supabase URLs and keys

## 3. Create terraform.tfvars for Dev Environment
Create a new file at `_infra/environments/dev/terraform.tfvars` with your sensitive values:

```hcl
project_id          = "dev-cabo-451902"
region              = "us-central1"
twilio_account_sid  = "your_twilio_sid"
twilio_auth_token   = "your_twilio_token"
twilio_phone_number = "your_twilio_phone"
supabase_url        = "your_dev_supabase_url"
supabase_anon_key   = "your_dev_supabase_anon_key"
```

## 4. Initialize Terraform for Dev Environment
```bash
cd _infra/environments/dev
terraform init
```

## 5. Enable Required APIs
```bash
# Set the project
gcloud config set project dev-cabo-451902

# Enable required APIs
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudresourcemanager.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  compute.googleapis.com \
  eventarc.googleapis.com
```

## 6. Plan and Apply Terraform Configuration
```bash
# Generate and review the plan
terraform plan

# Apply the configuration
terraform apply
```

## 7. Migrate Existing State (Optional)
If you want to migrate existing resources from the production environment:

1. Export the current state:
```bash
cd _infra
terraform state pull > current_state.json
```

2. Import relevant resources into the dev environment:
```bash
cd environments/dev
terraform state push ../current_state.json
```

## 8. Verify Environment
After applying the configuration:

1. Check that all buckets were created:
```bash
gsutil ls -p dev-cabo-451902
```

2. Verify service accounts:
```bash
gcloud iam service-accounts list --project dev-cabo-451902
```

3. Check Cloud Functions:
```bash
gcloud functions list --project dev-cabo-451902
```

## 9. Security Best Practices
1. Ensure `terraform.tfvars` is in `.gitignore`
2. Store sensitive values in Secret Manager
3. Set up appropriate IAM roles for team members
4. Consider setting up Workload Identity Federation for CI/CD

## 10. Environment-Specific Considerations

### Supabase
- Keep dev and prod projects separate
- Use separate API keys for different environments
- Consider using Supabase's Row Level Security (RLS) policies
- Set up different backup schedules for dev vs prod
- Use different rate limits for dev environment

### Domain Configuration
- Set up dev.cabo.fit for the dev environment
- Update CORS settings in both environments
- Configure separate SSL certificates

### Testing
- Use the dev environment for integration testing
- Set up automated database seeding for dev
- Create test users and data in dev only

## 11. Next Steps
1. Set up CI/CD pipelines for the dev environment
2. Configure monitoring and alerting
3. Document environment-specific configurations
4. Set up automated testing

## Troubleshooting
If you encounter issues:

1. Check the Google Cloud Console for error messages
2. Verify API enablement status
3. Check IAM permissions
4. Review Terraform logs with `TF_LOG=DEBUG`

## Notes
- The dev environment is completely isolated from production
- All resources are prefixed with the environment name
- Service accounts are environment-specific
- Bucket names are globally unique and environment-specific

## 12. GitHub Actions Deployment Setup

### 1. Set Up GitHub Secrets
Add the following secrets to your GitHub repository (Settings > Secrets and variables > Actions):

```bash
# Project IDs
GCP_DEV_PROJECT_ID=dev-cabo-451902
GCP_PROD_PROJECT_ID=cabo-446722  # your current prod project

# API URLs
DEV_VITE_API_URL=https://dev.cabo.fit
PROD_VITE_API_URL=https://cabo.fit

# Stripe Keys
DEV_VITE_STRIPE_PUBLIC_KEY=pk_test_51QkG2cCIRd4afj3qUGMee0h4xxI7i34hKXOWt7sDTWDFirabPW3b07TYLCwyC3XuYjMaSEXLqR0J2VRjUp1GTrqu00VaVtDB4n
PROD_VITE_STRIPE_PUBLIC_KEY=your_prod_stripe_public_key

# GCP Workload Identity (existing secrets)
GCP_WORKLOAD_IDENTITY_PROVIDER=your_existing_provider
GCP_SA_EMAIL=your_existing_service_account
```

### 2. Set Up GCP Service Account for Dev
1. Create a service account for GitHub Actions in dev project:
```bash
# Create the service account
gcloud iam service-accounts create github-actions \
  --project dev-cabo-451902 \
  --display-name "GitHub Actions Service Account"

# Get the service account email
SA_EMAIL="github-actions@dev-cabo-451902.iam.gserviceaccount.com"

# Grant necessary permissions
gcloud projects add-iam-policy-binding dev-cabo-451902 \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding dev-cabo-451902 \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding dev-cabo-451902 \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.admin"
```

### 3. Set Up Workload Identity Federation
```bash
# Create a workload identity pool
gcloud iam workload-identity-pools create "github-actions-pool" \
  --project="dev-cabo-451902" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Get the workload identity pool ID
POOL_ID=$(gcloud iam workload-identity-pools describe "github-actions-pool" \
  --project="dev-cabo-451902" \
  --location="global" \
  --format="value(name)")

# Create a workload identity provider
gcloud iam workload-identity-pools providers create-oidc "github-actions" \
  --project="dev-cabo-451902" \
  --location="global" \
  --workload-identity-pool="github-actions-pool" \
  --display-name="GitHub Actions Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Allow authentications from your repo
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="dev-cabo-451902" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/Harrolee/cabo"
```

### 4. Deployment Process
The GitHub Actions workflow is now configured to:
- Deploy to dev environment when pushing to `main`
- Deploy to prod environment when creating a release

To deploy to production:
1. Create a new release in GitHub:
   - Go to Releases > Draft a new release
   - Choose a tag (e.g., v1.0.0)
   - Write release notes
   - Publish release

To deploy to dev:
1. Simply push or merge to main branch
2. The workflow will automatically deploy to dev environment

### 5. Verify Deployments
After each deployment, verify:

1. Dev Environment (after push to main):
```bash
# Check Cloud Run service
gcloud run services describe workout-motivation-webapp-dev \
  --project dev-cabo-451902 \
  --region us-central1

# Check latest deployment
gcloud run revisions list \
  --project dev-cabo-451902 \
  --region us-central1 \
  --service workout-motivation-webapp-dev
```

2. Production Environment (after release):
```bash
# Check Cloud Run service
gcloud run services describe workout-motivation-webapp \
  --project cabo-446722 \
  --region us-central1

# Check latest deployment
gcloud run revisions list \
  --project cabo-446722 \
  --region us-central1 \
  --service workout-motivation-webapp
```

### 6. Troubleshooting Deployments
If deployments fail:
1. Check GitHub Actions logs
2. Verify service account permissions
3. Check Cloud Build logs in both projects
4. Verify Artifact Registry access
5. Check Cloud Run service configurations

### 7. Best Practices
1. Always test changes in dev before creating a release
2. Use semantic versioning for releases (vX.Y.Z)
3. Include detailed release notes
4. Monitor deployment status in GitHub Actions
5. Keep secrets up to date
6. Regularly rotate service account keys
7. Review and update IAM permissions as needed 