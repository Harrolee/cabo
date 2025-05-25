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
    public: false
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [processingStatus, setProcessingStatus] = useState('idle'); // 'idle', 'uploading', 'processing', 'complete', 'error'

  // Steps in the coach builder flow
  const steps = [
    { id: 'landing', name: 'Welcome', path: '/coach-builder' },
    { id: 'personality', name: 'Personality', path: '/coach-builder/personality' },
    { id: 'content', name: 'Content Upload', path: '/coach-builder/content' },
    { id: 'preview', name: 'Preview & Test', path: '/coach-builder/preview' },
    { id: 'save', name: 'Save Coach', path: '/coach-builder/save' }
  ];

  // Update personality data from questionnaire
  const updatePersonality = (personalityData) => {
    setCoachData(prev => ({
      ...prev,
      ...personalityData
    }));
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
      const uploadUrlResponse = await fetch(`${import.meta.env.VITE_GCP_FUNCTION_BASE_URL}/coach-file-uploader`, {
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
          const response = await fetch(`${import.meta.env.VITE_GCP_FUNCTION_BASE_URL}/coach-file-uploader/${fileData.id}`, {
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
      // Create a temporary coach ID for preview (use a consistent one for session)
      const tempCoachId = sessionStorage.getItem('previewCoachId') || 'preview-coach-' + Date.now();
      sessionStorage.setItem('previewCoachId', tempCoachId);

      const response = await fetch(`${import.meta.env.VITE_GCP_FUNCTION_BASE_URL}/coach-response-generator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coachId: tempCoachId,
          userMessage: userMessage,
          userContext: {
            previousMessages: conversationHistory.slice(-4) // Last 4 messages for context
          }
        })
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

  // Save coach to database (requires authentication)
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
        total_content_pieces: uploadedFiles.length
      };

      // Insert coach profile
      const { data: coach, error: coachError } = await supabase
        .from('coach_profiles')
        .insert(dbData)
        .select()
        .single();

      if (coachError) throw coachError;

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
      public: false
    });
    setUploadedFiles([]);
    setCurrentStep(0);
    setProcessingStatus('idle');
    sessionStorage.removeItem('previewCoachId');
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
    
    // Actions
    updatePersonality,
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