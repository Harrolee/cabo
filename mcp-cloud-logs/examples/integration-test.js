/**
 * Example Integration Test using MCP Cloud Logs Server
 * 
 * This demonstrates how you can use the MCP server to:
 * 1. Make requests to your cloud functions
 * 2. Check logs for errors or specific behavior
 * 3. Validate end-to-end functionality
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

// Mock MCP client - in real usage, this would be available through Cursor
class MockMCPClient {
  async callTool(toolName, params) {
    // This would be handled by Cursor's MCP integration
    console.log(`Would call MCP tool: ${toolName}`, params);
    return { success: true, logs: [] };
  }
}

const mcpClient = new MockMCPClient();

describe('Cloud Function Integration Tests', () => {
  
  describe('Coach Response Generator', () => {
    it('should process coach requests without errors', async () => {
      // 1. Make a request to your cloud function
      const testPayload = {
        message: "I need motivation for my workout",
        userId: "test-user-123",
        coachId: "test-coach-456"
      };

      // In real scenario, you'd call your actual function URL
      const functionUrl = process.env.COACH_RESPONSE_GENERATOR_URL;
      
      // 2. Make the request
      const startTime = new Date();
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload)
      });

      // 3. Use MCP to check logs for this execution
      const logs = await mcpClient.callTool('get_function_logs', {
        functionName: 'coach-response-generator',
        hours: 1,
        severity: 'INFO',
        filter: `jsonPayload.userId="${testPayload.userId}"`
      });

      // 4. Verify no errors occurred
      const errors = await mcpClient.callTool('get_function_errors', {
        functionName: 'coach-response-generator',
        hours: 1
      });

      // 5. Assertions
      expect(response.status).toBe(200);
      expect(errors.logs).toHaveLength(0); // No errors
      expect(logs.logs.length).toBeGreaterThan(0); // Function executed
    });

    it('should handle invalid requests gracefully', async () => {
      const invalidPayload = { invalid: 'data' };

      const response = await fetch(process.env.COACH_RESPONSE_GENERATOR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidPayload)
      });

      // Check that errors are logged appropriately
      const errors = await mcpClient.callTool('get_function_errors', {
        functionName: 'coach-response-generator',
        hours: 1,
        limit: 10
      });

      expect(response.status).toBe(400);
      // Should have validation error logs
      expect(errors.logs.some(log => 
        log.message.includes('validation') || log.message.includes('invalid')
      )).toBe(true);
    });
  });

  describe('SMS Processing', () => {
    it('should process SMS messages correctly', async () => {
      const smsPayload = {
        From: '+1234567890',
        Body: 'Start my workout',
        MessageSid: 'test-message-123'
      };

      const response = await fetch(process.env.PROCESS_SMS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(smsPayload)
      });

      // Check logs for successful processing
      const logs = await mcpClient.callTool('get_function_logs', {
        functionName: 'process-sms',
        hours: 1,
        filter: `jsonPayload.MessageSid="${smsPayload.MessageSid}"`
      });

      expect(response.status).toBe(200);
      expect(logs.logs.length).toBeGreaterThan(0);
    });
  });

  describe('Stripe Integration', () => {
    it('should handle subscription creation', async () => {
      const subscriptionData = {
        userId: 'test-user-789',
        priceId: process.env.STRIPE_PRICE_ID
      };

      const response = await fetch(process.env.CREATE_STRIPE_SUBSCRIPTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscriptionData)
      });

      // Verify no payment processing errors
      const errors = await mcpClient.callTool('get_function_errors', {
        functionName: 'create-stripe-subscription',
        hours: 1
      });

      // Check for successful Stripe API calls in logs
      const logs = await mcpClient.callTool('get_function_logs', {
        functionName: 'create-stripe-subscription',
        hours: 1,
        filter: `jsonPayload.userId="${subscriptionData.userId}"`
      });

      expect(response.status).toBe(200);
      expect(errors.logs).toHaveLength(0);
      expect(logs.logs.some(log => 
        log.message.includes('subscription created') || 
        log.message.includes('stripe')
      )).toBe(true);
    });
  });

  describe('Performance Monitoring', () => {
    it('should track function execution times', async () => {
      // Get all recent logs to analyze performance
      const allLogs = await mcpClient.callTool('get_function_logs', {
        hours: 24,
        limit: 1000,
        severity: 'INFO'
      });

      // Analyze execution patterns
      const functionExecutions = allLogs.logs.reduce((acc, log) => {
        const functionName = log.functionName;
        if (!acc[functionName]) acc[functionName] = [];
        acc[functionName].push(log);
        return acc;
      }, {});

      // Verify all critical functions are running
      const criticalFunctions = [
        'process-sms',
        'coach-response-generator',
        'stripe-webhook'
      ];

      criticalFunctions.forEach(funcName => {
        expect(functionExecutions[funcName]).toBeDefined();
        expect(functionExecutions[funcName].length).toBeGreaterThan(0);
      });
    });
  });

  describe('Error Recovery', () => {
    it('should identify and categorize errors', async () => {
      // Get all errors from the last 24 hours
      const allErrors = await Promise.all(
        ['coach-response-generator', 'process-sms', 'stripe-webhook'].map(
          funcName => mcpClient.callTool('get_function_errors', {
            functionName: funcName,
            hours: 24,
            limit: 100
          })
        )
      );

      // Categorize errors
      const errorCategories = {
        validation: [],
        external_api: [],
        timeout: [],
        unknown: []
      };

      allErrors.flat().forEach(errorLog => {
        const message = errorLog.message.toLowerCase();
        if (message.includes('validation') || message.includes('invalid')) {
          errorCategories.validation.push(errorLog);
        } else if (message.includes('timeout') || message.includes('deadline')) {
          errorCategories.timeout.push(errorLog);
        } else if (message.includes('api') || message.includes('external')) {
          errorCategories.external_api.push(errorLog);
        } else {
          errorCategories.unknown.push(errorLog);
        }
      });

      // Log error summary for monitoring
      console.log('Error Summary:', {
        validation: errorCategories.validation.length,
        external_api: errorCategories.external_api.length,
        timeout: errorCategories.timeout.length,
        unknown: errorCategories.unknown.length
      });

      // Alert if too many unknown errors
      expect(errorCategories.unknown.length).toBeLessThan(10);
    });
  });
});

/**
 * Usage with Cursor MCP Integration:
 * 
 * 1. The MCP server provides these tools directly in Cursor
 * 2. You can use them interactively while developing
 * 3. Or integrate them into automated tests like above
 * 
 * Example Cursor usage:
 * - "Check logs for the coach-response-generator function"
 * - "Show me any errors from the last hour"
 * - "Get logs containing 'user_id: 12345'"
 * - "List all available cloud functions"
 */ 