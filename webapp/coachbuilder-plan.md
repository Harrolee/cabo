# Coach Builder System Specification

## Overview
The Coach Builder allows influencers to create AI personas that can chat with users via SMS. It combines personality questionnaires with content analysis to create consistent, authentic AI coaches.

## Core Components

### 1. Personality Questionnaire System

#### Response Style Patterns
```python
RESPONSE_STYLES = {
    "tough_love": "Challenges users, never coddles, redirects complaints into action",
    "empathetic_mirror": "Validates feelings first, then motivates from understanding", 
    "reframe_master": "Always flips negative perspectives into positive growth opportunities",
    "data_driven": "Uses facts, studies, and metrics to support advice",
    "story_teller": "Responds with personal anecdotes and relatable experiences",
    "cheerleader": "High energy, lots of encouragement and celebration",
    "wise_mentor": "Calm, thoughtful guidance with deeper life lessons"
}
```

#### Emotional Response Mapping
```python
EMOTIONAL_NEEDS = {
    "encouragement": "User wants motivation to keep going",
    "commiseration": "User wants someone to understand their struggle", 
    "pity": "User wants validation that their situation is difficult",
    "celebration": "User wants to share success and be congratulated",
    "advice": "User wants specific guidance or solutions",
    "accountability": "User wants to be held responsible for commitments",
    "check_in": "User wants casual conversation about progress"
}
```

#### Questionnaire Structure
```python
PERSONALITY_QUESTIONS = [
    {
        "question": "When someone comes to you feeling defeated about fitness, how do you typically respond?",
        "type": "single_select",
        "options": [
            {"value": "tough_love", "label": "Challenge them to push through the negativity"},
            {"value": "empathetic_mirror", "label": "Validate their feelings first, then encourage"},
            {"value": "story_teller", "label": "Share a similar struggle you've overcome"},
            {"value": "reframe_master", "label": "Focus on what they can learn from this setback"}
        ]
    },
    {
        "question": "Your fans love you because you're known for being...",
        "type": "single_select", 
        "options": [
            {"value": "tough_love", "label": "The coach who never lets excuses slide"},
            {"value": "empathetic_mirror", "label": "The friend who really gets their struggles"},
            {"value": "data_driven", "label": "The expert who always has receipts"},
            {"value": "story_teller", "label": "The storyteller who makes everything relatable"}
        ]
    },
    {
        "question": "When someone seeks pity or wants to complain, you typically...",
        "type": "single_select",
        "options": [
            {"value": "redirect_action", "label": "Redirect them toward solutions and action"},
            {"value": "validate_then_motivate", "label": "Acknowledge their feelings then motivate"},
            {"value": "share_perspective", "label": "Share your own experience with similar challenges"},
            {"value": "reframe_positive", "label": "Help them see the positive side of their situation"}
        ]
    },
    {
        "question": "Your communication style tends to be...",
        "type": "slider_multi",
        "dimensions": [
            {"name": "energy_level", "low": "Calm & Steady", "high": "High Energy & Intense"},
            {"name": "directness", "low": "Gentle & Indirect", "high": "Direct & Blunt"},
            {"name": "formality", "low": "Casual & Friendly", "high": "Professional & Structured"},
            {"name": "emotion_focus", "low": "Logic & Facts", "high": "Feelings & Emotions"}
        ]
    }
]
```

### 2. Content Upload & Processing

#### Content Types
```python
CONTENT_SOURCES = {
    "instagram_posts": {
        "format": "json",
        "fields": ["caption", "comments", "engagement_metrics", "hashtags"],
        "processing": "extract_voice_patterns"
    },
    "video_transcripts": {
        "format": "txt",
        "fields": ["transcript", "video_title", "duration"],
        "processing": "extract_speech_patterns"
    },
    "podcast_transcripts": {
        "format": "txt", 
        "fields": ["transcript", "episode_title", "guest_info"],
        "processing": "extract_conversation_style"
    },
    "written_content": {
        "format": "txt",
        "fields": ["title", "content", "publication_date"],
        "processing": "extract_writing_style"
    }
}
```

#### Voice Pattern Extraction
```python
VOICE_PATTERNS = {
    "sentence_structure": ["short_punchy", "long_explanatory", "mixed_varied"],
    "punctuation_style": ["minimal", "moderate", "emoji_heavy", "exclamation_heavy"],
    "vocabulary_level": ["casual_slang", "professional", "technical", "motivational"],
    "catchphrases": [], # Auto-extracted repeated phrases
    "grammar_patterns": ["formal", "conversational", "intentional_errors"],
    "typical_sentence_starters": [], # Auto-extracted common beginnings
    "closing_patterns": [] # Auto-extracted common endings
}
```

### 3. Database Schema

#### Influencer Profiles
```sql
CREATE TABLE influencer_profiles (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    handle VARCHAR(100) UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Personality Configuration
    primary_response_style VARCHAR(50),
    secondary_response_style VARCHAR(50),
    emotional_response_map JSONB,
    communication_traits JSONB,
    
    -- Voice Configuration  
    voice_patterns JSONB,
    catchphrases TEXT[],
    vocabulary_preferences JSONB,
    
    -- Content Processing Status
    content_processed BOOLEAN DEFAULT FALSE,
    total_content_pieces INTEGER DEFAULT 0,
    
    -- Settings
    active BOOLEAN DEFAULT TRUE,
    max_daily_interactions INTEGER DEFAULT 100
);
```

#### Content Chunks for Vector Storage
```sql
CREATE TABLE content_chunks (
    id UUID PRIMARY KEY,
    influencer_id UUID REFERENCES influencer_profiles(id),
    
    -- Content
    content TEXT NOT NULL,
    content_type VARCHAR(50), -- 'instagram_post', 'video_transcript', etc.
    source_url VARCHAR(500),
    
    -- Tagging Dimensions
    intent_tags TEXT[], -- 'motivation', 'advice', 'celebration', etc.
    situation_tags TEXT[], -- 'pre_workout', 'struggling', 'plateau', etc. 
    emotional_need_tags TEXT[], -- 'encouragement', 'commiseration', 'pity', etc.
    response_style_tags TEXT[], -- 'tough_love', 'empathetic', etc.
    
    -- Voice Characteristics
    voice_sample BOOLEAN DEFAULT FALSE, -- Is this a good example of their voice?
    sentence_structure VARCHAR(50),
    energy_level INTEGER, -- 1-10 scale
    
    -- Vector Storage
    embedding VECTOR(1536), -- For similarity search
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    word_count INTEGER,
    engagement_metrics JSONB
);
```

### 4. API Endpoints Structure

#### Coach Builder Endpoints
```python
# POST /api/coaches/create
{
    "name": "string",
    "handle": "string", 
    "personality_responses": {
        "response_style": "tough_love",
        "emotional_mappings": {...},
        "communication_traits": {...}
    }
}

# POST /api/coaches/{coach_id}/content/upload
{
    "content_type": "instagram_posts",
    "files": [...],
    "processing_options": {
        "auto_tag": true,
        "extract_voice": true
    }
}

# GET /api/coaches/{coach_id}/preview
# Returns sample conversations for testing

# POST /api/coaches/{coach_id}/test-message
{
    "message": "I'm struggling with my workout today",
    "user_context": {...}
}
```

### 5. Validation & Testing

#### Coach Validation Checklist
```python
VALIDATION_STEPS = [
    "personality_questionnaire_complete",
    "content_uploaded_and_processed", 
    "voice_patterns_extracted",
    "test_conversations_reviewed",
    "response_consistency_verified",
    "brand_alignment_confirmed"
]
```

#### Sample Test Scenarios
```python
TEST_SCENARIOS = [
    {
        "user_message": "I'm so tired, can't do this workout",
        "expected_emotional_need": "encouragement",
        "expected_response_style": "based_on_coach_personality"
    },
    {
        "user_message": "I hit a new PR today!",
        "expected_emotional_need": "celebration", 
        "expected_response_style": "celebratory"
    },
    {
        "user_message": "I've been stuck at the same weight for weeks",
        "expected_emotional_need": "advice",
        "expected_response_style": "problem_solving"
    }
]
```

## Implementation Phases

### Phase 1: Basic Builder
- Personality questionnaire interface
- Content upload system
- Basic voice pattern extraction
- Simple preview functionality

### Phase 2: Advanced Processing
- Automatic content tagging
- Voice pattern analysis
- Response consistency testing
- Brand alignment verification

### Phase 3: Optimization
- A/B testing different personality configurations
- Content quality scoring
- Performance analytics
- Automated improvements

## Technical Requirements

### Frontend Requirements
- React/Next.js application
- File upload with progress tracking
- Interactive questionnaire forms
- Real-time preview chat interface
- Personality trait visualization

### Backend Requirements
- FastAPI or Django REST framework
- Background job processing (Celery/Redis)
- File storage (S3 or similar)
- Vector database integration
- Content analysis pipeline

### Infrastructure
- PostgreSQL with pgvector extension
- Redis for caching and job queues
- Background workers for content processing
- API rate limiting and authentication