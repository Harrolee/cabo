import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fetch from 'node-fetch';
import { TestDataHelper, RESPONSE_STYLES } from '../factories/TestDataHelper.js';

// Get function URL from environment or use the actual deployed URL
const FUNCTION_URL = process.env.COACH_RESPONSE_GENERATOR_URL || 
  'https://us-central1-cabo-446722.cloudfunctions.net/coach-response-generator';

describe('Coach Response Generator Integration Tests (with Factories)', () => {
  let testHelper;
  let testData;

  beforeAll(async () => {
    // Initialize test helper
    testHelper = new TestDataHelper();
    
    // Create a complete test setup with user and coach
    testData = await testHelper.createIntegrationTestSetup();
    
    console.log(`🧪 Created test setup:`);
    console.log(`   User: ${testData.user.full_name} (${testData.user.email})`);
    console.log(`   Coach: ${testData.coach.name} (${testData.coach.id})`);
    console.log(`   Test ID: ${testData.testId}`);
  });

  afterAll(async () => {
    // Clean up all test data
    if (testHelper) {
      await testHelper.cleanup();
      console.log('🧹 Test cleanup completed');
    }
  });

  describe('Valid Requests with Real Test Data', () => {
    it('should generate a motivational response using real coach', async () => {
      const testPayload = {
        coachId: testData.coach.id,
        userMessage: "I'm feeling unmotivated for my workout today",
        userContext: {
          emotionalNeed: "encouragement",
          situation: "pre_workout",
          previousMessages: []
        }
      };

      console.log(`🧪 Testing with real coach: ${testData.coach.name} (${testData.coach.id})`);

      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173'
        },
        body: JSON.stringify(testPayload)
      });

      const responseData = await response.json();

      // Basic response validation
      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty('response');
      expect(typeof responseData.response).toBe('string');
      expect(responseData.response.length).toBeGreaterThan(10);
      
      // Validate metadata
      expect(responseData).toHaveProperty('metadata');
      expect(responseData.metadata.coachName).toBe(testData.coach.name);
      expect(responseData.metadata.responseStyle).toBe(testData.coach.primary_response_style);

      console.log(`✅ Coach responded: "${responseData.response}"`);
      console.log(`📊 Response metadata:`, responseData.metadata);
      
      // Use MCP to check logs for this specific execution
      console.log(`🔍 Check logs with MCP for coachId: ${testData.coach.id}`);
    });

    it('should handle nutrition advice requests with real coach', async () => {
      const testPayload = {
        coachId: testData.coach.id,
        userMessage: "What should I eat before my morning workout?",
        userContext: {
          emotionalNeed: "advice",
          situation: "pre_workout"
        }
      };

      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173'
        },
        body: JSON.stringify(testPayload)
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty('response');
      expect(responseData.response.toLowerCase()).toMatch(/eat|food|nutrition|meal|fuel|energy/);

      console.log(`🍎 Nutrition advice: "${responseData.response}"`);
    });

    it('should use coach content in responses', async () => {
      const testPayload = {
        coachId: testData.coach.id,
        userMessage: "I need some motivation to push through this tough workout",
        userContext: {
          emotionalNeed: "encouragement",
          situation: "struggling"
        }
      };

      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173'
        },
        body: JSON.stringify(testPayload)
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.metadata.relevantContentCount).toBeGreaterThanOrEqual(0);
      
      console.log(`💪 Motivational response: "${responseData.response}"`);
      console.log(`📚 Used ${responseData.metadata.relevantContentCount} content pieces`);
    });
  });

  describe('Different Coach Styles', () => {
    let coachVariations;

    beforeAll(async () => {
      // Create coaches with different styles for comparison
      coachVariations = await testHelper.createCoachVariations(testData.user.email);
      console.log(`Created ${coachVariations.coaches.length} coach variations`);
    });

    it('should respond differently based on coach style', async () => {
      const testMessage = "I'm struggling with consistency in my workouts";
      const responses = [];

      for (const coach of coachVariations.coaches) {
        const testPayload = {
          coachId: coach.id,
          userMessage: testMessage,
          userContext: {
            emotionalNeed: "encouragement",
            situation: "struggling"
          }
        };

        const response = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'http://localhost:5173'
          },
          body: JSON.stringify(testPayload)
        });

        const responseData = await response.json();
        
        expect(response.status).toBe(200);
        
        responses.push({
          style: coach.primary_response_style,
          response: responseData.response,
          coachName: coach.name
        });

        console.log(`${coach.primary_response_style}: "${responseData.response}"`);
      }

      // Verify responses are different (basic check)
      const uniqueResponses = new Set(responses.map(r => r.response));
      expect(uniqueResponses.size).toBeGreaterThan(1);
      
      console.log(`✅ Generated ${uniqueResponses.size} unique responses from ${responses.length} coaches`);
    });
  });

  describe('Error Handling with Real Data', () => {
    it('should handle non-existent coach gracefully', async () => {
      const invalidPayload = {
        coachId: '00000000-0000-0000-0000-000000000000', // Non-existent UUID
        userMessage: "Test message"
      };

      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173'
        },
        body: JSON.stringify(invalidPayload)
      });

      expect(response.status).toBe(404);
      
      const errorData = await response.json();
      expect(errorData).toHaveProperty('error');
      expect(errorData.error).toMatch(/coach not found/i);
      
      console.log(`❌ Correctly handled non-existent coach: ${errorData.error}`);
    });

    it('should handle missing required fields gracefully', async () => {
      const invalidPayload = {
        // Missing required fields
        userContext: {}
      };

      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173'
        },
        body: JSON.stringify(invalidPayload)
      });

      expect(response.status).toBe(400);
      
      const errorData = await response.json();
      expect(errorData).toHaveProperty('error');
      expect(errorData.error).toMatch(/invalid request data/i);
      
      console.log(`❌ Correctly handled validation error: ${errorData.error}`);
    });
  });

  describe('Performance and Reliability with Real Data', () => {
    it('should respond within reasonable time limits', async () => {
      const testPayload = {
        coachId: testData.coach.id,
        userMessage: "Performance test message with real coach data"
      };

      const startTime = Date.now();
      
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173'
        },
        body: JSON.stringify(testPayload)
      });

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(30000); // 30 seconds max
      
      const responseData = await response.json();
      
      console.log(`⚡ Response time: ${responseTime}ms`);
      console.log(`📊 Response length: ${responseData.response.length} characters`);
      console.log(`🔍 Check performance logs with MCP for execution details`);
    });

    it('should handle multiple concurrent requests', async () => {
      const testPayload = {
        coachId: testData.coach.id,
        userMessage: "Concurrent test message"
      };

      const concurrentRequests = 3;
      const promises = [];

      for (let i = 0; i < concurrentRequests; i++) {
        const promise = fetch(FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'http://localhost:5173'
          },
          body: JSON.stringify({
            ...testPayload,
            userMessage: `${testPayload.userMessage} ${i + 1}`
          })
        });
        promises.push(promise);
      }

      const responses = await Promise.all(promises);
      
      // All requests should succeed
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        console.log(`✅ Concurrent request ${index + 1} succeeded`);
      });

      console.log(`🚀 Successfully handled ${concurrentRequests} concurrent requests`);
    });
  });

  afterAll(() => {
    console.log(`\n📋 Test Summary for ${testData.testId}:`);
    console.log(`🔍 Use MCP to analyze logs with filter: jsonPayload.coachId="${testData.coach.id}"`);
    console.log(`🔍 Check for errors with: get_function_errors for coach-response-generator`);
    console.log(`📊 Review performance patterns in the logs`);
    console.log(`👤 Test user: ${testData.user.email}`);
    console.log(`🤖 Test coach: ${testData.coach.name} (${testData.coach.primary_response_style})`);
  });
});

/*
 * MCP Integration Workflow with Real Data:
 * 
 * After running this test, use these MCP commands in Cursor:
 * 
 * 1. Check all logs for this test run:
 *    get_function_logs({
 *      functionName: "coach-response-generator",
 *      hours: 1,
 *      filter: `jsonPayload.coachId="${testData.coach.id}"`
 *    })
 * 
 * 2. Look for any errors:
 *    get_function_errors({
 *      functionName: "coach-response-generator", 
 *      hours: 1
 *    })
 * 
 * 3. Check database queries:
 *    get_function_logs({
 *      functionName: "coach-response-generator",
 *      hours: 1,
 *      filter: 'textPayload=~".*coach_profiles.*" OR textPayload=~".*supabase.*"'
 *    })
 * 
 * 4. Performance analysis:
 *    get_function_logs({
 *      functionName: "coach-response-generator",
 *      hours: 1,
 *      severity: "INFO",
 *      filter: 'textPayload=~".*Generating response.*" OR textPayload=~".*Generated response.*"'
 *    })
 * 
 * 5. Content usage analysis:
 *    get_function_logs({
 *      functionName: "coach-response-generator",
 *      hours: 1,
 *      filter: 'textPayload=~".*relevant content.*" OR textPayload=~".*vector search.*"'
 *    })
 */ 