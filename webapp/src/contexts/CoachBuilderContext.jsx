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
      
      // For now, just store the file info locally
      // Later this will upload to GCP Storage and trigger processing
      const newContent = {
        id: Date.now().toString(),
        file: contentData.file,
        type: contentData.type,
        status: 'pending',
        uploadedAt: new Date().toISOString()
      };

      setUploadedFiles(prev => [...prev, newContent]);
      setCoachData(prev => ({
        ...prev,
        content: [...prev.content, newContent]
      }));

      toast.success(`${contentData.file.name} added successfully`);
      setProcessingStatus('complete');
    } catch (error) {
      console.error('Error adding content:', error);
      toast.error('Failed to add content');
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

  // Process uploaded content (placeholder for GCP function call)
  const processContent = async () => {
    try {
      setIsProcessing(true);
      setProcessingStatus('processing');
      
      // TODO: Call GCP Cloud Function to process content
      // For now, simulate processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setProcessingStatus('complete');
      toast.success('Content processed successfully');
    } catch (error) {
      console.error('Error processing content:', error);
      toast.error('Failed to process content');
      setProcessingStatus('error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Save coach to database (requires authentication)
  const saveCoach = async (userEmail) => {
    try {
      setIsProcessing(true);
      
      if (!userEmail) {
        throw new Error('User must be logged in to save coach');
      }

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      // Insert coach profile
      const { data: coach, error: coachError } = await supabase
        .from('coach_profiles')
        .insert({
          user_id: user.id,
          user_email: userEmail,
          name: coachData.name,
          handle: coachData.handle,
          description: coachData.description,
          primary_response_style: coachData.primary_response_style,
          secondary_response_style: coachData.secondary_response_style,
          emotional_response_map: coachData.emotional_response_map,
          communication_traits: coachData.communication_traits,
          voice_patterns: coachData.voice_patterns,
          catchphrases: coachData.catchphrases,
          vocabulary_preferences: coachData.vocabulary_preferences,
          public: coachData.public
        })
        .select()
        .single();

      if (coachError) throw coachError;

      // TODO: Upload content files to GCP Storage and save content chunks
      
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
    saveCoach,
    resetCoachData,
    goToStep,
    nextStep,
    prevStep
  };

  return (
    <CoachBuilderContext.Provider value={value}>
      {children}
    </CoachBuilderContext.Provider>
  );
}; 