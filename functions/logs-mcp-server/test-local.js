/**
 * Local test script for the Logs MCP Server
 * 
 * This script uses the functions-framework to run the MCP server locally
 * and provides a simple HTTP client to test the endpoints.
 * 
 * Usage:
 * 1. Make sure you have Google Cloud credentials set up
 * 2. Run: node test-local.js
 */

const { exec } = require('child_process');
const http = require('http');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Start the functions-framework
async function startServer() {
  console.log('Starting functions-framework...');
  const serverProcess = exec('npx @google-cloud/functions-framework --target=mcpLogsServer');
  
  // Log server output
  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error(`Server Error: ${data}`);
  });
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  return serverProcess;
}

// Make a simple HTTP request to test the server
function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8080,
      path,
      method,
      headers: {}
    };
    
    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

// Run the test
async function runTest() {
  let serverProcess;
  
  try {
    // Start the server
    serverProcess = await startServer();
    
    // Test the root endpoint
    console.log('\nTesting root endpoint...');
    const rootResponse = await makeRequest('/');
    console.log(`Status: ${rootResponse.statusCode}`);
    console.log('Response:', rootResponse.body.substring(0, 100) + '...');
    
    // Test a simple MCP message
    console.log('\nTesting MCP message...');
    const mcpMessage = {
      jsonrpc: '2.0',
      id: '1',
      method: 'initialize',
      params: {
        client: {
          name: 'test-client',
          version: '1.0.0'
        },
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    };
    
    const mcpResponse = await makeRequest('/messages', 'POST', mcpMessage);
    console.log(`Status: ${mcpResponse.statusCode}`);
    console.log('Response:', mcpResponse.body);
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Clean up
    if (serverProcess) {
      serverProcess.kill();
      console.log('Server stopped');
    }
  }
}

// Run the test
runTest(); 