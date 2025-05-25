import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCoachBuilder } from '../../contexts/CoachBuilderContext';
import ProgressStepper from './components/ProgressStepper';

const CoachPreview = () => {
  const navigate = useNavigate();
  const { coachData, nextStep, prevStep } = useCoachBuilder();
  
  const [testMessage, setTestMessage] = useState('');
  const [conversation, setConversation] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

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
      // Simulate AI response generation
      // TODO: Replace with actual GCP Cloud Function call
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const response = generateMockResponse(message, coachData);
      
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

  const generateMockResponse = (message, coach) => {
    // Simple mock response based on coach personality
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

  const clearConversation = () => {
    setConversation([]);
  };

  const handleNext = () => {
    nextStep();
    navigate('/coach-builder/save');
  };

  const handlePrev = () => {
    prevStep();
    navigate('/coach-builder/content');
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
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Your AI Coach</h2>
            
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-gray-700">Name</h3>
                <p className="text-gray-900">{coachData.name || 'Unnamed Coach'}</p>
              </div>
              
              <div>
                <h3 className="font-semibold text-gray-700">Handle</h3>
                <p className="text-gray-900">@{coachData.handle || 'unknown'}</p>
              </div>
              
              <div>
                <h3 className="font-semibold text-gray-700">Response Style</h3>
                <p className="text-gray-900 capitalize">
                  {coachData.primary_response_style?.replace('_', ' ') || 'Not selected'}
                </p>
              </div>
              
              <div>
                <h3 className="font-semibold text-gray-700">Communication Traits</h3>
                <div className="space-y-2">
                  {coachData.communication_traits && Object.entries(coachData.communication_traits).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-sm text-gray-600 capitalize">
                        {key.replace('_', ' ')}:
                      </span>
                      <span className="text-sm font-medium">{value}/10</span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h3 className="font-semibold text-gray-700">Content Uploaded</h3>
                <p className="text-gray-900">{coachData.content?.length || 0} files</p>
              </div>
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
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded-full transition-colors"
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