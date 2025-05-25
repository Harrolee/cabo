#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Logging } from '@google-cloud/logging';
import { z } from 'zod';

// Initialize Google Cloud Logging client
const logging = new Logging();

// Define the available cloud functions based on your terraform config
const CLOUD_FUNCTIONS = [
  'process-sms',
  'motivational-images', 
  'signup',
  'cancel-stripe-subscription',
  'coach-content-processor',
  'coach-response-generator',
  'coach-file-uploader',
  'stripe-webhook',
  'get-user-data',
  'create-stripe-subscription',
  'create-setup-intent'
];

// Validation schemas
const GetLogsSchema = z.object({
  functionName: z.string().optional().describe('Name of the cloud function to get logs for'),
  severity: z.enum(['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY']).optional().describe('Minimum log severity level'),
  hours: z.number().min(1).max(168).default(1).describe('Number of hours to look back (max 168 = 7 days)'),
  limit: z.number().min(1).max(1000).default(100).describe('Maximum number of log entries to return'),
  filter: z.string().optional().describe('Additional filter query in Cloud Logging filter syntax')
});

const ListFunctionsSchema = z.object({});

const GetFunctionStatusSchema = z.object({
  functionName: z.string().describe('Name of the cloud function to check status for')
});

class CloudLogsServer {
  constructor() {
    this.server = new Server(
      {
        name: 'cloud-logs-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_function_logs',
            description: 'Retrieve logs from Google Cloud Functions with filtering options',
            inputSchema: {
              type: 'object',
              properties: {
                functionName: {
                  type: 'string',
                  description: 'Name of the cloud function to get logs for (optional - if not provided, gets logs from all functions)',
                  enum: CLOUD_FUNCTIONS
                },
                severity: {
                  type: 'string',
                  description: 'Minimum log severity level',
                  enum: ['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'],
                  default: 'INFO'
                },
                hours: {
                  type: 'number',
                  description: 'Number of hours to look back (max 168 = 7 days)',
                  minimum: 1,
                  maximum: 168,
                  default: 1
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of log entries to return',
                  minimum: 1,
                  maximum: 1000,
                  default: 100
                },
                filter: {
                  type: 'string',
                  description: 'Additional filter query in Cloud Logging filter syntax (optional)'
                }
              }
            }
          },
          {
            name: 'list_cloud_functions',
            description: 'List all available cloud functions that can be queried for logs',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'get_function_errors',
            description: 'Get recent error logs from a specific cloud function',
            inputSchema: {
              type: 'object',
              properties: {
                functionName: {
                  type: 'string',
                  description: 'Name of the cloud function to get error logs for',
                  enum: CLOUD_FUNCTIONS
                },
                hours: {
                  type: 'number',
                  description: 'Number of hours to look back (max 168 = 7 days)',
                  minimum: 1,
                  maximum: 168,
                  default: 24
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of error entries to return',
                  minimum: 1,
                  maximum: 500,
                  default: 50
                }
              },
              required: ['functionName']
            }
          }
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_function_logs':
            return await this.getFunctionLogs(args);
          case 'list_cloud_functions':
            return await this.listCloudFunctions(args);
          case 'get_function_errors':
            return await this.getFunctionErrors(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  async getFunctionLogs(args) {
    const params = GetLogsSchema.parse(args);
    
    // Build the filter query
    let filter = `resource.type="cloud_function"`;
    
    if (params.functionName) {
      filter += ` AND resource.labels.function_name="${params.functionName}"`;
    }
    
    if (params.severity) {
      filter += ` AND severity>="${params.severity}"`;
    }
    
    // Add time filter
    const hoursAgo = new Date(Date.now() - params.hours * 60 * 60 * 1000);
    filter += ` AND timestamp>="${hoursAgo.toISOString()}"`;
    
    // Add custom filter if provided
    if (params.filter) {
      filter += ` AND (${params.filter})`;
    }

    try {
      const [entries] = await logging.getEntries({
        filter: filter,
        pageSize: params.limit,
        orderBy: 'timestamp desc'
      });

      const logs = entries.map(entry => ({
        timestamp: entry.metadata.timestamp,
        severity: entry.metadata.severity,
        functionName: entry.metadata.resource?.labels?.function_name || 'unknown',
        message: typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data),
        labels: entry.metadata.labels,
        sourceLocation: entry.metadata.sourceLocation
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${logs.length} log entries:\n\n${logs.map(log => 
              `[${log.timestamp}] ${log.severity} - ${log.functionName}\n${log.message}\n---`
            ).join('\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to retrieve logs: ${error.message}`);
    }
  }

  async listCloudFunctions(args) {
    ListFunctionsSchema.parse(args);
    
    return {
      content: [
        {
          type: 'text',
          text: `Available Cloud Functions:\n${CLOUD_FUNCTIONS.map(fn => `- ${fn}`).join('\n')}\n\nYou can use these function names with the get_function_logs tool to retrieve specific logs.`
        }
      ]
    };
  }

  async getFunctionErrors(args) {
    const params = z.object({
      functionName: z.string(),
      hours: z.number().min(1).max(168).default(24),
      limit: z.number().min(1).max(500).default(50)
    }).parse(args);

    // Build filter for errors only
    let filter = `resource.type="cloud_function"`;
    filter += ` AND resource.labels.function_name="${params.functionName}"`;
    filter += ` AND (severity>="ERROR" OR jsonPayload.error IS NOT NULL OR textPayload=~".*[Ee]rror.*")`;
    
    const hoursAgo = new Date(Date.now() - params.hours * 60 * 60 * 1000);
    filter += ` AND timestamp>="${hoursAgo.toISOString()}"`;

    try {
      const [entries] = await logging.getEntries({
        filter: filter,
        pageSize: params.limit,
        orderBy: 'timestamp desc'
      });

      const errors = entries.map(entry => ({
        timestamp: entry.metadata.timestamp,
        severity: entry.metadata.severity,
        message: typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data),
        sourceLocation: entry.metadata.sourceLocation,
        labels: entry.metadata.labels
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${errors.length} error entries for ${params.functionName}:\n\n${errors.map(error => 
              `[${error.timestamp}] ${error.severity}\n${error.message}\n${error.sourceLocation ? `Location: ${JSON.stringify(error.sourceLocation)}` : ''}\n---`
            ).join('\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to retrieve error logs: ${error.message}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Cloud Logs MCP server running on stdio');
  }
}

const server = new CloudLogsServer();
server.run().catch(console.error); 