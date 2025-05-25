import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key'
);

/**
 * Factory for creating test users with various configurations
 */
export class UserFactory {
  constructor() {
    this.defaultData = {
      full_name: 'Test User',
      email: 'test@example.com',
      phone_number: '+12345678901',
      active: true,
      timezone: 'UTC',
      coach: 'gym_bro',
      coach_type: 'predefined',
      spice_level: 2,
      image_preference: 'diverse group of people',
      custom_coach_id: null
    };
  }

  /**
   * Create a basic test user with predefined coach
   */
  static async createBasic(overrides = {}) {
    const factory = new UserFactory();
    const timestamp = Date.now();
    
    const userData = {
      ...factory.defaultData,
      full_name: `Test User ${timestamp}`,
      email: `test-user-${timestamp}@example.com`,
      phone_number: `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`,
      ...overrides
    };

    return await factory._createUser(userData);
  }

  /**
   * Create a user with a custom coach
   */
  static async createWithCustomCoach(customCoachId, overrides = {}) {
    const factory = new UserFactory();
    const timestamp = Date.now();
    
    const userData = {
      ...factory.defaultData,
      full_name: `Test User ${timestamp}`,
      email: `test-user-${timestamp}@example.com`,
      phone_number: `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`,
      coach_type: 'custom',
      custom_coach_id: customCoachId,
      coach: null, // Custom coaches don't use predefined coach
      ...overrides
    };

    return await factory._createUser(userData);
  }

  /**
   * Create a user with specific coach type
   */
  static async createWithCoach(coachType, overrides = {}) {
    const validCoaches = ['zen_master', 'gym_bro', 'dance_teacher', 'drill_sergeant', 'frat_bro'];
    
    if (!validCoaches.includes(coachType)) {
      throw new Error(`Invalid coach type: ${coachType}. Valid types: ${validCoaches.join(', ')}`);
    }

    return await UserFactory.createBasic({
      coach: coachType,
      ...overrides
    });
  }

  /**
   * Create a user with specific spice level
   */
  static async createWithSpiceLevel(spiceLevel, overrides = {}) {
    if (spiceLevel < 1 || spiceLevel > 5) {
      throw new Error('Spice level must be between 1 and 5');
    }

    return await UserFactory.createBasic({
      spice_level: spiceLevel,
      ...overrides
    });
  }

  /**
   * Create a user with trial subscription
   */
  static async createWithTrial(overrides = {}) {
    const user = await UserFactory.createBasic(overrides);
    
    // Create trial subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .insert({
        user_phone: user.phone_number,
        status: 'trial',
        trial_start_timestamp: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days
      })
      .select()
      .single();

    if (subError) {
      throw new Error(`Failed to create trial subscription: ${subError.message}`);
    }

    return { ...user, subscription };
  }

  /**
   * Create a user with active subscription
   */
  static async createWithActiveSubscription(overrides = {}) {
    const user = await UserFactory.createBasic(overrides);
    
    // Create active subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .insert({
        user_phone: user.phone_number,
        status: 'active',
        stripe_customer_id: `cus_test_${Date.now()}`,
        stripe_subscription_id: `sub_test_${Date.now()}`,
        trial_start_timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
        last_payment_status: 'succeeded',
        last_payment_date: new Date().toISOString()
      })
      .select()
      .single();

    if (subError) {
      throw new Error(`Failed to create active subscription: ${subError.message}`);
    }

    return { ...user, subscription };
  }

  /**
   * Create multiple test users
   */
  static async createBatch(count, overrides = {}) {
    const users = [];
    for (let i = 0; i < count; i++) {
      const user = await UserFactory.createBasic({
        full_name: `Test User ${Date.now()}-${i}`,
        ...overrides
      });
      users.push(user);
    }
    return users;
  }

  /**
   * Create a user with specific preferences for testing
   */
  static async createForTesting(testId, overrides = {}) {
    const timestamp = Date.now();
    
    return await UserFactory.createBasic({
      full_name: `Test User ${testId}`,
      email: `test-${testId}-${timestamp}@example.com`,
      phone_number: `+1555${String(timestamp).slice(-7)}`, // Ensure unique phone
      ...overrides
    });
  }

  /**
   * Internal method to create user in database
   */
  async _createUser(userData) {
    const { data: user, error } = await supabase
      .from('user_profiles')
      .insert(userData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }

    return user;
  }

  /**
   * Clean up test users (for teardown)
   */
  static async cleanup(userIds = []) {
    if (userIds.length === 0) return;

    // Delete subscriptions first (due to foreign key constraints)
    const { data: users } = await supabase
      .from('user_profiles')
      .select('phone_number')
      .in('id', userIds);

    if (users && users.length > 0) {
      const phoneNumbers = users.map(u => u.phone_number);
      
      await supabase
        .from('subscriptions')
        .delete()
        .in('user_phone', phoneNumbers);
    }

    // Delete users
    const { error } = await supabase
      .from('user_profiles')
      .delete()
      .in('id', userIds);

    if (error) {
      console.warn(`Failed to cleanup users: ${error.message}`);
    }
  }

  /**
   * Clean up test users by email pattern
   */
  static async cleanupByEmailPattern(pattern = 'test-%@example.com') {
    // First get the users to delete
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, phone_number')
      .like('email', pattern);

    if (!users || users.length === 0) return;

    const userIds = users.map(u => u.id);
    const phoneNumbers = users.map(u => u.phone_number);

    // Delete subscriptions first
    await supabase
      .from('subscriptions')
      .delete()
      .in('user_phone', phoneNumbers);

    // Delete users
    await supabase
      .from('user_profiles')
      .delete()
      .in('id', userIds);

    console.log(`Cleaned up ${users.length} test users`);
  }
}

// Export predefined coach types for convenience
export const COACH_TYPES = {
  ZEN_MASTER: 'zen_master',
  GYM_BRO: 'gym_bro',
  DANCE_TEACHER: 'dance_teacher',
  DRILL_SERGEANT: 'drill_sergeant',
  FRAT_BRO: 'frat_bro'
};

export const SUBSCRIPTION_STATUS = {
  TRIAL: 'trial',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled'
}; 