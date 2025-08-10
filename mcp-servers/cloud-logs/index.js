#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Logging } from '@google-cloud/logging';
import { z } from 'zod';

// Initialize Google Cloud Logging client (project can be overridden per request)
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
  filter: z.string().optional().describe('Additional filter query in Cloud Logging filter syntax'),
  projectId: z.string().optional().describe('GCP Project ID to query. Defaults to env project.'),
  region: z.string().optional().describe('Region/location to filter logs by (e.g., us-central1). Optional.')
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
                },
                projectId: {
                  type: 'string',
                  description: 'GCP Project ID to query. Defaults to env project.'
                },
                region: {
                  type: 'string',
                  description: 'Region/location to filter logs by (e.g., us-central1). Optional.'
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
                },
                projectId: {
                  type: 'string',
                  description: 'GCP Project ID to query. Defaults to env project.'
                },
                region: {
                  type: 'string',
                  description: 'Region/location to filter logs by (e.g., us-central1). Optional.'
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

    // Allow per-call project override
    const inferredProjectId = params.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'cabo-446722';
    const loggingClient = inferredProjectId ? new Logging({ projectId: inferredProjectId }) : logging;
    const inferredRegion = params.region || process.env.GOOGLE_CLOUD_REGION || process.env.CLOUD_RUN_REGION || process.env.FUNCTION_REGION || process.env.REGION || process.env.GCLOUD_REGION || 'us-central1';

    // Build resource-aware filter that works for CFv2 (Cloud Run) and CFv1
    const hoursAgo = new Date(Date.now() - params.hours * 60 * 60 * 1000).toISOString();
    const runLogNames = 'logName:("run.googleapis.com%2Frequests" OR "run.googleapis.com%2Fstderr" OR "run.googleapis.com%2Fstdout")';

    const regionClauseRun = inferredRegion ? ` AND resource.labels.location="${inferredRegion}"` : '';
    const regionClauseCF1 = inferredRegion ? ` AND resource.labels.region="${inferredRegion}"` : '';

    let resourceClause;
    if (params.functionName) {
      const cloudRunFilter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${params.functionName}"${regionClauseRun} AND ${runLogNames}`;
      const cloudFunctionV1Filter = `resource.type="cloud_function" AND resource.labels.function_name="${params.functionName}"${regionClauseCF1}`;
      resourceClause = `(${cloudRunFilter}) OR (${cloudFunctionV1Filter})`;
    } else {
      const cloudRunAny = `resource.type="cloud_run_revision" AND labels."goog-managed-by"="cloudfunctions"${regionClauseRun} AND ${runLogNames}`;
      const cloudFunctionAny = `resource.type="cloud_function"${regionClauseCF1}`;
      resourceClause = `(${cloudRunAny}) OR (${cloudFunctionAny})`;
    }

    let filter = `${resourceClause} AND timestamp>="${hoursAgo}"`;
    if (params.severity) {
      filter += ` AND severity>="${params.severity}"`;
    }
    if (params.filter) {
      filter += ` AND (${params.filter})`;
    }

    try {
      const [entries] = await loggingClient.getEntries({
        filter,
        pageSize: params.limit,
        orderBy: 'timestamp desc'
      });

      const logs = entries.map(entry => ({
        timestamp: entry.metadata.timestamp,
        severity: entry.metadata.severity,
        functionName: entry.metadata.resource?.labels?.service_name || entry.metadata.resource?.labels?.function_name || 'unknown',
        logName: entry.metadata.logName,
        message: typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data),
        labels: entry.metadata.labels,
        sourceLocation: entry.metadata.sourceLocation
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${logs.length} log entries${inferredProjectId ? ` in project ${inferredProjectId}` : ''}${inferredRegion ? ` (region ${inferredRegion})` : ''}:

${logs.map(log => `[` + log.timestamp + `] ` + log.severity + ` - ` + log.functionName + `\n` + (log.logName ? `(log: ${log.logName.split('/logs/')[1] || log.logName})\n` : '') + log.message + `\n---`).join('\n')}`
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
      limit: z.number().min(1).max(500).default(50),
      projectId: z.string().optional(),
      region: z.string().optional()
    }).parse(args);

    const inferredProjectId = params.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'cabo-446722';
    const loggingClient = inferredProjectId ? new Logging({ projectId: inferredProjectId }) : logging;
    const inferredRegion = params.region || process.env.GOOGLE_CLOUD_REGION || process.env.CLOUD_RUN_REGION || process.env.FUNCTION_REGION || process.env.REGION || process.env.GCLOUD_REGION || 'us-central1';

    const hoursAgoIso = new Date(Date.now() - params.hours * 60 * 60 * 1000).toISOString();
    const runLogNames = 'logName:("run.googleapis.com%2Frequests" OR "run.googleapis.com%2Fstderr" OR "run.googleapis.com%2Fstdout")';
    const regionClauseRun = inferredRegion ? ` AND resource.labels.location="${inferredRegion}"` : '';
    const regionClauseCF1 = inferredRegion ? ` AND resource.labels.region="${inferredRegion}"` : '';

    // Include WARNING+ for requests (many CFv2 failures show as WARNING) and match error terms in payloads
    const cloudRunErrorPredicate = `(severity>="WARNING" OR jsonPayload.message=~"(?i)(error|exception)" OR textPayload=~"(?i)(error|exception)")`;
    const cloudFunctionV1ErrorPredicate = `(severity>="ERROR" OR jsonPayload.error IS NOT NULL OR jsonPayload.message=~"(?i)(error|exception)" OR textPayload=~"(?i)(error|exception)")`;

    const cloudRunFilter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${params.functionName}"${regionClauseRun} AND ${runLogNames} AND ${cloudRunErrorPredicate}`;
    const cloudFunctionV1Filter = `resource.type="cloud_function" AND resource.labels.function_name="${params.functionName}"${regionClauseCF1} AND ${cloudFunctionV1ErrorPredicate}`;

    let filter = `(${cloudRunFilter}) OR (${cloudFunctionV1Filter}) AND timestamp>="${hoursAgoIso}"`;
    // Ensure timestamp applies to both branches
    filter = `(${cloudRunFilter}) OR (${cloudFunctionV1Filter}) AND timestamp>="${hoursAgoIso}"`;
    filter = `(((${cloudRunFilter})) OR ((${cloudFunctionV1Filter}))) AND timestamp>="${hoursAgoIso}"`;

    try {
      const [entries] = await loggingClient.getEntries({
        filter,
        pageSize: params.limit,
        orderBy: 'timestamp desc'
      });

      const errors = entries.map(entry => ({
        timestamp: entry.metadata.timestamp,
        severity: entry.metadata.severity,
        functionName: entry.metadata.resource?.labels?.service_name || entry.metadata.resource?.labels?.function_name || 'unknown',
        logName: entry.metadata.logName,
        message: typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data),
        sourceLocation: entry.metadata.sourceLocation,
        labels: entry.metadata.labels
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${errors.length} error entries for ${params.functionName}${inferredProjectId ? ` in project ${inferredProjectId}` : ''}${inferredRegion ? ` (region ${inferredRegion})` : ''}:

${errors.map(error => `[` + error.timestamp + `] ` + error.severity + ` - ` + error.functionName + `\n` + (error.logName ? `(log: ${error.logName.split('/logs/')[1] || error.logName})\n` : '') + error.message + `\n---`).join('\n')}`
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