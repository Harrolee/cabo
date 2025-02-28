# Cloud Function Logs MCP Server

This is an MCP (Model Context Protocol) server that provides access to logs from the `motivational-images` and `process-sms` cloud functions. It allows AI agents to read and analyze logs for debugging and monitoring purposes.

## Features

- **Resource Endpoints**: Access logs from specific cloud functions
  - `logs://motivational-images` - Logs from the motivational images function
  - `logs://process-sms` - Logs from the SMS processing function

- **Tools**:
  - `fetch-logs` - Fetch logs with custom parameters (function name, limit, time range)

## Deployment

This function should be deployed as a Google Cloud Function with HTTP trigger. It requires the following permissions:

- `logging.logEntries.list` - To read logs from Cloud Logging

## Usage with MCP Clients

### Resources

To access logs as resources:

```javascript
// Example of reading logs from the motivational images function
const resource = await client.readResource("logs://motivational-images");
```

### Tools

To use the fetch-logs tool:

```javascript
// Example of using the fetch-logs tool with custom parameters
const result = await client.callTool({
  name: "fetch-logs",
  arguments: {
    functionName: "process-sms",
    limit: 20,
    hoursBack: 12
  }
});
```

## Environment Variables

No specific environment variables are required, but the function needs to be deployed with appropriate service account permissions to access Cloud Logging.

## Local Development

To test locally:

1. Install dependencies: `npm install`
2. Set up Google Cloud credentials: `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json`
3. Run with functions-framework: `npx @google-cloud/functions-framework --target=mcpLogsServer` 