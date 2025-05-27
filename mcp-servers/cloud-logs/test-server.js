#!/usr/bin/env node

/**
 * Simple test script to verify the MCP server is working
 * Run with: node test-server.js
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing MCP Cloud Logs Server...\n');

// Test message to send to the server
const testMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list'
};

// Spawn the MCP server process
const serverProcess = spawn('node', [join(__dirname, 'index.js')], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let errorOutput = '';

// Collect output
serverProcess.stdout.on('data', (data) => {
  output += data.toString();
});

serverProcess.stderr.on('data', (data) => {
  errorOutput += data.toString();
});

// Send test message
serverProcess.stdin.write(JSON.stringify(testMessage) + '\n');

// Wait for response
setTimeout(() => {
  serverProcess.kill();
  
  console.log('📤 Sent test message:', JSON.stringify(testMessage, null, 2));
  console.log('\n📥 Server response:');
  
  if (output) {
    try {
      const response = JSON.parse(output);
      console.log(JSON.stringify(response, null, 2));
      
      // Verify the response
      if (response.result && response.result.tools) {
        console.log('\n✅ Success! Found', response.result.tools.length, 'tools:');
        response.result.tools.forEach(tool => {
          console.log(`  - ${tool.name}: ${tool.description}`);
        });
      } else {
        console.log('\n❌ Unexpected response format');
      }
    } catch (error) {
      console.log('Raw output:', output);
      console.log('\n❌ Failed to parse JSON response:', error.message);
    }
  } else {
    console.log('No output received');
  }
  
  if (errorOutput) {
    console.log('\n📝 Server logs:');
    console.log(errorOutput);
  }
  
  console.log('\n🏁 Test complete');
}, 2000);

// Handle process errors
serverProcess.on('error', (error) => {
  console.error('❌ Failed to start server:', error.message);
});

serverProcess.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error(`❌ Server exited with code ${code}`);
  }
}); 