#!/usr/bin/env node

import { TestDataHelper, UserFactory, CoachFactory } from '../factories/TestDataHelper.js';

/**
 * Script to clean up test data
 */
async function cleanupTestData() {
  console.log('🧹 Cleaning up test data...\n');

  try {
    // Try to read saved test data info
    let testInfo = null;
    try {
      const fs = await import('fs');
      const testInfoData = await fs.promises.readFile('tests/test-data-info.json', 'utf8');
      testInfo = JSON.parse(testInfoData);
      console.log(`📋 Found saved test data from: ${testInfo.createdAt}`);
      console.log(`   Test ID: ${testInfo.testId}`);
      console.log(`   Users: ${testInfo.userIds.length}`);
      console.log(`   Coaches: ${testInfo.coachIds.length}\n`);
    } catch (error) {
      console.log('ℹ️  No saved test data info found, will clean up by pattern\n');
    }

    // Clean up specific test data if we have it
    if (testInfo) {
      console.log('1. Cleaning up specific test data...');
      
      if (testInfo.coachIds.length > 0) {
        await CoachFactory.cleanup(testInfo.coachIds);
        console.log(`   ✅ Cleaned up ${testInfo.coachIds.length} coaches`);
      }
      
      if (testInfo.userIds.length > 0) {
        await UserFactory.cleanup(testInfo.userIds);
        console.log(`   ✅ Cleaned up ${testInfo.userIds.length} users`);
      }

      // Remove the test info file
      const fs = await import('fs');
      try {
        await fs.promises.unlink('tests/test-data-info.json');
        console.log('   ✅ Removed test data info file\n');
      } catch (error) {
        // File might not exist, that's ok
      }
    }

    // Also clean up by pattern (catches any orphaned test data)
    console.log('2. Cleaning up test data by pattern...');
    await TestDataHelper.cleanupAllTestData();
    console.log('   ✅ Pattern-based cleanup complete\n');

    console.log('✅ Test data cleanup complete!');

  } catch (error) {
    console.error('❌ Failed to cleanup test data:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupTestData();
} 