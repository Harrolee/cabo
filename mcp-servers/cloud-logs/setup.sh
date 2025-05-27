#!/bin/bash

echo "🚀 Setting up Cloud Logs MCP Server..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the mcp-cloud-logs directory"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check if gcloud is installed
if command -v gcloud &> /dev/null; then
    echo "✅ Google Cloud CLI found"
    
    # Check if user is authenticated
    if gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
        echo "✅ Google Cloud authentication detected"
        
        # Offer to set up application default credentials
        read -p "🔐 Set up Application Default Credentials for development? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            gcloud auth application-default login
        fi
    else
        echo "⚠️  No active Google Cloud authentication found"
        echo "   Run: gcloud auth login"
    fi
else
    echo "⚠️  Google Cloud CLI not found. Install from: https://cloud.google.com/sdk/docs/install"
fi

# Check if MCP config exists
if [ -f "../.cursor/mcp.json" ]; then
    echo "✅ MCP configuration found"
else
    echo "⚠️  MCP configuration not found at ../.cursor/mcp.json"
    echo "   The configuration file has been created but needs your service account path"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update .cursor/mcp.json with your service account key path"
echo "2. Ensure your service account has 'roles/logging.viewer' permission"
echo "3. Restart Cursor to load the MCP server"
echo ""
echo "Test the server:"
echo "  npm run dev"
echo ""
echo "Available tools:"
echo "  - get_function_logs: Retrieve function logs with filtering"
echo "  - list_cloud_functions: List all available functions"
echo "  - get_function_errors: Get error logs from specific functions" 