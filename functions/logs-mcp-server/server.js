const express = require('express');
const { mcpLogsServer } = require('./index.js');
const crypto = require('crypto');

// Create Express app
const app = express();
app.use(express.json());

// Forward all requests to the MCP server handler
app.all('*', async (req, res) => {
  await mcpLogsServer(req, res);
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`MCP Logs Server running on port ${PORT}`);
}); 