const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { Logging } = require('@google-cloud/logging');
const { z } = require('zod');
const crypto = require('crypto');

// Initialize Google Cloud Logging client more efficiently
const logging = new Logging({
  scopes: ['https://www.googleapis.com/auth/logging.read'],
  // Add any other optimization options
});

// At the top of your file
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});

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

// Create MCP server with error handling
let server;
try {
  server = new McpServer({
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
    console.log(`Received ${req.method} request to ${req.path}`);
    console.log('Headers:', JSON.stringify(req.headers));
    
    // Enable CORS with expanded headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Requested-With');
    res.set('Access-Control-Expose-Headers', 'Content-Type');
    res.set('Cache-Control', 'no-cache');
    
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    
    // Handle SSE connection
    if (req.path === '/sse') {
      console.log('Establishing SSE connection');
      // Set SSE-specific headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Create transport and connect
      const transport = new SSEServerTransport('/messages', res);
      
      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          res.write('event: heartbeat\ndata: {}\n\n');
          console.log('Sent heartbeat');
        } catch (error) {
          console.error('Error sending heartbeat:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30000);
      
      // Handle client disconnect
      req.on('close', () => {
        console.log('Client disconnected');
        clearInterval(heartbeatInterval);
        // Clean up resources if needed
      });
      
      await server.connect(transport);
      return;
    }
    
    // Add a polling endpoint for clients that can't use SSE
    if (req.path === '/poll') {
      console.log('Received polling request');
      try {
        // Get client ID from query params or generate one
        const clientId = req.query.clientId || crypto.randomUUID();
        
        // Store messages for this client in memory or a database
        // This is a simplified example - in production, use a database
        if (!global.pendingMessages) {
          global.pendingMessages = {};
        }
        
        // Return any pending messages for this client
        const messages = global.pendingMessages[clientId] || [];
        delete global.pendingMessages[clientId];
        
        res.status(200).json({
          clientId,
          messages
        });
      } catch (error) {
        console.error('Error handling poll request:', error);
        res.status(500).json({ error: error.message });
      }
      return;
    }
    
    // Modify message handling to support polling clients
    if (req.path === '/messages' && req.method === 'POST') {
      console.log('Received message:', JSON.stringify(req.body));
      try {
        // Check if this is for a polling client
        const clientId = req.query.clientId;
        if (clientId && req.query.polling === 'true') {
          // Store the message for later polling
          if (!global.pendingMessages) {
            global.pendingMessages = {};
          }
          if (!global.pendingMessages[clientId]) {
            global.pendingMessages[clientId] = [];
          }
          global.pendingMessages[clientId].push(req.body);
          res.status(200).json({ success: true });
          return;
        }
        
        // Otherwise handle as normal SSE
        const transport = new SSEServerTransport('/messages', res);
        await transport.handlePostMessage(req, res);
      } catch (error) {
        console.error('Error handling message:', error);
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: `Internal error: ${error.message}`
          }
        });
      }
      return;
    }
    
    // Add a health check endpoint
    if (req.path === '/health') {
      res.status(200).send('OK');
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
} catch (error) {
  console.error('Error initializing MCP server:', error);
  // Fallback initialization or graceful exit
} 