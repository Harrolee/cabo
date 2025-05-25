import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key'
);

/**
 * Factory for creating test coaches with various configurations
 */
export class CoachFactory {
  constructor() {
    this.defaultData = {
      name: 'Test Coach',
      handle: 'test-coach',
      description: 'A test coach for integration testing',
      primary_response_style: 'empathetic_mirror',
      secondary_response_style: null,
      emotional_response_map: {},
      communication_traits: {
        energy_level: 5,
        directness: 5,
        emotion_focus: 5
      },
      voice_patterns: {
        sentence_structure: 'mixed_varied',
        vocabulary_level: 'professional'
      },
      catchphrases: [],
      vocabulary_preferences: {},
      content_processed: false,
      total_content_pieces: 0,
      processing_status: 'pending',
      active: true,
      max_daily_interactions: 100,
      public: false,
      preview_sessions: 0,
      total_conversations: 0
    };
  }

  /**
   * Create a basic test coach
   */
  static async createBasic(userEmail, overrides = {}) {
    const factory = new CoachFactory();
    const timestamp = Date.now();
    
    const coachData = {
      ...factory.defaultData,
      user_email: userEmail,
      name: `Test Coach ${timestamp}`,
      handle: `test-coach-${timestamp}`,
      ...overrides
    };

    return await factory._createCoach(coachData);
  }

  /**
   * Create a coach with specific response style
   */
  static async createWithStyle(userEmail, primaryStyle, secondaryStyle = null, overrides = {}) {
    const validStyles = [
      'tough_love', 'empathetic_mirror', 'reframe_master', 
      'data_driven', 'story_teller', 'cheerleader', 'wise_mentor'
    ];
    
    if (!validStyles.includes(primaryStyle)) {
      throw new Error(`Invalid primary style: ${primaryStyle}. Valid styles: ${validStyles.join(', ')}`);
    }
    
    if (secondaryStyle && !validStyles.includes(secondaryStyle)) {
      throw new Error(`Invalid secondary style: ${secondaryStyle}. Valid styles: ${validStyles.join(', ')}`);
    }

    return await CoachFactory.createBasic(userEmail, {
      primary_response_style: primaryStyle,
      secondary_response_style: secondaryStyle,
      ...overrides
    });
  }

  /**
   * Create a tough love coach
   */
  static async createToughLove(userEmail, overrides = {}) {
    return await CoachFactory.createWithStyle(userEmail, 'tough_love', null, {
      name: 'Tough Love Coach',
      description: 'A no-nonsense coach who pushes you to your limits',
      communication_traits: {
        energy_level: 8,
        directness: 9,
        emotion_focus: 3
      },
      catchphrases: [
        'No excuses!',
        'Push through the pain!',
        'Champions are made in moments like this!'
      ],
      ...overrides
    });
  }

  /**
   * Create an empathetic coach
   */
  static async createEmpathetic(userEmail, overrides = {}) {
    return await CoachFactory.createWithStyle(userEmail, 'empathetic_mirror', null, {
      name: 'Empathetic Coach',
      description: 'A caring coach who understands your struggles',
      communication_traits: {
        energy_level: 6,
        directness: 4,
        emotion_focus: 9
      },
      catchphrases: [
        'I understand how you feel',
        'You\'re not alone in this',
        'Let\'s work through this together'
      ],
      ...overrides
    });
  }

  /**
   * Create a data-driven coach
   */
  static async createDataDriven(userEmail, overrides = {}) {
    return await CoachFactory.createWithStyle(userEmail, 'data_driven', null, {
      name: 'Data Coach',
      description: 'A coach who uses facts and research to motivate',
      communication_traits: {
        energy_level: 5,
        directness: 7,
        emotion_focus: 3
      },
      catchphrases: [
        'Studies show that...',
        'The data indicates...',
        'Research proves...'
      ],
      vocabulary_preferences: {
        technical_terms: true,
        statistics: true,
        research_references: true
      },
      ...overrides
    });
  }

  /**
   * Create a coach with content
   */
  static async createWithContent(userEmail, contentPieces = [], overrides = {}) {
    const coach = await CoachFactory.createBasic(userEmail, {
      total_content_pieces: contentPieces.length,
      content_processed: contentPieces.length > 0,
      processing_status: contentPieces.length > 0 ? 'complete' : 'pending',
      ...overrides
    });

    // Add content pieces
    for (const content of contentPieces) {
      await CoachContentFactory.create(coach.id, content);
    }

    return coach;
  }

  /**
   * Create a public coach (shareable)
   */
  static async createPublic(userEmail, overrides = {}) {
    return await CoachFactory.createBasic(userEmail, {
      public: true,
      name: 'Public Test Coach',
      description: 'A publicly available test coach',
      ...overrides
    });
  }

  /**
   * Create multiple test coaches
   */
  static async createBatch(userEmail, count, overrides = {}) {
    const coaches = [];
    for (let i = 0; i < count; i++) {
      const coach = await CoachFactory.createBasic(userEmail, {
        name: `Test Coach ${Date.now()}-${i}`,
        handle: `test-coach-${Date.now()}-${i}`,
        ...overrides
      });
      coaches.push(coach);
    }
    return coaches;
  }

  /**
   * Create a coach for specific testing scenario
   */
  static async createForTesting(userEmail, testId, overrides = {}) {
    const timestamp = Date.now();
    
    return await CoachFactory.createBasic(userEmail, {
      name: `Test Coach ${testId}`,
      handle: `test-coach-${testId}-${timestamp}`,
      description: `Test coach for scenario: ${testId}`,
      ...overrides
    });
  }

  /**
   * Internal method to create coach in database
   */
  async _createCoach(coachData) {
    const { data: coach, error } = await supabase
      .from('coach_profiles')
      .insert(coachData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create coach: ${error.message}`);
    }

    return coach;
  }

  /**
   * Clean up test coaches
   */
  static async cleanup(coachIds = []) {
    if (coachIds.length === 0) return;

    // Delete related content first
    await supabase
      .from('coach_content_chunks')
      .delete()
      .in('coach_id', coachIds);

    await supabase
      .from('coach_test_messages')
      .delete()
      .in('coach_id', coachIds);

    // Delete coaches
    const { error } = await supabase
      .from('coach_profiles')
      .delete()
      .in('id', coachIds);

    if (error) {
      console.warn(`Failed to cleanup coaches: ${error.message}`);
    }
  }

  /**
   * Clean up test coaches by handle pattern
   */
  static async cleanupByHandlePattern(pattern = 'test-coach-%') {
    // First get the coaches to delete
    const { data: coaches } = await supabase
      .from('coach_profiles')
      .select('id')
      .like('handle', pattern);

    if (!coaches || coaches.length === 0) return;

    const coachIds = coaches.map(c => c.id);
    await CoachFactory.cleanup(coachIds);

    console.log(`Cleaned up ${coaches.length} test coaches`);
  }
}

/**
 * Factory for creating coach content chunks
 */
export class CoachContentFactory {
  static async create(coachId, contentData = {}) {
    const defaultContent = {
      coach_id: coachId,
      content: 'Sample coach content for testing',
      content_type: 'written_content',
      source_url: null,
      file_name: null,
      file_path: null,
      intent_tags: ['motivation'],
      situation_tags: ['general'],
      emotional_need_tags: ['encouragement'],
      response_style_tags: ['empathetic'],
      voice_sample: false,
      sentence_structure: 'mixed',
      energy_level: 5,
      embedding: null, // Would be generated in real usage
      processed: true,
      processing_error: null,
      word_count: 10,
      engagement_metrics: {}
    };

    const { data: content, error } = await supabase
      .from('coach_content_chunks')
      .insert({ ...defaultContent, ...contentData })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create coach content: ${error.message}`);
    }

    return content;
  }

  /**
   * Create motivational content
   */
  static async createMotivational(coachId, overrides = {}) {
    return await CoachContentFactory.create(coachId, {
      content: "You've got this! Every rep, every step, every breath is bringing you closer to your goals. Don't give up now!",
      content_type: 'instagram_post',
      intent_tags: ['motivation', 'encouragement'],
      situation_tags: ['pre_workout', 'struggling'],
      emotional_need_tags: ['encouragement'],
      response_style_tags: ['cheerleader'],
      energy_level: 8,
      word_count: 20,
      ...overrides
    });
  }

  /**
   * Create advice content
   */
  static async createAdvice(coachId, overrides = {}) {
    return await CoachContentFactory.create(coachId, {
      content: "Remember to warm up properly before your workout. Start with 5-10 minutes of light cardio to get your blood flowing.",
      content_type: 'blog_post',
      intent_tags: ['advice', 'education'],
      situation_tags: ['pre_workout'],
      emotional_need_tags: ['advice'],
      response_style_tags: ['data_driven'],
      energy_level: 5,
      word_count: 18,
      ...overrides
    });
  }

  /**
   * Create tough love content
   */
  static async createToughLove(coachId, overrides = {}) {
    return await CoachContentFactory.create(coachId, {
      content: "Stop making excuses! You said you wanted to change, so prove it. The weights don't care about your feelings.",
      content_type: 'video_transcript',
      intent_tags: ['motivation', 'accountability'],
      situation_tags: ['struggling', 'plateau'],
      emotional_need_tags: ['accountability'],
      response_style_tags: ['tough_love'],
      energy_level: 9,
      word_count: 17,
      ...overrides
    });
  }
}

/**
 * Factory for creating test messages
 */
export class CoachTestMessageFactory {
  static async create(coachId, messageData = {}) {
    const defaultMessage = {
      coach_id: coachId,
      test_message: 'I need motivation for my workout',
      expected_response_style: 'empathetic_mirror',
      expected_emotional_need: 'encouragement',
      actual_response: null,
      response_generated_at: null,
      human_rating: null,
      automated_score: null,
      test_scenario: 'basic_motivation',
      validation_notes: null
    };

    const { data: message, error } = await supabase
      .from('coach_test_messages')
      .insert({ ...defaultMessage, ...messageData })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create test message: ${error.message}`);
    }

    return message;
  }

  /**
   * Create a test message with response
   */
  static async createWithResponse(coachId, testMessage, actualResponse, overrides = {}) {
    return await CoachTestMessageFactory.create(coachId, {
      test_message: testMessage,
      actual_response: actualResponse,
      response_generated_at: new Date().toISOString(),
      ...overrides
    });
  }
}

// Export response styles for convenience
export const RESPONSE_STYLES = {
  TOUGH_LOVE: 'tough_love',
  EMPATHETIC_MIRROR: 'empathetic_mirror',
  REFRAME_MASTER: 'reframe_master',
  DATA_DRIVEN: 'data_driven',
  STORY_TELLER: 'story_teller',
  CHEERLEADER: 'cheerleader',
  WISE_MENTOR: 'wise_mentor'
};

export const CONTENT_TYPES = {
  INSTAGRAM_POST: 'instagram_post',
  VIDEO_TRANSCRIPT: 'video_transcript',
  PODCAST_TRANSCRIPT: 'podcast_transcript',
  WRITTEN_CONTENT: 'written_content',
  SOCIAL_MEDIA_COMMENT: 'social_media_comment',
  BLOG_POST: 'blog_post'
}; 