# Quick Start Guide - Cloud Logs MCP Server

Get up and running with cloud function log access in Cursor in under 5 minutes!

## 🚀 Quick Setup

### 1. Install Dependencies
```bash
cd mcp-cloud-logs
npm install
```

### 2. Set Up Authentication

**Option A: Service Account (Recommended)**
1. Create a service account in Google Cloud Console
2. Download the JSON key file
3. Grant it `roles/logging.viewer` permission
4. Update `.cursor/mcp.json` with the path:

```json
{
  "mcpServers": {
    "cloud-logs": {
      "command": "node",
      "args": ["./mcp-cloud-logs/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/your/service-account-key.json"
      }
    }
  }
}
```

**Option B: User Credentials (Development)**
```bash
gcloud auth application-default login
```

### 3. Restart Cursor
Close and reopen Cursor to load the MCP server.

## ✅ Verify Setup

Test the server:
```bash
cd mcp-cloud-logs
node test-server.js
```

You should see 3 tools listed successfully.

## 🎯 Immediate Usage

Once set up, you can use these commands in Cursor:

### List Available Functions
> "List all cloud functions"

### Check Recent Logs
> "Get logs from coach-response-generator for the last hour"

### Find Errors
> "Show me any errors from process-sms in the last 24 hours"

### Custom Filtering
> "Get logs from stripe-webhook containing 'payment_intent' from the last 2 hours"

## 🧪 Integration Testing Workflow

1. **Deploy your function changes**
2. **Make test requests** to your functions
3. **Use MCP tools** to immediately check:
   - Execution logs
   - Error messages
   - Performance data
4. **Iterate quickly** based on real log data

## 📋 Available Tools

| Tool | Purpose | Example |
|------|---------|---------|
| `get_function_logs` | Get filtered logs | Recent activity, specific users |
| `list_cloud_functions` | See all functions | Available endpoints |
| `get_function_errors` | Find errors only | Debug issues quickly |

## 🔧 Common Filters

```bash
# User-specific logs
jsonPayload.userId="user123"

# HTTP errors
httpRequest.status>=400

# Time-based
timestamp>="2024-01-01T00:00:00Z"

# Text search
textPayload=~".*error.*"
```

## 🚨 Troubleshooting

**No logs found?**
- Check function names with `list_cloud_functions`
- Verify time range (functions may be idle)
- Ensure functions are deployed and receiving traffic

**Permission denied?**
- Verify service account has `roles/logging.viewer`
- Check `GOOGLE_APPLICATION_CREDENTIALS` path
- Try `gcloud auth application-default login`

**MCP not loading?**
- Restart Cursor after config changes
- Check `.cursor/mcp.json` syntax
- Verify file paths are absolute

## 🎉 You're Ready!

Your MCP server is now connected to your cloud functions. Use it to:
- Debug issues in real-time
- Write better integration tests
- Monitor function performance
- Validate deployments

Happy debugging! 🐛➡️✨ 