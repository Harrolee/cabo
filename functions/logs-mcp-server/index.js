const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { Logging } = require('@google-cloud/logging');
const { z } = require('zod');

// Initialize Google Cloud Logging client
const logging = new Logging();

// Function to get logs for a specific cloud function
async function getFunctionLogs(functionName, limit = 50) {
  try {
    // Create a filter for the specific function
    const filter = `resource.type="cloud_function" AND resource.labels.function_name="${functionName}"`;
    
    // Get logs from the last 24 hours
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 24);
    
    const [entries] = await logging.getEntries({
      filter: filter,
      pageSize: limit,
      orderBy: 'timestamp desc',
    });
    
    return entries.map(entry => ({
      timestamp: entry.metadata.timestamp,
      severity: entry.metadata.severity,
      message: entry.data.message || JSON.stringify(entry.data),
    }));
  } catch (error) {
    console.error(`Error fetching logs for ${functionName}:`, error);
    return [{
      timestamp: new Date(),
      severity: 'ERROR',
      message: `Error fetching logs: ${error.message}`
    }];
  }
}

// Create MCP server
const server = new McpServer({
  name: 'CloudFunctionLogs',
  version: '1.0.0'
});

// Add resources for function logs
server.resource(
  'motivational-images-logs',
  'logs://motivational-images',
  async (uri) => {
    const logs = await getFunctionLogs('send-motivational-images');
    return {
      contents: [{
        uri: uri.href,
        text: logs.map(log => 
          `[${log.timestamp}] [${log.severity}] ${log.message}`
        ).join('\n')
      }]
    };
  }
);

server.resource(
  'process-sms-logs',
  'logs://process-sms',
  async (uri) => {
    const logs = await getFunctionLogs('process-sms');
    return {
      contents: [{
        uri: uri.href,
        text: logs.map(log => 
          `[${log.timestamp}] [${log.severity}] ${log.message}`
        ).join('\n')
      }]
    };
  }
);

// Add a tool to fetch logs with custom parameters
server.tool(
  'fetch-logs',
  {
    functionName: z.enum(['send-motivational-images', 'process-sms']),
    limit: z.number().min(1).max(100).optional().default(50),
    hoursBack: z.number().min(1).max(72).optional().default(24)
  },
  async ({ functionName, limit, hoursBack }) => {
    try {
      // Create a filter for the specific function
      const filter = `resource.type="cloud_function" AND resource.labels.function_name="${functionName}"`;
      
      // Get logs from the specified time period
      const timeAgo = new Date();
      timeAgo.setHours(timeAgo.getHours() - hoursBack);
      
      const [entries] = await logging.getEntries({
        filter: filter,
        pageSize: limit,
        orderBy: 'timestamp desc',
      });
      
      const logs = entries.map(entry => ({
        timestamp: entry.metadata.timestamp,
        severity: entry.metadata.severity,
        message: entry.data.message || JSON.stringify(entry.data),
      }));
      
      return {
        content: [{
          type: 'text',
          text: logs.map(log => 
            `[${log.timestamp}] [${log.severity}] ${log.message}`
          ).join('\n')
        }]
      };
    } catch (error) {
      console.error(`Error fetching logs for ${functionName}:`, error);
      return {
        content: [{
          type: 'text',
          text: `Error fetching logs: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Cloud Function entry point
exports.mcpLogsServer = async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  // Handle SSE connection
  if (req.path === '/sse') {
    const transport = new SSEServerTransport('/messages', res);
    await server.connect(transport);
    return;
  }
  
  // Handle incoming messages
  if (req.path === '/messages' && req.method === 'POST') {
    // Create a transport for handling the message
    const transport = new SSEServerTransport('/messages', res);
    await transport.handlePostMessage(req, res);
    return;
  }
  
  // Default route - provide basic info
  res.send(`
    <html>
      <head><title>Cloud Function Logs MCP Server</title></head>
      <body>
        <h1>Cloud Function Logs MCP Server</h1>
        <p>This is an MCP server for accessing cloud function logs.</p>
        <p>Connect to /sse for SSE connection.</p>
      </body>
    </html>
  `);
}; 