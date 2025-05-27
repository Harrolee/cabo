# Cloud Logs MCP Server

An MCP (Model Context Protocol) server that provides access to Google Cloud Function logs for integration testing and debugging.

## Features

- **Retrieve Function Logs**: Get logs from specific cloud functions or all functions
- **Error Filtering**: Quickly find error logs from any function
- **Flexible Filtering**: Use severity levels, time ranges, and custom filters
- **Integration Testing**: Perfect for writing tests that verify function behavior

## Available Tools

### 1. `get_function_logs`
Retrieve logs from Google Cloud Functions with comprehensive filtering options.

**Parameters:**
- `functionName` (optional): Specific function to query (see list below)
- `severity` (optional): Minimum log level (DEFAULT, DEBUG, INFO, NOTICE, WARNING, ERROR, CRITICAL, ALERT, EMERGENCY)
- `hours` (optional): Hours to look back (1-168, default: 1)
- `limit` (optional): Max entries to return (1-1000, default: 100)
- `filter` (optional): Additional Cloud Logging filter syntax

### 2. `list_cloud_functions`
List all available cloud functions that can be queried.

### 3. `get_function_errors`
Get recent error logs from a specific cloud function.

**Parameters:**
- `functionName` (required): Function to check for errors
- `hours` (optional): Hours to look back (1-168, default: 24)
- `limit` (optional): Max error entries (1-500, default: 50)

## Available Cloud Functions

Based on your current deployment:
- `process-sms`
- `motivational-images`
- `signup`
- `cancel-stripe-subscription`
- `coach-content-processor`
- `coach-response-generator`
- `coach-file-uploader`
- `stripe-webhook`
- `get-user-data`
- `create-stripe-subscription`
- `create-setup-intent`

## Setup

### 1. Install Dependencies

```bash
cd mcp-cloud-logs
npm install
```

### 2. Authentication

The server uses Google Cloud Application Default Credentials. Set up authentication:

```bash
# Option 1: Service Account Key (recommended for production)
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"

# Option 2: User credentials (for development)
gcloud auth application-default login
```

### 3. Configure in Cursor

Create or update `.cursor/mcp.json` in your project root:

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

Or for global access, create `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cloud-logs": {
      "command": "node",
      "args": ["/absolute/path/to/your/project/mcp-cloud-logs/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/your/service-account-key.json"
      }
    }
  }
}
```

### 4. Required Permissions

Your service account needs these IAM roles:
- `roles/logging.viewer` - To read logs
- `roles/cloudfunctions.viewer` - To list functions (optional)

## Usage Examples

### Integration Testing

```javascript
// Example integration test
describe('Coach Response Generator', () => {
  it('should process requests without errors', async () => {
    // Make request to your function
    const response = await fetch('https://your-function-url', {
      method: 'POST',
      body: JSON.stringify({ message: 'test' })
    });
    
    // Use MCP to check logs for errors
    // The MCP server will be available in Cursor to check:
    // - Recent error logs
    // - Function execution logs
    // - Performance metrics
  });
});
```

### Debugging Workflow

1. **List Functions**: See all available functions
2. **Get Recent Logs**: Check what's happening in real-time
3. **Filter Errors**: Quickly identify issues
4. **Custom Filters**: Use advanced Cloud Logging syntax

## Advanced Filtering

The `filter` parameter accepts Cloud Logging filter syntax:

```
# Find logs containing specific text
textPayload=~".*user_id.*"

# Filter by HTTP status
httpRequest.status>=400

# Combine conditions
jsonPayload.userId="12345" AND severity>="WARNING"
```

## Development

### Run Locally
```bash
npm run dev
```

### Test the Server
```bash
# Test with a simple echo
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | node index.js
```

## Troubleshooting

### Authentication Issues
- Verify `GOOGLE_APPLICATION_CREDENTIALS` points to valid service account key
- Ensure service account has required permissions
- Try `gcloud auth application-default login` for development

### No Logs Found
- Check function names match exactly (use `list_cloud_functions`)
- Verify time range (functions may not have recent activity)
- Check if functions are deployed and receiving traffic

### Permission Denied
- Ensure service account has `roles/logging.viewer`
- Verify project ID is correct in your credentials

## Integration with Testing

This MCP server is designed to enhance your testing workflow:

1. **Real-time Debugging**: Check logs immediately after function calls
2. **Error Detection**: Automatically find errors in function execution
3. **Performance Monitoring**: Track function execution patterns
4. **Integration Validation**: Verify end-to-end functionality

Perfect for rapid iteration on cloud function development and testing! 