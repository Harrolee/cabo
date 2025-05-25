#!/bin/bash

# Setup Environment Variables for Coach Builder
# This script helps you create the .env.local file with the correct function URLs

echo "🔧 Setting up Coach Builder environment variables..."
echo ""

# Check if we're in the right directory
if [ ! -f "webapp/sample.env" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    echo "   Expected to find webapp/sample.env"
    exit 1
fi

# Get function URLs from Terraform output
echo "📋 Getting function URLs from Terraform..."
cd _infra

if [ ! -f "terraform.tfstate" ]; then
    echo "❌ Error: No Terraform state found. Please run 'terraform apply' first."
    exit 1
fi

# Extract URLs from Terraform output
FUNCTION_BASE_URL=$(terraform output -raw webapp_environment_variables | grep VITE_GCP_FUNCTION_BASE_URL | cut -d'"' -f4)
CONTENT_PROCESSOR_URL=$(terraform output -raw coach_content_processor_url)
RESPONSE_GENERATOR_URL=$(terraform output -raw coach_response_generator_url)
FILE_UPLOADER_URL=$(terraform output -raw coach_file_uploader_url)
FILE_UPLOADER_CONFIRM_URL=$(terraform output -raw coach_file_uploader_confirm_url)

cd ..

echo "✅ Found function URLs:"
echo "   Base URL: $FUNCTION_BASE_URL"
echo "   Content Processor: $CONTENT_PROCESSOR_URL"
echo "   Response Generator: $RESPONSE_GENERATOR_URL"
echo "   File Uploader: $FILE_UPLOADER_URL"
echo "   File Uploader Confirm: $FILE_UPLOADER_CONFIRM_URL"
echo ""

# Create .env.local file
echo "📝 Creating webapp/.env.local file..."

cat > webapp/.env.local << EOF
# Coach Builder Environment Variables
# Generated automatically from Terraform deployment

# GCP Cloud Functions
VITE_GCP_FUNCTION_BASE_URL=$FUNCTION_BASE_URL
VITE_COACH_CONTENT_PROCESSOR_URL=$CONTENT_PROCESSOR_URL
VITE_COACH_RESPONSE_GENERATOR_URL=$RESPONSE_GENERATOR_URL
VITE_COACH_FILE_UPLOADER_URL=$FILE_UPLOADER_URL
VITE_COACH_FILE_UPLOADER_CONFIRM_URL=$FILE_UPLOADER_CONFIRM_URL

# TODO: Add your other environment variables below
# Copy from your existing .env.local or fill in these values:

# Supabase Configuration
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Stripe Configuration  
VITE_STRIPE_PUBLIC_KEY=

# Legacy API URL (if needed)
VITE_API_URL=
EOF

echo "✅ Created webapp/.env.local with Coach Builder function URLs"
echo ""
echo "🔧 Next steps:"
echo "1. Edit webapp/.env.local and fill in your Supabase, Stripe, and other credentials"
echo "2. Restart your webapp development server: cd webapp && npm run dev"
echo "3. Test the Coach Builder flow at http://localhost:5173/coach-builder"
echo ""
echo "💡 Your function URLs are now configured and ready to use!" 