import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCoachBuilder } from '../../contexts/CoachBuilderContext';
import ProgressStepper from './components/ProgressStepper';

const AvatarUpload = () => {
  const navigate = useNavigate();
  const { coachData, updateAvatar, nextStep, prevStep } = useCoachBuilder();
  
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAvatars, setGeneratedAvatars] = useState([]);
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [generationError, setGenerationError] = useState('');

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleFileSelect = (file) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    setSelectedFile(file);
    
    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    
    // Clear previous generation results
    setGeneratedAvatars([]);
    setSelectedAvatar(null);
    setGenerationError('');
  };

  const handleGenerateAvatars = async () => {
    if (!selectedFile) {
      alert('Please select a selfie first');
      return;
    }

    setIsGenerating(true);
    setGenerationError('');

    try {
      // Create form data
      const formData = new FormData();
      formData.append('selfie', selectedFile);
      formData.append('coachId', coachData.tempCoachId || `temp-${Date.now()}`);

      // Call avatar generation function
      const response = await fetch(`${import.meta.env.VITE_API_URL}/coach-avatar-generator`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate avatars');
      }

      const result = await response.json();
      
      if (result.avatars && result.avatars.length > 0) {
        setGeneratedAvatars(result.avatars);
        
        // Auto-select the first avatar
        setSelectedAvatar(result.avatars[0]);
        
        // Store generation info in coach data
        updateAvatar({
          generatedAvatars: result.avatars,
          selectedAvatar: result.avatars[0],
          originalSelfieUrl: result.selfieStoragePath,
          tempCoachId: formData.get('coachId')
        });

        if (result.failedStyles && result.failedStyles.length > 0) {
          console.warn('Some avatar styles failed to generate:', result.failedStyles);
        }
      } else {
        throw new Error('No avatars were generated');
      }

    } catch (error) {
      console.error('Error generating avatars:', error);
      setGenerationError(error.message);
      
      // If generation completely fails, use the selfie as avatar
      if (previewUrl) {
        const fallbackAvatar = {
          style: 'Original Photo',
          url: previewUrl,
          filename: selectedFile.name
        };
        setGeneratedAvatars([fallbackAvatar]);
        setSelectedAvatar(fallbackAvatar);
        
        updateAvatar({
          generatedAvatars: [fallbackAvatar],
          selectedAvatar: fallbackAvatar,
          originalSelfieUrl: previewUrl,
          tempCoachId: coachData.tempCoachId || `temp-${Date.now()}`
        });
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAvatarSelect = (avatar) => {
    setSelectedAvatar(avatar);
    updateAvatar({
      ...coachData.avatarData,
      selectedAvatar: avatar
    });
  };

  const handleNext = () => {
    if (!selectedAvatar) {
      alert('Please select an avatar to continue');
      return;
    }
    
    nextStep();
    navigate('/coach-builder/preview');
  };

  const handlePrev = () => {
    prevStep();
    navigate('/coach-builder/content');
  };

  const handleSkip = () => {
    // Update coach data to indicate no avatar
    updateAvatar({
      generatedAvatars: [],
      selectedAvatar: null,
      originalSelfieUrl: null,
      skipped: true
    });
    
    nextStep();
    navigate('/coach-builder/preview');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <ProgressStepper />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Create Your Avatar
            </h1>
            <p className="text-lg text-gray-600">
              Upload a selfie to generate professional avatar options for your AI coach
            </p>
          </div>

          {/* File Upload Area */}
          {!selectedFile && (
            <div className="mb-8">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragOver
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <div className="text-4xl mb-4">📸</div>
                <p className="text-lg font-medium text-gray-900 mb-2">
                  Drop your selfie here or click to browse
                </p>
                <p className="text-gray-600 mb-4">
                  JPG, PNG up to 10MB
                </p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                  id="selfie-upload"
                />
                <label
                  htmlFor="selfie-upload"
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 cursor-pointer inline-block"
                >
                  Choose Photo
                </label>
              </div>
            </div>
          )}

          {/* Selected File Preview */}
          {selectedFile && previewUrl && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Your Selfie</h2>
              <div className="flex items-start gap-6">
                <div className="flex-shrink-0">
                  <img
                    src={previewUrl}
                    alt="Selected selfie"
                    className="w-32 h-32 object-cover rounded-lg border"
                  />
                </div>
                <div className="flex-1">
                  <p className="text-gray-900 font-medium">{selectedFile.name}</p>
                  <p className="text-gray-600 text-sm">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={handleGenerateAvatars}
                      disabled={isGenerating}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGenerating ? 'Generating...' : 'Generate Avatars'}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedFile(null);
                        setPreviewUrl(null);
                        setGeneratedAvatars([]);
                        setSelectedAvatar(null);
                        setGenerationError('');
                      }}
                      className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
                    >
                      Choose Different Photo
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Generation Status */}
          {isGenerating && (
            <div className="mb-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-lg text-gray-600">
                Generating your professional avatars...
              </p>
              <p className="text-sm text-gray-500 mt-2">
                This may take 1-2 minutes
              </p>
            </div>
          )}

          {/* Generation Error */}
          {generationError && (
            <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg">
              <h3 className="text-red-800 font-medium mb-2">Avatar Generation Failed</h3>
              <p className="text-red-700 text-sm mb-3">{generationError}</p>
              <p className="text-red-600 text-sm">
                Don't worry! We'll use your original photo as your avatar.
              </p>
            </div>
          )}

          {/* Generated Avatars */}
          {generatedAvatars.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Choose Your Avatar Style
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {generatedAvatars.map((avatar, index) => (
                  <div
                    key={index}
                    onClick={() => handleAvatarSelect(avatar)}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      selectedAvatar?.style === avatar.style
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <img
                      src={avatar.url}
                      alt={`${avatar.style} avatar`}
                      className="w-full h-48 object-cover rounded-lg mb-3"
                    />
                    <h3 className="font-semibold text-gray-900 text-center">
                      {avatar.style}
                    </h3>
                    {selectedAvatar?.style === avatar.style && (
                      <div className="mt-2 text-center">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          ✓ Selected
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={handlePrev}
              className="bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700"
            >
              ← Previous
            </button>

            <button
              onClick={handleSkip}
              className="text-gray-600 hover:text-gray-800 px-4 py-2"
            >
              Skip Avatar Creation
            </button>

            <button
              onClick={handleNext}
              disabled={!selectedAvatar}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AvatarUpload; 