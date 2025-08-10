import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../main';
import { toast } from 'react-hot-toast';

// Custom CSS for range sliders
const sliderStyles = `
  .slider {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }

  .slider::-webkit-slider-track {
    background: #e5e7eb;
    height: 8px;
    border-radius: 4px;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    background: #2563eb;
    height: 20px;
    width: 20px;
    border-radius: 50%;
    cursor: pointer;
  }

  .slider::-moz-range-track {
    background: #e5e7eb;
    height: 8px;
    border-radius: 4px;
    border: none;
  }

  .slider::-moz-range-thumb {
    background: #2563eb;
    height: 20px;
    width: 20px;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }
`;

const CoachEdit = () => {
  const navigate = useNavigate();
  const { coachId } = useParams();
  const [coach, setCoach] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Chat state
  const [testMessage, setTestMessage] = useState('');
  const [conversation, setConversation] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Editable coach data
  const [editedCoach, setEditedCoach] = useState({
    name: '',
    handle: '',
    description: '',
    primary_response_style: '',
    communication_traits: {}
  });

  const responseStyles = [
    { value: 'motivational', label: 'Motivational' },
    { value: 'analytical', label: 'Analytical' },
    { value: 'supportive', label: 'Supportive' },
    { value: 'direct', label: 'Direct' },
    { value: 'encouraging', label: 'Encouraging' },
    { value: 'tough_love', label: 'Tough Love' }
  ];

  // Standardized across app: energy_level, directness, formality, emotion_focus
  const communicationTraits = [
    { key: 'energy_level', label: 'Energy Level', description: 'Calm ↔ High Energy' },
    { key: 'directness', label: 'Directness', description: 'Gentle ↔ Blunt' },
    { key: 'formality', label: 'Formality', description: 'Casual ↔ Formal' },
    { key: 'emotion_focus', label: 'Approach', description: 'Logic ↔ Emotion' }
  ];

  const sampleMessages = [
    "I'm feeling unmotivated to work out today",
    "I hit a new PR on my bench press!",
    "I've been stuck at the same weight for weeks",
    "I'm too tired to exercise",
    "What should I eat before my workout?",
    "I'm not seeing results despite working out regularly"
  ];

  useEffect(() => {
    if (coachId) {
      fetchCoach();
    }
  }, [coachId]);

  const fetchCoach = async () => {
    try {
      const { data: coachData, error } = await supabase
        .from('coach_profiles')
        .select('*')
        .eq('id', coachId)
        .single();

      if (error) throw error;
      
      setCoach(coachData);
      const defaultTraits = { energy_level: 5, directness: 5, formality: 3, emotion_focus: 5 };
      setEditedCoach({
        name: coachData.name || '',
        handle: coachData.handle || '',
        description: coachData.description || '',
        primary_response_style: coachData.primary_response_style || '',
        communication_traits: {
          ...defaultTraits,
          ...(coachData.communication_traits || {})
        }
      });
    } catch (error) {
      console.error('Error fetching coach:', error);
      toast.error('Failed to load coach data');
    } finally {
      setLoading(false);
    }
  };

  const updateCoachField = (field, value) => {
    setEditedCoach(prev => ({
      ...prev,
      [field]: value
    }));
    setHasChanges(true);
  };

  const updateCommunicationTrait = (trait, value) => {
    setEditedCoach(prev => ({
      ...prev,
      communication_traits: {
        ...prev.communication_traits,
        [trait]: value
      }
    }));
    setHasChanges(true);
  };

  const saveChanges = async () => {
    try {
      setSaving(true);
      
      const { error } = await supabase
        .from('coach_profiles')
        .update({
          name: editedCoach.name,
          handle: editedCoach.handle,
          description: editedCoach.description,
          primary_response_style: editedCoach.primary_response_style,
          communication_traits: editedCoach.communication_traits,
          updated_at: new Date().toISOString()
        })
        .eq('id', coachId);

      if (error) throw error;
      
      // Update local coach state
      setCoach(prev => ({
        ...prev,
        ...editedCoach,
        updated_at: new Date().toISOString()
      }));
      
      setHasChanges(false);
      toast.success('Coach settings saved successfully!');
    } catch (error) {
      console.error('Error saving coach:', error);
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const generateResponse = async (userMessage) => {
    try {
      setIsGenerating(true);
      
      // Use standardized traits directly
      const mappedTraits = {
        energy_level: editedCoach.communication_traits?.energy_level ?? 5,
        directness: editedCoach.communication_traits?.directness ?? 5,
        formality: editedCoach.communication_traits?.formality ?? 3,
        emotion_focus: editedCoach.communication_traits?.emotion_focus ?? 5,
      };

      const response = await fetch(`${import.meta.env.VITE_API_URL}/coach-response-generator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Send a snapshot so unsaved slider changes affect the prompt immediately
          coachSnapshot: {
            name: editedCoach.name || coach?.name || 'Sample Coach',
            handle: editedCoach.handle || coach?.handle || undefined,
            description: editedCoach.description || coach?.description || undefined,
            primary_response_style: editedCoach.primary_response_style || coach?.primary_response_style || 'empathetic_mirror',
            communication_traits: mappedTraits,
            // Optionally extend: voice_patterns/catchphrases when those are editable here
          },
          userMessage: userMessage,
          userContext: {
            previousMessages: conversation.slice(-5) // Last 5 messages for context
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate response');
      }

      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error('Error generating response:', error);
      toast.error('Failed to get response from coach');
      return "I'm having trouble responding right now. Please try again!";
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendMessage = async (message) => {
    if (!message.trim() || isGenerating) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: message,
      timestamp: new Date()
    };

    setConversation(prev => [...prev, userMessage]);
    setTestMessage('');

    // Generate AI response using current edited settings
    const response = await generateResponse(message);
    
    const aiMessage = {
      id: Date.now() + 1,
      type: 'ai',
      content: response,
      timestamp: new Date()
    };

    setConversation(prev => [...prev, aiMessage]);
  };

  const clearConversation = () => {
    setConversation([]);
  };

  const formatTime = (timestamp) => {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading coach...</p>
        </div>
      </div>
    );
  }

  if (!coach) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Coach Not Found</h1>
        <button
          onClick={() => navigate('/my-coaches')}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
        >
          ← Back to My Coaches
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Inject custom styles */}
      <style>{sliderStyles}</style>
      
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/my-coaches')}
                className="text-gray-600 hover:text-gray-800 p-2 hover:bg-gray-100 rounded-lg"
                title="Back to My Coaches"
              >
                ←
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Edit Coach</h1>
                <p className="text-gray-600">Customize your AI coach settings and test in real-time</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate(`/my-coaches/${coachId}/content`)}
                className="bg-purple-100 text-purple-700 px-4 py-2 rounded-lg hover:bg-purple-200 font-medium flex items-center gap-2"
              >
                📁 Manage Content
              </button>
              
              {hasChanges && (
                <button
                  onClick={saveChanges}
                  disabled={saving}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Coach Settings */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Coach Settings</h2>
            
            {/* Avatar Section */}
            <div className="mb-4 text-center p-3 border border-gray-200 rounded-lg">
              {coach.avatar_url ? (
                <img
                  src={coach.avatar_url}
                  alt={`${editedCoach.name} avatar`}
                  className="w-16 h-16 object-cover rounded-full mx-auto mb-2 border-4 border-blue-500"
                />
              ) : (
                <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg mx-auto mb-2">
                  {editedCoach.name.charAt(0) || 'C'}
                </div>
              )}
              <button
                onClick={() => navigate(`/my-coaches/${coachId}/avatar`)}
                className="bg-gray-100 text-gray-700 px-3 py-1 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                Edit Avatar
              </button>
            </div>
            
            {/* Basic Info */}
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Coach Name
                </label>
                <input
                  type="text"
                  value={editedCoach.name}
                  onChange={(e) => updateCoachField('name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter coach name"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Handle
                </label>
                <input
                  type="text"
                  value={editedCoach.handle}
                  onChange={(e) => updateCoachField('handle', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter handle (without @)"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={editedCoach.description}
                  onChange={(e) => updateCoachField('description', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Describe your coach..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Response Style
                </label>
                <select
                  value={editedCoach.primary_response_style}
                  onChange={(e) => updateCoachField('primary_response_style', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select a style...</option>
                  {responseStyles.map((style) => (
                    <option key={style.value} value={style.value}>
                      {style.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            {/* Communication Traits - Compact Version */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Communication Traits</h3>
              <div className="space-y-3">
                {communicationTraits.map((trait) => (
                  <div key={trait.key} className="flex items-center justify-between">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-700">
                        {trait.label}
                      </label>
                      <p className="text-xs text-gray-500">{trait.description}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={editedCoach.communication_traits[trait.key] || 5}
                        onChange={(e) => updateCommunicationTrait(trait.key, parseInt(e.target.value))}
                        className="w-20 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <span className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded min-w-[2.5rem] text-center">
                        {editedCoach.communication_traits[trait.key] || 5}/10
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Coach Stats */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Status:</span>
                  <span className={`ml-2 font-medium ${
                    coach.active ? 'text-green-600' : 'text-gray-600'
                  }`}>
                    {coach.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Visibility:</span>
                  <span className={`ml-2 font-medium ${
                    coach.public ? 'text-blue-600' : 'text-orange-600'
                  }`}>
                    {coach.public ? 'Public' : 'Private'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Conversations:</span>
                  <span className="ml-2 font-medium">{coach.total_conversations || 0}</span>
                </div>
                <div>
                  <span className="text-gray-500">Content Files:</span>
                  <span className="ml-2 font-medium">{coach.total_content_pieces || 0}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500">Avatar:</span>
                  <span className="ml-2 font-medium">
                    {coach.avatar_url ? 'Custom avatar' : 'Default avatar'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Chat Interface */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xl font-bold text-gray-900">Test Your Coach</h2>
              {conversation.length > 0 && (
                <button
                  onClick={clearConversation}
                  className="text-sm text-gray-600 hover:text-gray-800"
                >
                  Clear Chat
                </button>
              )}
            </div>

            {hasChanges && (
              <div className="mb-3 p-2 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">
                  💡 <strong>Live Preview:</strong> Chat responses will use your current settings. Save changes to make them permanent.
                </p>
              </div>
            )}

            {/* Chat Messages */}
            <div className="h-64 overflow-y-auto mb-3 border border-gray-200 rounded-lg p-3 space-y-3">
              {conversation.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <p className="mb-2">👋 Test your AI coach with current settings!</p>
                  <p className="text-sm">Changes to settings will affect responses immediately.</p>
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
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Try these sample messages:</h3>
              <div className="flex flex-wrap gap-1">
                {sampleMessages.map((sample, index) => (
                  <button
                    key={index}
                    onClick={() => handleSendMessage(sample)}
                    disabled={isGenerating}
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded-full transition-colors disabled:opacity-50"
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
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
      </div>
    </div>
  );
};

export default CoachEdit; 