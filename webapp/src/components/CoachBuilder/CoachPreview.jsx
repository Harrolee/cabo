import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCoachBuilder } from '../../contexts/CoachBuilderContext';
import ProgressStepper from './components/ProgressStepper';

const CoachPreview = () => {
  const navigate = useNavigate();
  const { coachData, generatePreviewResponse, nextStep, prevStep, previewMode, liveResponsesEnabled, updatePreviewCoach, setCoachData } = useCoachBuilder();
  
  const [testMessage, setTestMessage] = useState('');
  const [conversation, setConversation] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sliders, setSliders] = useState({
    energy_level: coachData.communication_traits?.energy_level ?? 5,
    directness: coachData.communication_traits?.directness ?? 5,
    formality: coachData.communication_traits?.formality ?? 3,
    emotion_focus: coachData.communication_traits?.emotion_focus ?? 5,
  });

  // Keep local sliders and context in sync with global coach data
  useEffect(() => {
    setSliders({
      energy_level: coachData.communication_traits?.energy_level ?? 5,
      directness: coachData.communication_traits?.directness ?? 5,
      formality: coachData.communication_traits?.formality ?? 3,
      emotion_focus: coachData.communication_traits?.emotion_focus ?? 5,
    });
  }, [coachData.communication_traits]);

  const sampleMessages = [
    "I'm feeling unmotivated to work out today",
    "I hit a new PR on my bench press!",
    "I've been stuck at the same weight for weeks",
    "I'm too tired to exercise",
    "What should I eat before my workout?",
    "I'm not seeing results despite working out regularly"
  ];

  const handleSendMessage = async (message) => {
    if (!message.trim()) return;

    // Add user message to conversation
    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: message,
      timestamp: new Date()
    };

    setConversation(prev => [...prev, userMessage]);
    setTestMessage('');
    setIsGenerating(true);

    try {
      // Generate AI response using the real function
      const response = await generatePreviewResponse(message, [...conversation, userMessage]);
      
      const aiMessage = {
        id: Date.now() + 1,
        type: 'ai',
        content: response,
        timestamp: new Date()
      };

      setConversation(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error generating response:', error);
      const errorMessage = {
        id: Date.now() + 1,
        type: 'ai',
        content: "Sorry, I'm having trouble responding right now. Please try again.",
        timestamp: new Date()
      };
      setConversation(prev => [...prev, errorMessage]);
    } finally {
      setIsGenerating(false);
    }
  };

  const onSliderChange = async (field, value) => {
    const numeric = parseInt(value);
    setSliders(prev => ({ ...prev, [field]: numeric }));
    // Update global state immediately for prompt building/fallbacks
    setCoachData(prev => ({
      ...prev,
      communication_traits: {
        ...(prev.communication_traits || {}),
        [field]: numeric,
      }
    }));
    // If live mode, persist to preview coach so backend uses these values
    await updatePreviewCoach({ communication_traits: {
      ...coachData.communication_traits,
      [field]: numeric
    }});
  };

  const clearConversation = () => {
    setConversation([]);
  };

  const handleNext = () => {
    nextStep();
    navigate('/coach-builder/save');
  };

  const handlePrev = () => {
    prevStep();
    navigate('/coach-builder/avatar');
  };

  const formatTime = (timestamp) => {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Coach Summary */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Your AI Coach</h2>
            <p className="text-sm text-gray-500 mb-4">Click any field to edit. Use sliders to tune voice, then test in chat.</p>
            
            {/* Avatar Display */}
            {coachData.avatarData?.selectedAvatar && (
              <div className="mb-6 text-center">
                <img
                  src={coachData.avatarData.selectedAvatar.url}
                  alt="Coach Avatar"
                  className="w-24 h-24 object-cover rounded-full mx-auto border-4 border-blue-500"
                />
                <p className="text-sm text-gray-600 mt-2">
                  {coachData.avatarData.selectedAvatar.style} Style
                </p>
              </div>
            )}
            
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-gray-700">Name</h3>
                <input
                  type="text"
                  value={coachData.name || ''}
                  onChange={(e) => setCoachData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Your coach name"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div>
                <h3 className="font-semibold text-gray-700">Handle</h3>
                <div className="flex mt-1">
                  <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500">@</span>
                  <input
                    type="text"
                    value={coachData.handle || ''}
                    onChange={(e) => setCoachData(prev => ({ ...prev, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
                    placeholder="my-coach"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-r-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              
              <div>
                <h3 className="font-semibold text-gray-700">Response Style</h3>
                <select
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 capitalize"
                  value={coachData.primary_response_style || ''}
                  onChange={(e) => setCoachData(prev => ({ ...prev, primary_response_style: e.target.value }))}
                >
                  <option value="">Select a style</option>
                  {['tough_love','empathetic_mirror','reframe_master','data_driven','story_teller','cheerleader','wise_mentor'].map(v => (
                    <option key={v} value={v}>{v.replace('_',' ')}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <h3 className="font-semibold text-gray-700">Communication Traits</h3>
                {/* Live-adjust sliders */}
                <div className="space-y-5 mt-3">
                  {[
                    { field: 'energy_level', label: 'Energy Level', low: 'Calm', high: 'High Energy', min: 1, max: 10 },
                    { field: 'directness', label: 'Directness', low: 'Gentle', high: 'Blunt', min: 1, max: 10 },
                    { field: 'formality', label: 'Formality', low: 'Casual', high: 'Formal', min: 1, max: 10 },
                    { field: 'emotion_focus', label: 'Approach', low: 'Logic', high: 'Emotion', min: 1, max: 10 }
                  ].map(cfg => (
                    <div key={cfg.field}>
                      <div className="flex justify-between mb-1">
                        <label className="text-sm font-medium text-gray-700">{cfg.label}</label>
                        <span className="text-sm font-semibold text-blue-600">{sliders[cfg.field]}</span>
                      </div>
                      <input
                        type="range"
                        min={cfg.min}
                        max={cfg.max}
                        value={sliders[cfg.field]}
                        onChange={(e) => onSliderChange(cfg.field, e.target.value)}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>{cfg.low}</span>
                        <span>{cfg.high}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h3 className="font-semibold text-gray-700">Content Uploaded</h3>
                <div className="flex items-center justify-between">
                  <p className="text-gray-900">{coachData.content?.length || 0} files {previewMode && '(optional later)'}</p>
                  <button
                    className="text-sm text-blue-600 hover:text-blue-800"
                    onClick={() => navigate('/coach-builder/content')}
                  >
                    Manage Content
                  </button>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-700">Avatar</h3>
                <div className="mt-1">
                  <button
                    onClick={() => navigate('/coach-builder/avatar')}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    {coachData.avatarData?.selectedAvatar ? 'Change Avatar' : 'Add Avatar'}
                  </button>
                </div>
              </div>

              {/* Content Processing Status */}
              {coachData.content && coachData.content.length > 0 && (
                <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Note:</strong> Your coach is using the personality settings and mock responses for preview. 
                    Once saved, it will be trained on your uploaded content for more personalized responses.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Chat Interface */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-gray-900">Test Your Coach</h2>
              {conversation.length > 0 && (
                <button
                  onClick={clearConversation}
                  className="text-sm text-gray-600 hover:text-gray-800"
                >
                  Clear Chat
                </button>
              )}
            </div>

            {/* Chat Messages */}
            <div className="h-80 overflow-y-auto mb-4 border border-gray-200 rounded-lg p-4 space-y-4">
              {conversation.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <p className="mb-2">👋 Start a conversation with your AI coach!</p>
                  <p className="text-sm">Try asking about motivation, workout advice, or share your progress.</p>
                </div>
              ) : (
                conversation.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        message.type === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <p className="text-sm">{message.content}</p>
                      <p className={`text-xs mt-1 ${
                        message.type === 'user' ? 'text-blue-100' : 'text-gray-500'
                      }`}>
                        {formatTime(message.timestamp)}
                      </p>
                    </div>
                  </div>
                ))
              )}
              
              {isGenerating && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-900 px-4 py-2 rounded-lg">
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sample Messages */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Try these sample messages:</h3>
              <div className="flex flex-wrap gap-2">
                {sampleMessages.map((sample, index) => (
                  <button
                    key={index}
                    onClick={() => handleSendMessage(sample)}
                    disabled={isGenerating}
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded-full transition-colors disabled:opacity-50"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            {/* Message Input */}
            <div className="flex space-x-2">
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder="Type a message to test your coach..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !isGenerating) {
                    handleSendMessage(testMessage);
                  }
                }}
                disabled={isGenerating}
              />
              <button
                onClick={() => handleSendMessage(testMessage)}
                disabled={!testMessage.trim() || isGenerating}
                className={`px-4 py-2 rounded-lg font-medium ${
                  testMessage.trim() && !isGenerating
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between items-center mt-8 bg-white rounded-lg shadow-sm p-6">
          <button
            onClick={handlePrev}
            className="px-6 py-2 text-gray-600 hover:text-gray-800 font-medium"
          >
            ← Back
          </button>

          <div className="text-center">
            <p className="text-sm text-gray-600">
              Happy with your coach? Save it to start using it!
            </p>
          </div>

          <button
            onClick={handleNext}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            Save Coach →
          </button>
        </div>
      </div>
    </div>
  );
};

export default CoachPreview; 