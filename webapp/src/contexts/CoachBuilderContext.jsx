import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../main';
import { toast } from 'react-hot-toast';

const CoachBuilderContext = createContext();

export const useCoachBuilder = () => {
  const context = useContext(CoachBuilderContext);
  if (!context) {
    throw new Error('useCoachBuilder must be used within a CoachBuilderProvider');
  }
  return context;
};

export const CoachBuilderProvider = ({ children }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [coachData, setCoachData] = useState({
    name: '',
    handle: '',
    description: '',
    primary_response_style: '',
    secondary_response_style: '',
    emotional_response_map: {},
    communication_traits: {},
    voice_patterns: {},
    catchphrases: [],
    vocabulary_preferences: {},
    content: [],
    public: false,
    // Avatar data
    avatarData: {
      generatedAvatars: [],
      selectedAvatar: null,
      originalSelfieUrl: null,
      tempCoachId: null,
      skipped: false
    }
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [processingStatus, setProcessingStatus] = useState('idle'); // 'idle', 'uploading', 'processing', 'complete', 'error'
  const [liveResponsesEnabled, setLiveResponsesEnabled] = useState(false);
  const [previewCoachId, setPreviewCoachId] = useState(null);

  // Steps in the coach builder flow (now includes avatar upload)
  const fullSteps = [
    { id: 'landing', name: 'Welcome', path: '/coach-builder' },
    { id: 'personality', name: 'Personality', path: '/coach-builder/personality' },
    { id: 'content', name: 'Content Upload (Optional)', path: '/coach-builder/content' },
    { id: 'avatar', name: 'Avatar Upload', path: '/coach-builder/avatar' },
    { id: 'preview', name: 'Preview & Test', path: '/coach-builder/preview' },
    { id: 'save', name: 'Save Coach', path: '/coach-builder/save' }
  ];

  // In Quick Start mode, simplify the steps to reduce perceived effort
  const quickSteps = [
    { id: 'landing', name: 'Welcome', path: '/coach-builder' },
    { id: 'preview', name: 'Preview & Test', path: '/coach-builder/preview' },
    { id: 'save', name: 'Save Coach', path: '/coach-builder/save' }
  ];

  const steps = previewMode ? quickSteps : fullSteps;

  // Update personality data from questionnaire
  const updatePersonality = (personalityData) => {
    setCoachData(prev => ({
      ...prev,
      ...personalityData
    }));
  };

  // Update avatar data
  const updateAvatar = (avatarData) => {
    setCoachData(prev => ({
      ...prev,
      avatarData: {
        ...prev.avatarData,
        ...avatarData
      }
    }));
  };

  // Start a minimal flow with sensible defaults and skip to preview
  const startQuickStart = (presetStyle = 'empathetic_mirror') => {
    setPreviewMode(true);
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    setCoachData(prev => ({
      ...prev,
      name: prev.name && prev.name.trim() ? prev.name : 'Sample Coach',
      handle: prev.handle && prev.handle.trim() ? prev.handle : `coach-${randomSuffix}`,
      description: prev.description || '',
      primary_response_style: presetStyle,
      communication_traits: {
        energy_level: 5,
        directness: 5,
        formality: 3,
        emotion_focus: 5,
        ...(prev.communication_traits || {})
      },
      avatarData: {
        generatedAvatars: [],
        selectedAvatar: null,
        originalSelfieUrl: null,
        tempCoachId: null,
        skipped: true
      },
      content: []
    }));
    // Move step index to the Preview position for quick flow
    setCurrentStep(1);
  };

  // Add content file to the coach
  const addContent = async (contentData) => {
    try {
      setIsProcessing(true);
      setProcessingStatus('uploading');
      
      const { file, type } = contentData;
      
      // Generate a temporary coach ID for preview mode
      const tempCoachId = `temp-id-${Date.now()}`;
      
      // Step 1: Get signed upload URL
      console.log('Getting signed upload URL...');
      const uploadUrlResponse = await fetch(`${import.meta.env.VITE_API_URL}/coach-file-uploader`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coachId: tempCoachId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          contentType: type
        })
      });

      if (!uploadUrlResponse.ok) {
        const error = await uploadUrlResponse.json();
        throw new Error(error.error || 'Failed to get upload URL');
      }

      const { uploadUrl, filePath, fileId, uploadTimestamp, coachId: signedCoachId } = await uploadUrlResponse.json();

      // Step 2: Upload file directly to GCP Storage
      console.log('Uploading file to GCP Storage...');
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
          'x-goog-meta-coach-id': signedCoachId,
          'x-goog-meta-upload-timestamp': uploadTimestamp
        },
        body: file
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file to storage');
      }

      // Step 3: Store file info locally for now (will be processed when coach is saved)
      const newContent = {
        id: fileId,
        file: file,
        type: type,
        filePath: filePath,
        status: 'uploaded',
        uploadedAt: new Date().toISOString(),
        processed: false
      };

      setUploadedFiles(prev => [...prev, newContent]);
      setCoachData(prev => ({
        ...prev,
        content: [...prev.content, newContent]
      }));

      toast.success(`${file.name} uploaded successfully`);
      setProcessingStatus('complete');
    } catch (error) {
      console.error('Error uploading content:', error);
      toast.error(`Failed to upload ${contentData.file.name}: ${error.message}`);
      setProcessingStatus('error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Remove content file
  const removeContent = (contentId) => {
    setUploadedFiles(prev => prev.filter(file => file.id !== contentId));
    setCoachData(prev => ({
      ...prev,
      content: prev.content.filter(content => content.id !== contentId)
    }));
    toast.success('Content removed');
  };

  // Process uploaded content (now happens during save)
  const processContent = async (coachId) => {
    try {
      setIsProcessing(true);
      setProcessingStatus('processing');
      
      console.log(`Processing ${uploadedFiles.length} files for coach ${coachId}...`);
      
      // Process each uploaded file
      const processingPromises = uploadedFiles.map(async (fileData) => {
        try {
          const response = await fetch(`${import.meta.env.VITE_API_URL}/coach-file-uploader/${fileData.id}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              coachId: coachId,
              filePath: fileData.filePath,
              fileName: fileData.file.name,
              fileSize: fileData.file.size,
              contentType: fileData.type
            })
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Processing failed');
          }

          const result = await response.json();
          console.log(`Processed file ${fileData.file.name}:`, result);
          return result;
        } catch (error) {
          console.error(`Failed to process ${fileData.file.name}:`, error);
          throw error;
        }
      });

      const results = await Promise.all(processingPromises);
      
      setProcessingStatus('complete');
      toast.success('All content processed successfully');
      return results;
    } catch (error) {
      console.error('Error processing content:', error);
      toast.error('Failed to process some content files');
      setProcessingStatus('error');
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  // Generate AI response for preview
  const generatePreviewResponse = async (userMessage, conversationHistory = []) => {
    try {
      // Try to use a real coach if available; otherwise send snapshot for unauth preview
      let usingSnapshot = false;
      let coachIdToUse = previewCoachId;
      if (!liveResponsesEnabled || !coachIdToUse) {
        usingSnapshot = true;
      }

      // Map conversation history to expected schema
      const mappedHistory = (conversationHistory || []).slice(-4).map((msg) => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.content,
        timestamp: (msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp) || new Date().toISOString()
      }));

      const body = usingSnapshot
        ? {
            coachSnapshot: {
              name: coachData.name || 'Sample Coach',
              handle: coachData.handle || undefined,
              description: coachData.description || undefined,
              primary_response_style: coachData.primary_response_style || 'empathetic_mirror',
              secondary_response_style: coachData.secondary_response_style || undefined,
              emotional_response_map: coachData.emotional_response_map || {},
              communication_traits: coachData.communication_traits || {
                energy_level: 5, directness: 5, formality: 3, emotion_focus: 5
              },
              voice_patterns: coachData.voice_patterns || {},
              catchphrases: coachData.catchphrases || [],
              vocabulary_preferences: coachData.vocabulary_preferences || {},
              avatar_url: coachData.avatarData?.selectedAvatar?.url || undefined,
              avatar_style: coachData.avatarData?.selectedAvatar?.style || undefined
            },
            userMessage,
            userContext: { previousMessages: mappedHistory }
          }
        : {
            coachId: coachIdToUse,
            userMessage,
            userContext: { previousMessages: mappedHistory }
          };

      const response = await fetch(`${import.meta.env.VITE_API_URL}/coach-response-generator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        // Fallback to mock response if function isn't available
        console.warn('AI response function not available, using mock response');
        return generateMockResponse(userMessage, coachData);
      }

      const result = await response.json();
      return result.response;
    } catch (error) {
      console.error('Error generating AI response:', error);
      // Fallback to mock response
      return generateMockResponse(userMessage, coachData);
    }
  };

  // Enable live responses by creating (or reusing) a draft coach profile tied to the logged-in user
  const enableLiveResponses = async () => {
    try {
      if (liveResponsesEnabled && previewCoachId) {
        return previewCoachId;
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('You must be logged in to enable live responses');
      }

      // Insert minimal coach profile as draft if none exists yet
      if (!previewCoachId) {
        const dbData = {
          user_id: user.id,
          user_email: user.email,
          name: coachData.name || 'Sample Coach',
          handle: coachData.handle || `coach-${Math.random().toString(36).slice(2,8)}`,
          description: coachData.description || null,
          primary_response_style: coachData.primary_response_style || 'empathetic_mirror',
          secondary_response_style: coachData.secondary_response_style || null,
          emotional_response_map: coachData.emotional_response_map || {},
          communication_traits: coachData.communication_traits || { energy_level: 5, directness: 5, formality: 3, emotion_focus: 5 },
          voice_patterns: coachData.voice_patterns || {},
          catchphrases: coachData.catchphrases || [],
          vocabulary_preferences: coachData.vocabulary_preferences || {},
          public: false,
          content_processed: false,
          total_content_pieces: uploadedFiles.length || 0,
          avatar_url: coachData.avatarData?.selectedAvatar?.url || null,
          avatar_style: coachData.avatarData?.selectedAvatar?.style || null,
          original_selfie_url: coachData.avatarData?.originalSelfieUrl || null,
          active: true
        };

        const { data: coach, error: coachError } = await supabase
          .from('coach_profiles')
          .insert(dbData)
          .select()
          .single();

        if (coachError) throw coachError;

        setPreviewCoachId(coach.id);
      }

      setLiveResponsesEnabled(true);
      toast.success('Live responses enabled');
      return previewCoachId;
    } catch (error) {
      console.error('Failed to enable live responses:', error);
      toast.error(error.message || 'Failed to enable live responses');
      throw error;
    }
  };

  // Update persisted coach fields while in live mode (e.g., when sliders change)
  const updatePreviewCoach = async (partialUpdate) => {
    try {
      if (!liveResponsesEnabled || !previewCoachId) return;
      const { error } = await supabase
        .from('coach_profiles')
        .update(partialUpdate)
        .eq('id', previewCoachId);
      if (error) throw error;
    } catch (error) {
      console.warn('Failed to update preview coach:', error);
    }
  };

  // Mock response generator (fallback)
  const generateMockResponse = (message, coach) => {
    const responses = {
      tough_love: [
        "No excuses! Every champion has felt like this. What are you going to do about it?",
        "Stop making excuses and start making progress. You've got this!",
        "Feeling tired? Good. That means you're pushing your limits."
      ],
      empathetic_mirror: [
        "I hear you, and those feelings are totally valid. Let's work through this together.",
        "It sounds like you're going through a tough time. That's okay - we all have those days.",
        "I understand how frustrating that must feel. You're not alone in this."
      ],
      cheerleader: [
        "YES! You're absolutely amazing! Let's keep that energy going! 💪",
        "OMG that's INCREDIBLE! I'm so proud of you! Keep crushing it!",
        "You're doing FANTASTIC! Every step forward is a victory!"
      ],
      story_teller: [
        "You know, I remember when I felt exactly the same way. Let me tell you what changed everything for me...",
        "This reminds me of a client I had who struggled with the same thing. Here's what we discovered...",
        "I've been there too. Here's what I learned from my own journey..."
      ]
    };

    const styleResponses = responses[coach.primary_response_style] || responses.empathetic_mirror;
    return styleResponses[Math.floor(Math.random() * styleResponses.length)];
  };

  // Save coach to database (requires authentication) - Updated to include avatar
  const saveCoach = async (userEmail) => {
    try {
      setIsProcessing(true);
      
      if (!userEmail) {
        throw new Error('User must be logged in to save coach');
      }

      // Validate required fields
      if (!coachData.name || !coachData.name.trim()) {
        throw new Error('Coach name is required');
      }
      
      if (!coachData.handle || !coachData.handle.trim()) {
        throw new Error('Coach handle is required');
      }
      
      if (!coachData.primary_response_style) {
        throw new Error('Please complete the personality questionnaire to select a response style');
      }

      // Validate that the response style is one of the valid enum values
      const validResponseStyles = [
        'tough_love',
        'empathetic_mirror', 
        'reframe_master',
        'data_driven',
        'story_teller',
        'cheerleader',
        'wise_mentor'
      ];
      
      if (!validResponseStyles.includes(coachData.primary_response_style)) {
        throw new Error(`Invalid response style: ${coachData.primary_response_style}. Please complete the personality questionnaire.`);
      }

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      // Prepare data for database (convert empty strings to null for enum fields)
      const dbData = {
        user_id: user.id,
        user_email: userEmail,
        name: coachData.name,
        handle: coachData.handle,
        description: coachData.description,
        primary_response_style: coachData.primary_response_style || null,
        secondary_response_style: coachData.secondary_response_style || null,
        emotional_response_map: coachData.emotional_response_map,
        communication_traits: coachData.communication_traits,
        voice_patterns: coachData.voice_patterns,
        catchphrases: coachData.catchphrases,
        vocabulary_preferences: coachData.vocabulary_preferences,
        public: coachData.public,
        content_processed: false,
        total_content_pieces: uploadedFiles.length,
        // Avatar fields - only include if avatar was created
        avatar_url: coachData.avatarData.selectedAvatar?.url || null,
        avatar_style: coachData.avatarData.selectedAvatar?.style || null,
        original_selfie_url: coachData.avatarData.originalSelfieUrl || null
      };

      // Insert coach profile
      const { data: coach, error: coachError } = await supabase
        .from('coach_profiles')
        .insert(dbData)
        .select()
        .single();

      if (coachError) throw coachError;

      // If avatar was generated, save the selected avatar choice
      if (coachData.avatarData.selectedAvatar && !coachData.avatarData.skipped) {
        try {
          await fetch(`${import.meta.env.VITE_API_URL}/coach-avatar-generator/save-avatar`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              coachId: coach.id,
              selectedAvatarUrl: coachData.avatarData.selectedAvatar.url,
              avatarStyle: coachData.avatarData.selectedAvatar.style,
              originalSelfieUrl: coachData.avatarData.originalSelfieUrl
            })
          });
        } catch (avatarError) {
          console.warn('Failed to save avatar data via cloud function:', avatarError);
          // Continue with coach creation even if avatar save fails
        }
      }

      // Process uploaded content files
      if (uploadedFiles.length > 0) {
        console.log('Processing uploaded content...');
        await processContent(coach.id);
        
        // Update coach as processed
        await supabase
          .from('coach_profiles')
          .update({ content_processed: true })
          .eq('id', coach.id);
      }
      
      toast.success('Coach saved successfully!');
      return coach;
    } catch (error) {
      console.error('Error saving coach:', error);
      toast.error(`Failed to save coach: ${error.message}`);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  // Reset coach data
  const resetCoachData = () => {
    setCoachData({
      name: '',
      handle: '',
      description: '',
      primary_response_style: '',
      secondary_response_style: '',
      emotional_response_map: {},
      communication_traits: {},
      voice_patterns: {},
      catchphrases: [],
      vocabulary_preferences: {},
      content: [],
      public: false,
      avatarData: {
        generatedAvatars: [],
        selectedAvatar: null,
        originalSelfieUrl: null,
        tempCoachId: null,
        skipped: false
      }
    });
    setUploadedFiles([]);
    setCurrentStep(0);
    setProcessingStatus('idle');
    sessionStorage.removeItem('previewCoachId');
    setPreviewMode(false);
    setLiveResponsesEnabled(false);
    setPreviewCoachId(null);
  };

  // Navigate to specific step
  const goToStep = (stepIndex) => {
    if (stepIndex >= 0 && stepIndex < steps.length) {
      setCurrentStep(stepIndex);
    }
  };

  // Navigate to next step
  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  // Navigate to previous step
  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  // Validate coach data completeness
  const validateCoachData = () => {
    const errors = [];
    
    if (!coachData.name || !coachData.name.trim()) {
      errors.push('Coach name is required');
    }
    
    if (!coachData.handle || !coachData.handle.trim()) {
      errors.push('Coach handle is required');
    }
    
    // Check for both undefined and empty string
    if (!coachData.primary_response_style || coachData.primary_response_style === '') {
      errors.push('Response style must be selected (complete personality questionnaire)');
    }
    
    const validResponseStyles = [
      'tough_love',
      'empathetic_mirror', 
      'reframe_master',
      'data_driven',
      'story_teller',
      'cheerleader',
      'wise_mentor'
    ];
    
    if (coachData.primary_response_style && 
        coachData.primary_response_style !== '' && 
        !validResponseStyles.includes(coachData.primary_response_style)) {
      errors.push(`Invalid response style: "${coachData.primary_response_style}". Valid options: ${validResponseStyles.join(', ')}`);
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  };

  const value = {
    // State
    currentStep,
    coachData,
    isProcessing,
    previewMode,
    uploadedFiles,
    processingStatus,
    steps,
    
    // Setters
    setCurrentStep,
    setCoachData,
    setPreviewMode,
    startQuickStart,
    liveResponsesEnabled,
    previewCoachId,
    enableLiveResponses,
    updatePreviewCoach,
    
    // Actions
    updatePersonality,
    updateAvatar,
    addContent,
    removeContent,
    processContent,
    generatePreviewResponse,
    saveCoach,
    resetCoachData,
    goToStep,
    nextStep,
    prevStep,
    validateCoachData
  };

  return (
    <CoachBuilderContext.Provider value={value}>
      {children}
    </CoachBuilderContext.Provider>
  );
}; 