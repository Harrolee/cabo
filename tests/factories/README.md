# Test Data Factories

This directory contains factory classes for creating test data for integration tests. The factories provide a clean, consistent way to create users, coaches, and related data for testing your cloud functions.

## Overview

- **UserFactory**: Creates test users with various configurations (predefined coaches, custom coaches, subscriptions)
- **CoachFactory**: Creates custom coaches with different response styles and content
- **CoachContentFactory**: Creates content chunks for coaches (motivational, advice, tough love)
- **CoachTestMessageFactory**: Creates test messages for coach validation
- **TestDataHelper**: High-level helper that combines all factories for common test scenarios

## Quick Start

```javascript
import { TestDataHelper, RESPONSE_STYLES } from './factories/TestDataHelper.js';

// Create a complete test setup
const testHelper = new TestDataHelper();
const { user, coach } = await testHelper.createUserWithCoach(RESPONSE_STYLES.EMPATHETIC_MIRROR);

// Use in your tests
const response = await fetch(FUNCTION_URL, {
  method: 'POST',
  body: JSON.stringify({
    coachId: coach.id,
    userMessage: "I need motivation!"
  })
});

// Clean up when done
await testHelper.cleanup();
```

## Factory Classes

### UserFactory

Creates test users with various configurations:

```javascript
import { UserFactory, COACH_TYPES } from './factories/UserFactory.js';

// Basic user with predefined coach
const user = await UserFactory.createBasic();

// User with specific predefined coach
const user = await UserFactory.createWithCoach(COACH_TYPES.TOUGH_LOVE);

// User with custom coach
const user = await UserFactory.createWithCustomCoach(customCoachId);

// User with trial subscription
const { user, subscription } = await UserFactory.createWithTrial();

// User with active subscription
const { user, subscription } = await UserFactory.createWithActiveSubscription();

// Batch creation
const users = await UserFactory.createBatch(5);

// Cleanup
await UserFactory.cleanup([user1.id, user2.id]);
await UserFactory.cleanupByEmailPattern('test-%@example.com');
```

### CoachFactory

Creates custom coaches with different personalities:

```javascript
import { CoachFactory, RESPONSE_STYLES } from './factories/CoachFactory.js';

// Basic coach
const coach = await CoachFactory.createBasic(userEmail);

// Coach with specific style
const coach = await CoachFactory.createWithStyle(
  userEmail, 
  RESPONSE_STYLES.TOUGH_LOVE,
  RESPONSE_STYLES.DATA_DRIVEN // secondary style
);

// Predefined coach types
const toughCoach = await CoachFactory.createToughLove(userEmail);
const empathCoach = await CoachFactory.createEmpathetic(userEmail);
const dataCoach = await CoachFactory.createDataDriven(userEmail);

// Coach with content
const coach = await CoachFactory.createWithContent(userEmail, [
  { content: "Custom motivational content", content_type: 'instagram_post' }
]);

// Public coach (shareable)
const coach = await CoachFactory.createPublic(userEmail);

// Cleanup
await CoachFactory.cleanup([coach1.id, coach2.id]);
await CoachFactory.cleanupByHandlePattern('test-coach-%');
```

### CoachContentFactory

Creates content for coaches:

```javascript
import { CoachContentFactory, CONTENT_TYPES } from './factories/CoachFactory.js';

// Basic content
const content = await CoachContentFactory.create(coachId, {
  content: "Your custom content here",
  content_type: CONTENT_TYPES.BLOG_POST
});

// Predefined content types
const motivational = await CoachContentFactory.createMotivational(coachId);
const advice = await CoachContentFactory.createAdvice(coachId);
const toughLove = await CoachContentFactory.createToughLove(coachId);
```

### TestDataHelper

High-level helper for common test scenarios:

```javascript
import { TestDataHelper, RESPONSE_STYLES } from './factories/TestDataHelper.js';

const testHelper = new TestDataHelper();

// Complete user + coach setup
const { user, coach } = await testHelper.createUserWithCoach(RESPONSE_STYLES.EMPATHETIC_MIRROR);

// User with predefined coach
const { user } = await testHelper.createUserWithPredefinedCoach(COACH_TYPES.GYM_BRO);

// Trial user
const { user, subscription } = await testHelper.createTrialUser();

// Active subscription user
const { user, subscription } = await testHelper.createActiveUser();

// Coach with content
const { coach, content } = await testHelper.createCoachWithContent(userEmail, ['motivational', 'advice']);

// Test scenario for response testing
const { user, coach, testMessages } = await testHelper.createCoachTestScenario(RESPONSE_STYLES.TOUGH_LOVE);

// Multiple users for batch testing
const { users } = await testHelper.createUserBatch(5);

// Coach variations for comparison
const { coaches } = await testHelper.createCoachVariations(userEmail);

// Complete integration test setup
const { user, coach, subscription, content } = await testHelper.createIntegrationTestSetup();

// Cleanup
await testHelper.cleanup();
```

## Constants

### Coach Types (Predefined)
```javascript
import { COACH_TYPES } from './factories/UserFactory.js';

COACH_TYPES.ZEN_MASTER      // 'zen_master'
COACH_TYPES.GYM_BRO         // 'gym_bro'
COACH_TYPES.DANCE_TEACHER   // 'dance_teacher'
COACH_TYPES.DRILL_SERGEANT  // 'drill_sergeant'
COACH_TYPES.FRAT_BRO        // 'frat_bro'
```

### Response Styles (Custom Coaches)
```javascript
import { RESPONSE_STYLES } from './factories/CoachFactory.js';

RESPONSE_STYLES.TOUGH_LOVE         // 'tough_love'
RESPONSE_STYLES.EMPATHETIC_MIRROR  // 'empathetic_mirror'
RESPONSE_STYLES.REFRAME_MASTER     // 'reframe_master'
RESPONSE_STYLES.DATA_DRIVEN        // 'data_driven'
RESPONSE_STYLES.STORY_TELLER       // 'story_teller'
RESPONSE_STYLES.CHEERLEADER        // 'cheerleader'
RESPONSE_STYLES.WISE_MENTOR        // 'wise_mentor'
```

### Content Types
```javascript
import { CONTENT_TYPES } from './factories/CoachFactory.js';

CONTENT_TYPES.INSTAGRAM_POST        // 'instagram_post'
CONTENT_TYPES.VIDEO_TRANSCRIPT      // 'video_transcript'
CONTENT_TYPES.PODCAST_TRANSCRIPT    // 'podcast_transcript'
CONTENT_TYPES.WRITTEN_CONTENT       // 'written_content'
CONTENT_TYPES.SOCIAL_MEDIA_COMMENT  // 'social_media_comment'
CONTENT_TYPES.BLOG_POST             // 'blog_post'
```

### Subscription Status
```javascript
import { SUBSCRIPTION_STATUS } from './factories/UserFactory.js';

SUBSCRIPTION_STATUS.TRIAL      // 'trial'
SUBSCRIPTION_STATUS.ACTIVE     // 'active'
SUBSCRIPTION_STATUS.EXPIRED    // 'expired'
SUBSCRIPTION_STATUS.CANCELLED  // 'cancelled'
```

## Environment Setup

Make sure you have these environment variables set:

```bash
# Supabase Configuration
SUPABASE_URL=http://localhost:54321  # or your hosted Supabase URL
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Cloud Function URLs (optional, defaults to deployed URLs)
COACH_RESPONSE_GENERATOR_URL=https://us-central1-cabo-446722.cloudfunctions.net/coach-response-generator
```

## Usage in Tests

### Basic Integration Test

```javascript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { TestDataHelper } from '../factories/TestDataHelper.js';

describe('My Integration Test', () => {
  let testHelper;
  let testData;

  beforeAll(async () => {
    testHelper = new TestDataHelper();
    testData = await testHelper.createIntegrationTestSetup();
  });

  afterAll(async () => {
    await testHelper.cleanup();
  });

  it('should work with real test data', async () => {
    // Use testData.user, testData.coach, etc.
    const response = await callYourFunction(testData.coach.id);
    expect(response.status).toBe(200);
  });
});
```

### Testing Different Coach Styles

```javascript
describe('Coach Style Variations', () => {
  let testHelper;
  let coaches;

  beforeAll(async () => {
    testHelper = new TestDataHelper();
    const { user } = await testHelper.createUserWithPredefinedCoach();
    const variations = await testHelper.createCoachVariations(user.email);
    coaches = variations.coaches;
  });

  afterAll(async () => {
    await testHelper.cleanup();
  });

  it('should respond differently based on coach style', async () => {
    for (const coach of coaches) {
      const response = await callFunction(coach.id, "I need motivation");
      expect(response.style).toBe(coach.primary_response_style);
    }
  });
});
```

## Scripts

Use the provided scripts for manual testing:

```bash
# Set up test data for manual testing
npm run test:setup

# Clean up test data
npm run test:cleanup

# Run integration tests
npm run test:integration

# Run specific coach tests
npm run test:coach
```

## Best Practices

1. **Always clean up**: Use `afterAll` hooks or the cleanup scripts
2. **Use unique identifiers**: Factories automatically generate unique emails/handles
3. **Test with real data**: Use factories to create realistic test scenarios
4. **Batch operations**: Use batch creation for performance tests
5. **Environment isolation**: Use different test IDs for parallel test runs

## Troubleshooting

### Common Issues

1. **Supabase connection errors**: Check your environment variables
2. **Unique constraint violations**: Ensure you're using unique test identifiers
3. **Foreign key errors**: Clean up in the right order (coaches before users)
4. **Permission errors**: Make sure you're using the service role key

### Debugging

```javascript
// Enable verbose logging
console.log('Test data created:', testData);

// Check what was created
console.log('Users:', testHelper.createdUsers.length);
console.log('Coaches:', testHelper.createdCoaches.length);

// Manual cleanup if needed
await TestDataHelper.cleanupAllTestData();
```

## Integration with MCP

After running tests, use the MCP server to analyze logs:

```javascript
// In Cursor, use these MCP commands:

// Check logs for specific coach
get_function_logs({
  functionName: "coach-response-generator",
  hours: 1,
  filter: `jsonPayload.coachId="${testData.coach.id}"`
})

// Check for errors
get_function_errors({
  functionName: "coach-response-generator",
  hours: 1
})
```

This creates a powerful workflow: create test data → run tests → analyze logs → iterate quickly! 