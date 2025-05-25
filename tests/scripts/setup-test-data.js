#!/usr/bin/env node

import { TestDataHelper, RESPONSE_STYLES } from '../factories/TestDataHelper.js';

/**
 * Script to set up test data for manual testing and development
 */
async function setupTestData() {
  console.log('🚀 Setting up test data...\n');

  try {
    const testHelper = new TestDataHelper();

    // Create a basic user with predefined coach
    console.log('1. Creating user with predefined coach...');
    const { user: predefinedUser } = await testHelper.createUserWithPredefinedCoach();
    console.log(`   ✅ Created: ${predefinedUser.full_name} (${predefinedUser.email})`);
    console.log(`   🤖 Coach: ${predefinedUser.coach}\n`);

    // Create a user with custom empathetic coach
    console.log('2. Creating user with custom empathetic coach...');
    const { user: empathUser, coach: empathCoach } = await testHelper.createUserWithCoach(RESPONSE_STYLES.EMPATHETIC_MIRROR);
    console.log(`   ✅ Created: ${empathUser.full_name} (${empathUser.email})`);
    console.log(`   🤖 Coach: ${empathCoach.name} (${empathCoach.id})\n`);

    // Create a user with tough love coach
    console.log('3. Creating user with tough love coach...');
    const { user: toughUser, coach: toughCoach } = await testHelper.createUserWithCoach(RESPONSE_STYLES.TOUGH_LOVE);
    console.log(`   ✅ Created: ${toughUser.full_name} (${toughUser.email})`);
    console.log(`   🤖 Coach: ${toughCoach.name} (${toughCoach.id})\n`);

    // Create a user with data-driven coach and content
    console.log('4. Creating user with data-driven coach and content...');
    const { user: dataUser, coach: dataCoach, content } = await testHelper.createCoachWithContent(
      `data-user-${Date.now()}@example.com`,
      ['motivational', 'advice', 'tough_love']
    );
    console.log(`   ✅ Created coach: ${dataCoach.name} (${dataCoach.id})`);
    console.log(`   📚 Added ${content.length} content pieces\n`);

    // Create trial user
    console.log('5. Creating trial user...');
    const { user: trialUser, subscription } = await testHelper.createTrialUser();
    console.log(`   ✅ Created: ${trialUser.full_name} (${trialUser.email})`);
    console.log(`   📅 Trial ends: ${subscription.current_period_end}\n`);

    // Create active subscription user
    console.log('6. Creating active subscription user...');
    const { user: activeUser, subscription: activeSub } = await testHelper.createActiveUser();
    console.log(`   ✅ Created: ${activeUser.full_name} (${activeUser.email})`);
    console.log(`   💳 Subscription: ${activeSub.status} (${activeSub.stripe_subscription_id})\n`);

    // Summary
    console.log('📋 Test Data Summary:');
    console.log('='.repeat(50));
    console.log(`Test ID: ${testHelper.testId}`);
    console.log(`Users created: ${testHelper.createdUsers.length}`);
    console.log(`Coaches created: ${testHelper.createdCoaches.length}`);
    console.log('\n🧪 Ready for testing! Use these coach IDs in your integration tests:');
    console.log(`   Empathetic: ${empathCoach.id}`);
    console.log(`   Tough Love: ${toughCoach.id}`);
    console.log(`   Data-driven: ${dataCoach.id}`);
    
    console.log('\n🔧 To clean up this test data later, run:');
    console.log('   npm run test:cleanup');
    
    console.log('\n🔍 Use MCP to check function logs with these coach IDs');

    // Save test data info for cleanup
    const testInfo = {
      testId: testHelper.testId,
      userIds: testHelper.createdUsers.map(u => u.id),
      coachIds: testHelper.createdCoaches.map(c => c.id),
      createdAt: new Date().toISOString()
    };

    // Write to a file for later cleanup
    const fs = await import('fs');
    await fs.promises.writeFile(
      'tests/test-data-info.json',
      JSON.stringify(testInfo, null, 2)
    );

    console.log('\n✅ Test data setup complete!');

  } catch (error) {
    console.error('❌ Failed to setup test data:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupTestData();
} 