import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCoachBuilder } from '../../contexts/CoachBuilderContext';
import ProgressStepper from './components/ProgressStepper';
import Background from './components/Background';

const ContentUpload = () => {
  const navigate = useNavigate();
  const { 
    coachData, 
    uploadedFiles, 
    addContent, 
    removeContent, 
    isProcessing, 
    processingStatus,
    nextStep, 
    prevStep 
  } = useCoachBuilder();
  
  const [dragOver, setDragOver] = useState(false);

  const contentTypes = [
    { id: 'instagram_post', label: 'Instagram Posts', accept: '.txt,.json', description: 'Caption text or exported data' },
    { id: 'video_transcript', label: 'Video Transcripts', accept: '.txt,.srt', description: 'Text transcripts of your videos' },
    { id: 'podcast_transcript', label: 'Podcast Transcripts', accept: '.txt', description: 'Transcripts from podcast episodes' },
    { id: 'written_content', label: 'Written Content', accept: '.txt,.md,.doc,.docx', description: 'Blog posts, articles, newsletters' },
    { id: 'social_media_comment', label: 'Social Media', accept: '.txt,.csv', description: 'Comments, replies, social posts' },
    { id: 'blog_post', label: 'Blog Posts', accept: '.txt,.md,.html', description: 'Published blog content' }
  ];

  const [selectedContentType, setSelectedContentType] = useState('');

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
    
    if (!selectedContentType) {
      alert('Please select a content type first');
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => handleFileUpload(file));
  };

  const handleFileSelect = (e) => {
    if (!selectedContentType) {
      alert('Please select a content type first');
      return;
    }

    const files = Array.from(e.target.files);
    files.forEach(file => handleFileUpload(file));
  };

  const handleFileUpload = async (file) => {
    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    // Validate file type
    const selectedType = contentTypes.find(type => type.id === selectedContentType);
    const allowedExtensions = selectedType.accept.split(',').map(ext => ext.trim());
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      alert(`Invalid file type. Allowed types: ${selectedType.accept}`);
      return;
    }

    try {
      await addContent({
        file,
        type: selectedContentType
      });
    } catch (error) {
      console.error('Error uploading file:', error);
    }
  };

  const handleNext = () => {
    // Content upload is now optional - users can skip and add files later
    nextStep();
    navigate('/coach-builder/avatar');
  };

  const handlePrev = () => {
    prevStep();
    navigate('/coach-builder/personality');
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Background>
      {/* Header */}
      <div className="bg-white/80 backdrop-blur shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <ProgressStepper />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white/90 backdrop-blur rounded-lg shadow-sm p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Upload Your Content (Optional)
            </h1>
            <p className="text-lg text-gray-600">
              Upload your existing content to train your AI coach's voice and style, or skip this step and add content later
            </p>
          </div>

          {/* Info Section */}
          <div className="bg-blue-50 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-blue-900 mb-3">
              💡 When to upload content
            </h2>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <h3 className="font-medium text-blue-800 mb-2">Upload now if you have:</h3>
                <ul className="text-blue-700 space-y-1">
                  <li>• Existing written content ready</li>
                  <li>• Video/podcast transcripts</li>
                  <li>• Social media posts to analyze</li>
                  <li>• Time to upload multiple files</li>
                </ul>
              </div>
              <div>
                <h3 className="font-medium text-blue-800 mb-2">Skip for now if you:</h3>
                <ul className="text-blue-700 space-y-1">
                  <li>• Want to test your coach first</li>
                  <li>• Need time to gather content</li>
                  <li>• Prefer to start with basic responses</li>
                  <li>• Will add content gradually</li>
                </ul>
              </div>
            </div>
            <p className="text-blue-600 text-sm mt-3 italic">
              Note: Your coach will work without content, but uploaded content helps it respond more like you.
            </p>
          </div>

          {/* Content Type Selection */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Select Content Type
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {contentTypes.map((type) => (
                <div
                  key={type.id}
                  onClick={() => setSelectedContentType(type.id)}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    selectedContentType === type.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <h3 className="font-semibold text-gray-900 mb-1">{type.label}</h3>
                  <p className="text-sm text-gray-600 mb-2">{type.description}</p>
                  <p className="text-xs text-gray-500">Accepts: {type.accept}</p>
                </div>
              ))}
            </div>
          </div>

          {/* File Upload Area */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Upload Files
            </h2>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragOver
                  ? 'border-blue-500 bg-blue-50'
                  : selectedContentType
                  ? 'border-gray-300 hover:border-gray-400'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              {selectedContentType ? (
                <>
                  <div className="text-4xl mb-4">📁</div>
                  <p className="text-lg font-medium text-gray-900 mb-2">
                    Drop files here or click to browse
                  </p>
                  <p className="text-gray-600 mb-4">
                    Selected type: {contentTypes.find(t => t.id === selectedContentType)?.label}
                  </p>
                  <input
                    type="file"
                    multiple
                    accept={contentTypes.find(t => t.id === selectedContentType)?.accept}
                    onChange={handleFileSelect}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 cursor-pointer inline-block"
                  >
                    Choose Files
                  </label>
                  <p className="text-sm text-gray-500 mt-2">
                    Maximum file size: 10MB per file
                  </p>
                </>
              ) : (
                <>
                  <div className="text-4xl mb-4 opacity-50">📁</div>
                  <p className="text-lg text-gray-500">
                    Please select a content type first
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Uploaded Files List */}
          {uploadedFiles.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Uploaded Files ({uploadedFiles.length})
              </h2>
              <div className="space-y-3">
                {uploadedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                        <span className="text-blue-600 font-semibold">
                          {file.file.name.split('.').pop().toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{file.file.name}</p>
                        <p className="text-sm text-gray-500">
                          {formatFileSize(file.file.size)} • {contentTypes.find(t => t.id === file.type)?.label}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <span className="text-sm text-green-600 mr-3">✓ Uploaded</span>
                      <button
                        onClick={() => removeContent(file.id)}
                        className="text-red-600 hover:text-red-800 p-1"
                        title="Remove file"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Processing Status */}
          {isProcessing && (
            <div className="mb-8 p-4 bg-blue-50 rounded-lg">
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-600 mr-3"></div>
                <span className="text-blue-900 font-medium">
                  {processingStatus === 'uploading' && 'Uploading files...'}
                  {processingStatus === 'processing' && 'Processing content...'}
                </span>
              </div>
            </div>
          )}

          {/* Help Text */}
          <div className="mb-8 p-4 bg-yellow-50 rounded-lg">
            <h3 className="font-semibold text-yellow-900 mb-2">Tips for better results:</h3>
            <ul className="text-yellow-800 text-sm space-y-1">
              <li>• Upload content that represents your typical communication style</li>
              <li>• Include a variety of content types (motivational, educational, personal)</li>
              <li>• More content = better AI training (aim for at least 5-10 pieces)</li>
              <li>• Text files work best - avoid images or videos</li>
            </ul>
          </div>

          {/* Navigation */}
          <div className="flex justify-between items-center pt-6 border-t border-gray-200">
            <button
              onClick={handlePrev}
              className="px-6 py-2 text-gray-600 hover:text-gray-800 font-medium"
            >
              ← Back
            </button>

            <div className="text-sm text-gray-500">
              {uploadedFiles.length} file{uploadedFiles.length !== 1 ? 's' : ''} uploaded
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleNext}
                className="px-6 py-2 text-gray-600 hover:text-gray-800 font-medium"
              >
                Skip for now
              </button>
              <button
                onClick={handleNext}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                Continue →
              </button>
            </div>
          </div>
        </div>
      </div>
    </Background>
  );
};

export default ContentUpload; 