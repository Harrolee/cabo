# Coach Builder System - React Webapp Integration Plan

## Overview
Adapt the Coach Builder system to integrate seamlessly with the existing React workout motivation webapp. The Coach Builder allows influencers to create AI personas that can chat with users via SMS, combining personality questionnaires with content analysis.

## Current Webapp Architecture Analysis

### Tech Stack
- **Frontend**: React 18 + Vite + React Router + Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth + Real-time + Storage)
- **Authentication**: SMS/OTP via Supabase Auth
- **Payments**: Stripe integration
- **Infrastructure**: Google Cloud Run + Cloud Functions
- **State Management**: React useState/useEffect (no Redux/Zustand yet)
- **Existing Coaches**: Predefined personas (zen_master, gym_bro, dance_teacher, drill_sergeant, frat_bro)

### Current Route Structure
```
/ - Main app (unauthenticated workout motivation)
/login - Login page (SMS/OTP)
/settings - Protected route (user settings)
/billing - Protected route (subscription management)
```

### Existing GCP Cloud Functions
```
functions/
├── cancel-stripe-subscription/
├── signup/
├── stripe-webhook/
├── process-sms/
├── shared/coach-personas.js      # Existing coach personalities
├── motivational-images/
├── create-stripe-subscription/
├── get-user-data/
└── create-setup-intent/
```

## Coach Builder Integration Plan

### 1. Route Structure Addition

```jsx
// New Routes to Add
/coach-builder - Unauthenticated coach creation flow
/coach-builder/personality - Personality questionnaire
/coach-builder/content - Content upload
/coach-builder/preview - AI coach preview/testing
/coach-builder/save - Redirect to login if unauthenticated
/my-coaches - Protected route (manage saved coaches)
/my-coaches/:id - Protected route (edit specific coach)
/my-coaches/:id/analytics - Protected route (coach performance)
```

### 2. Database Schema (Supabase)

✅ **Migration Created**: `supabase/migrations/20250119000000_add_coach_builder_tables.sql`

Key changes from original plan:
- References existing `user_profiles` table via `user_email`
- Uses phone-based RLS policies matching existing pattern
- Includes `file_path` for GCP Storage integration
- Service role permissions for GCP Cloud Functions access

#### New Tables Added
- `coach_profiles` - User-created AI coach personalities
- `coach_content_chunks` - Content uploaded for voice/style analysis
- `coach_test_messages` - Validation tests for coach responses

### 3. GCP Cloud Functions (NEW)

#### New Cloud Functions to Create

```
functions/
├── coach-content-processor/       # Process uploaded content files
├── coach-response-generator/      # Generate AI responses
├── coach-voice-analyzer/          # Extract voice patterns from content
├── coach-validator/               # Validate coach responses
└── shared/
    ├── coach-personas.js          # Existing predefined coaches
    └── coach-builder-utils.js     # NEW: Custom coach utilities
```

#### Content Processor Function
```javascript
// functions/coach-content-processor/index.js
const { createClient } = require('@supabase/supabase-js');
const { Storage } = require('@google-cloud/storage');
const OpenAI = require('openai');

exports.processCoachContent = async (req, res) => {
  const { coachId, fileDetails, contentType } = req.body;
  
  try {
    // 1. Download file from GCP Storage
    const storage = new Storage();
    const bucket = storage.bucket(process.env.GCP_STORAGE_BUCKET);
    const file = bucket.file(fileDetails.path);
    const [content] = await file.download();
    
    // 2. Extract text content
    const textContent = await extractText(content, contentType);
    
    // 3. Generate embeddings
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: textContent,
    });
    
    // 4. Analyze voice patterns
    const voicePatterns = await analyzeVoicePatterns(textContent);
    
    // 5. Store in Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    await supabase.from('coach_content_chunks').insert({
      coach_id: coachId,
      content: textContent,
      content_type: contentType,
      file_name: fileDetails.name,
      file_path: fileDetails.path,
      embedding: embeddingResponse.data[0].embedding,
      voice_patterns: voicePatterns,
      processed: true,
      word_count: textContent.split(' ').length
    });
    
    res.json({ success: true, processed: true });
  } catch (error) {
    console.error('Content processing error:', error);
    res.status(500).json({ error: error.message });
  }
};
```

#### Response Generator Function
```javascript
// functions/coach-response-generator/index.js
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

exports.generateCoachResponse = async (req, res) => {
  const { coachId, userMessage, userContext } = req.body;
  
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // 1. Get coach profile
    const { data: coach } = await supabase
      .from('coach_profiles')
      .select('*')
      .eq('id', coachId)
      .single();
    
    // 2. Find similar content using vector search
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const queryEmbedding = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: userMessage,
    });
    
    const { data: similarContent } = await supabase
      .rpc('search_similar_content', {
        p_coach_id: coachId,
        p_query_embedding: queryEmbedding.data[0].embedding,
        p_limit: 5
      });
    
    // 3. Build prompt with coach personality and similar content
    const prompt = buildCoachPrompt(coach, similarContent, userMessage, userContext);
    
    // 4. Generate response
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0.7
    });
    
    const response = completion.choices[0].message.content;
    
    // 5. Log for analytics
    await supabase.from('coach_test_messages').insert({
      coach_id: coachId,
      test_message: userMessage,
      actual_response: response,
      response_generated_at: new Date().toISOString()
    });
    
    res.json({ response, coachName: coach.name });
  } catch (error) {
    console.error('Response generation error:', error);
    res.status(500).json({ error: error.message });
  }
};
```

### 4. File Upload Strategy

#### GCP Storage Integration (Replacing Supabase Storage)

```jsx
// src/services/storageService.js
export class StorageService {
  static async uploadContent(file, coachId, contentType) {
    // 1. Get signed upload URL from GCP Cloud Function
    const uploadUrlResponse = await fetch(`${process.env.VITE_GCP_FUNCTIONS_URL}/get-upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        coachId,
        contentType,
        fileSize: file.size
      })
    });
    
    const { uploadUrl, filePath } = await uploadUrlResponse.json();
    
    // 2. Upload file directly to GCP Storage
    await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type }
    });
    
    // 3. Trigger content processing
    await fetch(`${process.env.VITE_GCP_FUNCTIONS_URL}/process-coach-content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coachId,
        fileDetails: {
          name: file.name,
          path: filePath,
          type: file.type,
          size: file.size
        },
        contentType
      })
    });
    
    return { filePath, processing: true };
  }
}
```

### 5. Component Architecture

#### New Components to Create

```
src/components/CoachBuilder/
├── CoachBuilderLanding.jsx       # Entry point, explains the feature
├── PersonalityQuestionnaire.jsx  # Multi-step personality form
├── ContentUpload.jsx             # File upload with GCP integration
├── CoachPreview.jsx              # Test chat interface
├── CoachSavePrompt.jsx           # Login prompt when saving
├── VoicePatternAnalysis.jsx      # Show extracted voice patterns
└── components/
    ├── QuestionSlider.jsx        # Custom slider for personality traits
    ├── FileUploadZone.jsx        # Drag & drop file upload
    ├── ChatBubble.jsx            # Preview chat message component
    ├── PersonalityRadar.jsx      # Personality visualization
    └── ProgressStepper.jsx       # Multi-step form progress

src/components/MyCoaches/
├── CoachDashboard.jsx            # List of user's coaches
├── CoachEditor.jsx               # Edit existing coach
├── CoachAnalytics.jsx            # Performance metrics
└── CoachCard.jsx                 # Individual coach preview card
```

### 6. Integration with Existing App Structure

#### Updated App.jsx Route Structure

```jsx
// Add to existing App.jsx
import { CoachBuilderProvider } from './contexts/CoachBuilderContext';
import CoachBuilderLanding from './components/CoachBuilder/CoachBuilderLanding';
import PersonalityQuestionnaire from './components/CoachBuilder/PersonalityQuestionnaire';
import ContentUpload from './components/CoachBuilder/ContentUpload';
import CoachPreview from './components/CoachBuilder/CoachPreview';
import CoachSavePrompt from './components/CoachBuilder/CoachSavePrompt';
import CoachDashboard from './components/MyCoaches/CoachDashboard';
import CoachEditor from './components/MyCoaches/CoachEditor';

// In the Routes section:
<Routes>
  <Route path="/login" element={<LoginPage />} />
  
  {/* Coach Builder - Unauthenticated Routes */}
  <Route path="/coach-builder/*" element={
    <CoachBuilderProvider>
      <Routes>
        <Route index element={<CoachBuilderLanding />} />
        <Route path="personality" element={<PersonalityQuestionnaire />} />
        <Route path="content" element={<ContentUpload />} />
        <Route path="preview" element={<CoachPreview />} />
        <Route path="save" element={<CoachSavePrompt />} />
      </Routes>
    </CoachBuilderProvider>
  } />
  
  {/* Protected Routes */}
  <Route element={<ProtectedRoute session={session}><AuthenticatedLayout session={session} /></ProtectedRoute>}>
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="/billing" element={<BillingPage />} />
    <Route path="/my-coaches" element={<CoachDashboard />} />
    <Route path="/my-coaches/:id" element={<CoachEditor />} />
    <Route path="/my-coaches/:id/analytics" element={<CoachAnalytics />} />
  </Route>

  <Route path="/*" element={<MainAppContent />} />
</Routes>
```

#### Updated AuthenticatedLayout

```jsx
const AuthenticatedLayout = ({ session }) => {
  return (
    <div>
      <nav className="bg-gray-800 text-white p-4">
        <ul className="flex space-x-4 items-center">
          <li><Link to="/">Home</Link></li>
          <li><Link to="/coach-builder">Coach Builder</Link></li>
          <li><Link to="/my-coaches">My Coaches</Link></li>
          <li><Link to="/settings">Settings</Link></li>
          <li><Link to="/billing">Billing</Link></li>
          <li className="ml-auto">Logged in as: {session.user.phone}</li>
          <li>
            <button 
              onClick={() => supabase.auth.signOut()} 
              className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm"
            >
              Sign Out
            </button>
          </li>
        </ul>
      </nav>
      <Outlet />
    </div>
  );
};
```

### 7. State Management Strategy

#### Context for Coach Builder Flow

```jsx
// src/contexts/CoachBuilderContext.jsx
export const CoachBuilderContext = createContext();

export const CoachBuilderProvider = ({ children }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [coachData, setCoachData] = useState({
    name: '',
    handle: '',
    personality: {},
    content: [],
    voicePatterns: {}
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  // Methods for managing coach creation flow
  const updatePersonality = (personalityData) => { /* ... */ };
  const addContent = async (contentData) => {
    // Use GCP Cloud Functions for processing
    await StorageService.uploadContent(contentData.file, coachData.id, contentData.type);
  };
  const processContent = async () => { /* ... */ };
  const saveCoach = async () => { /* ... */ };

  return (
    <CoachBuilderContext.Provider value={{
      currentStep, setCurrentStep,
      coachData, setCoachData,
      isProcessing, setIsProcessing,
      previewMode, setPreviewMode,
      updatePersonality,
      addContent,
      processContent,
      saveCoach
    }}>
      {children}
    </CoachBuilderContext.Provider>
  );
};
```

### 8. Environment Variables

#### Add to .env

```env
# Existing variables...
VITE_GCP_FUNCTIONS_URL=https://your-region-your-project.cloudfunctions.net

# GCP Cloud Functions will use these internally:
# OPENAI_API_KEY=your_openai_key
# SUPABASE_URL=your_supabase_url  
# SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
# GCP_STORAGE_BUCKET=your-bucket-name
```

### 9. GCP Infrastructure Setup

#### Terraform Updates Needed

```hcl
# Add to webapp/terraform/main.tf

resource "google_storage_bucket" "coach_content" {
  name     = "${var.project_id}-coach-content"
  location = var.region
  
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "PUT", "POST", "DELETE"]
    response_header = ["*"]
    max_age_seconds = 3600
  }
}

resource "google_cloudfunctions_function" "coach_content_processor" {
  name        = "coach-content-processor"
  runtime     = "nodejs18"
  entry_point = "processCoachContent"
  
  source_archive_bucket = google_storage_bucket.functions_bucket.name
  source_archive_object = google_storage_bucket_object.functions_zip.name
  
  trigger {
    http_trigger {
      url = null
    }
  }
  
  environment_variables = {
    OPENAI_API_KEY             = var.openai_api_key
    SUPABASE_URL              = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    GCP_STORAGE_BUCKET        = google_storage_bucket.coach_content.name
  }
}

# Similar resources for other coach functions...
```

### 10. Implementation Phases

#### Phase 1: Infrastructure & Database (Week 1)
- [ ] Run database migration in Supabase
- [ ] Set up GCP Storage bucket for coach content
- [ ] Create basic GCP Cloud Functions structure
- [ ] Build basic component structure
- [ ] Implement personality questionnaire

#### Phase 2: Content Processing (Week 2)
- [ ] Implement file upload to GCP Storage
- [ ] Create coach-content-processor Cloud Function
- [ ] Build content analysis pipeline with OpenAI
- [ ] Add voice pattern extraction
- [ ] Test content processing flow

#### Phase 3: AI Response Generation (Week 3)
- [ ] Create coach-response-generator Cloud Function
- [ ] Build chat preview interface
- [ ] Implement vector similarity search
- [ ] Add coach validation testing
- [ ] Create save/login flow

#### Phase 4: Dashboard & Management (Week 4)
- [ ] Build my-coaches dashboard
- [ ] Implement coach editing
- [ ] Add performance analytics
- [ ] Create sharing capabilities
- [ ] Polish and testing

### 11. Package Dependencies to Add

```json
{
  "dependencies": {
    "react-dropzone": "^14.2.3",
    "recharts": "^2.8.0",
    "react-hook-form": "^7.48.2",
    "zod": "^3.22.4",
    "@hookform/resolvers": "^3.3.2",
    "framer-motion": "^10.16.5" // Already installed
  }
}
```

### 12. Security Considerations

#### Row Level Security (RLS)
- Coaches can only be accessed by their creators
- Content chunks inherit coach permissions  
- Public coaches can be viewed by anyone
- GCP Cloud Functions use service role for full access

#### API Security
- Rate limiting on AI API calls via GCP
- File upload size limits (10MB per file)
- Content moderation for inappropriate uploads
- Signed URLs for secure file uploads

#### Privacy
- Option to make coaches public/private
- Content deletion when coach is deleted
- GDPR compliance for EU users

### 13. Testing Strategy

#### Component Testing
```jsx
// src/components/CoachBuilder/__tests__/PersonalityQuestionnaire.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { PersonalityQuestionnaire } from '../PersonalityQuestionnaire';

describe('PersonalityQuestionnaire', () => {
  test('renders all personality questions', () => {
    // Test implementation
  });
  
  test('validates required fields', () => {
    // Test implementation
  });
});
```

#### Integration Testing
- Test complete coach creation flow
- Verify AI response generation via GCP
- Test file upload and processing pipeline
- Validate database operations

## Summary of Changes from Original Plan

### ✅ **Database Integration**
- Created migration that integrates with existing `user_profiles` table
- Uses phone-based RLS policies matching existing pattern
- Added GCP storage path fields

### ✅ **GCP Cloud Functions**  
- Replaced Supabase Edge Functions with GCP Cloud Functions
- Leverages existing GCP infrastructure and buckets
- Integrates with existing Terraform setup

### ✅ **File Processing**
- Uses GCP Storage instead of Supabase Storage
- Integrates with existing GCP buckets and permissions
- Maintains security with signed URLs

This integration plan maintains your existing GCP-focused architecture while seamlessly adding the Coach Builder functionality. The system leverages your current infrastructure investments while adding new AI-powered coaching capabilities. 