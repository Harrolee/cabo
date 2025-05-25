import { UserFactory, COACH_TYPES, SUBSCRIPTION_STATUS } from './UserFactory.js';
import { CoachFactory, CoachContentFactory, CoachTestMessageFactory, RESPONSE_STYLES, CONTENT_TYPES } from './CoachFactory.js';

/**
 * Helper class for managing test data across integration tests
 * Provides easy setup and teardown of users, coaches, and related data
 */
export class TestDataHelper {
  constructor() {
    this.createdUsers = [];
    this.createdCoaches = [];
    this.testId = `test-${Date.now()}`;
  }

  /**
   * Create a complete test scenario with user and coach
   */
  async createUserWithCoach(coachStyle = 'empathetic_mirror', userOverrides = {}, coachOverrides = {}) {
    // Create user first
    const user = await UserFactory.createForTesting(this.testId, userOverrides);
    this.createdUsers.push(user);

    // Create custom coach for the user
    const coach = await CoachFactory.createWithStyle(
      user.email, 
      coachStyle, 
      null, 
      {
        name: `${user.full_name}'s Coach`,
        ...coachOverrides
      }
    );
    this.createdCoaches.push(coach);

    // Update user to use the custom coach
    const { data: updatedUser } = await UserFactory.prototype._createUser.call(
      new UserFactory(),
      {
        ...user,
        coach_type: 'custom',
        custom_coach_id: coach.id,
        coach: null
      }
    );

    return {
      user: updatedUser || user,
      coach,
      testId: this.testId
    };
  }

  /**
   * Create a user with predefined coach
   */
  async createUserWithPredefinedCoach(coachType = COACH_TYPES.GYM_BRO, userOverrides = {}) {
    const user = await UserFactory.createWithCoach(coachType, {
      ...userOverrides,
      full_name: `Test User ${this.testId}`
    });
    this.createdUsers.push(user);

    return {
      user,
      testId: this.testId
    };
  }

  /**
   * Create a user with trial subscription
   */
  async createTrialUser(userOverrides = {}) {
    const userWithTrial = await UserFactory.createWithTrial({
      ...userOverrides,
      full_name: `Trial User ${this.testId}`
    });
    this.createdUsers.push(userWithTrial);

    return {
      user: userWithTrial,
      subscription: userWithTrial.subscription,
      testId: this.testId
    };
  }

  /**
   * Create a user with active subscription
   */
  async createActiveUser(userOverrides = {}) {
    const userWithSub = await UserFactory.createWithActiveSubscription({
      ...userOverrides,
      full_name: `Active User ${this.testId}`
    });
    this.createdUsers.push(userWithSub);

    return {
      user: userWithSub,
      subscription: userWithSub.subscription,
      testId: this.testId
    };
  }

  /**
   * Create a coach with sample content
   */
  async createCoachWithContent(userEmail, contentTypes = ['motivational', 'advice'], coachOverrides = {}) {
    const coach = await CoachFactory.createBasic(userEmail, {
      name: `Content Coach ${this.testId}`,
      ...coachOverrides
    });
    this.createdCoaches.push(coach);

    // Add different types of content
    const contentPieces = [];
    
    if (contentTypes.includes('motivational')) {
      const motivational = await CoachContentFactory.createMotivational(coach.id);
      contentPieces.push(motivational);
    }
    
    if (contentTypes.includes('advice')) {
      const advice = await CoachContentFactory.createAdvice(coach.id);
      contentPieces.push(advice);
    }
    
    if (contentTypes.includes('tough_love')) {
      const toughLove = await CoachContentFactory.createToughLove(coach.id);
      contentPieces.push(toughLove);
    }

    return {
      coach,
      content: contentPieces,
      testId: this.testId
    };
  }

  /**
   * Create test scenario for coach response testing
   */
  async createCoachTestScenario(responseStyle = 'empathetic_mirror') {
    // Create user
    const user = await UserFactory.createForTesting(this.testId);
    this.createdUsers.push(user);

    // Create coach with specific style
    const coach = await CoachFactory.createWithStyle(user.email, responseStyle, null, {
      name: `${responseStyle} Test Coach`,
      description: `Test coach for ${responseStyle} response testing`
    });
    this.createdCoaches.push(coach);

    // Add sample content
    const content = await CoachContentFactory.createMotivational(coach.id, {
      response_style_tags: [responseStyle]
    });

    // Create test messages
    const testMessages = [
      await CoachTestMessageFactory.create(coach.id, {
        test_message: "I'm feeling unmotivated today",
        expected_response_style: responseStyle,
        expected_emotional_need: 'encouragement',
        test_scenario: 'motivation_request'
      }),
      await CoachTestMessageFactory.create(coach.id, {
        test_message: "What should I eat before working out?",
        expected_response_style: responseStyle,
        expected_emotional_need: 'advice',
        test_scenario: 'advice_request'
      })
    ];

    return {
      user,
      coach,
      content: [content],
      testMessages,
      testId: this.testId
    };
  }

  /**
   * Create multiple users for batch testing
   */
  async createUserBatch(count = 3, userOverrides = {}) {
    const users = [];
    
    for (let i = 0; i < count; i++) {
      const user = await UserFactory.createForTesting(`${this.testId}-${i}`, {
        spice_level: (i % 5) + 1, // Vary spice levels
        coach: Object.values(COACH_TYPES)[i % Object.values(COACH_TYPES).length], // Vary coaches
        ...userOverrides
      });
      users.push(user);
      this.createdUsers.push(user);
    }

    return {
      users,
      testId: this.testId
    };
  }

  /**
   * Create coaches with different styles for comparison testing
   */
  async createCoachVariations(userEmail) {
    const coaches = [];
    const styles = [RESPONSE_STYLES.TOUGH_LOVE, RESPONSE_STYLES.EMPATHETIC_MIRROR, RESPONSE_STYLES.DATA_DRIVEN];
    
    for (const style of styles) {
      const coach = await CoachFactory.createWithStyle(userEmail, style, null, {
        name: `${style} Coach ${this.testId}`,
        description: `Test coach with ${style} response style`
      });
      coaches.push(coach);
      this.createdCoaches.push(coach);
    }

    return {
      coaches,
      testId: this.testId
    };
  }

  /**
   * Get a real coach ID from the database (for testing with existing data)
   */
  async getExistingCoach() {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL || 'http://localhost:54321',
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key'
    );

    const { data: coaches } = await supabase
      .from('coach_profiles')
      .select('id, name, primary_response_style')
      .eq('active', true)
      .limit(1);

    return coaches && coaches.length > 0 ? coaches[0] : null;
  }

  /**
   * Clean up all created test data
   */
  async cleanup() {
    try {
      // Clean up coaches (this will cascade to content and test messages)
      if (this.createdCoaches.length > 0) {
        const coachIds = this.createdCoaches.map(c => c.id);
        await CoachFactory.cleanup(coachIds);
        console.log(`Cleaned up ${this.createdCoaches.length} test coaches`);
      }

      // Clean up users (this will cascade to subscriptions)
      if (this.createdUsers.length > 0) {
        const userIds = this.createdUsers.map(u => u.id);
        await UserFactory.cleanup(userIds);
        console.log(`Cleaned up ${this.createdUsers.length} test users`);
      }

      // Reset arrays
      this.createdUsers = [];
      this.createdCoaches = [];
      
    } catch (error) {
      console.warn(`Cleanup failed: ${error.message}`);
    }
  }

  /**
   * Clean up all test data by pattern (useful for cleaning up after failed tests)
   */
  static async cleanupAllTestData() {
    try {
      await CoachFactory.cleanupByHandlePattern('test-coach-%');
      await UserFactory.cleanupByEmailPattern('test-%@example.com');
      console.log('Cleaned up all test data');
    } catch (error) {
      console.warn(`Global cleanup failed: ${error.message}`);
    }
  }

  /**
   * Create a complete integration test setup
   */
  async createIntegrationTestSetup() {
    // Create user with trial
    const { user, subscription } = await this.createTrialUser();
    
    // Create custom coach for the user
    const { coach, content } = await this.createCoachWithContent(user.email, ['motivational', 'advice']);
    
    // Update user to use custom coach
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL || 'http://localhost:54321',
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key'
    );

    await supabase
      .from('user_profiles')
      .update({
        coach_type: 'custom',
        custom_coach_id: coach.id,
        coach: null
      })
      .eq('id', user.id);

    return {
      user,
      coach,
      subscription,
      content,
      testId: this.testId
    };
  }
}

// Export factory classes for direct use
export { UserFactory, CoachFactory, CoachContentFactory, CoachTestMessageFactory };

// Export constants
export { COACH_TYPES, SUBSCRIPTION_STATUS, RESPONSE_STYLES, CONTENT_TYPES }; 