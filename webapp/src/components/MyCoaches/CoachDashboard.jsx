import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../main';
import { toast } from 'react-hot-toast';

// Chat Modal Component
const CoachChatModal = ({ coach, isOpen, onClose }) => {
  const [conversation, setConversation] = useState([]);
  const [message, setMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const generateResponse = async (userMessage) => {
    try {
      setIsGenerating(true);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/coach-response-generator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coachId: coach.id,
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

  const handleSendMessage = async (messageText) => {
    if (!messageText.trim() || isGenerating) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: messageText,
      timestamp: new Date().toISOString()
    };

    setConversation(prev => [...prev, userMessage]);
    setMessage('');

    // Generate AI response
    const aiResponse = await generateResponse(messageText);
    
    const coachMessage = {
      id: Date.now() + 1,
      type: 'coach',
      content: aiResponse,
      timestamp: new Date().toISOString()
    };

    setConversation(prev => [...prev, coachMessage]);
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl h-[600px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
              {coach.name.charAt(0)}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{coach.name}</h3>
              <p className="text-sm text-gray-600">@{coach.handle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
          >
            ×
          </button>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {conversation.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <p className="mb-2">👋 Start a conversation with {coach.name}!</p>
              <p className="text-sm">Ask about motivation, workout advice, or share your progress.</p>
            </div>
          ) : (
            conversation.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                    msg.type === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="text-sm">{msg.content}</p>
                  <p className={`text-xs mt-1 ${
                    msg.type === 'user' ? 'text-blue-100' : 'text-gray-500'
                  }`}>
                    {formatTime(msg.timestamp)}
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

        {/* Message Input */}
        <div className="p-4 border-t">
          <div className="flex space-x-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Message ${coach.name}...`}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !isGenerating) {
                  handleSendMessage(message);
                }
              }}
              disabled={isGenerating}
            />
            <button
              onClick={() => handleSendMessage(message)}
              disabled={!message.trim() || isGenerating}
              className={`px-4 py-2 rounded-lg font-medium ${
                message.trim() && !isGenerating
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
  );
};

const CoachDashboard = () => {
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [selectedCoach, setSelectedCoach] = useState(null);

  useEffect(() => {
    fetchCoaches();
  }, []);

  const fetchCoaches = async () => {
    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      
      if (!user) {
        setLoading(false);
        return;
      }

      setUser(user);

      // Get user's coaches
      const { data: coachData, error: coachError } = await supabase
        .from('coach_profiles')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (coachError) throw coachError;

      setCoaches(coachData || []);
    } catch (error) {
      console.error('Error fetching coaches:', error);
      toast.error('Failed to load your coaches');
    } finally {
      setLoading(false);
    }
  };

  const openChat = (coach) => {
    setSelectedCoach(coach);
    setChatModalOpen(true);
  };

  const closeChat = () => {
    setChatModalOpen(false);
    setSelectedCoach(null);
  };

  const togglePublicStatus = async (coach) => {
    try {
      const newPublicStatus = !coach.public;
      
      const { error } = await supabase
        .from('coach_profiles')
        .update({ public: newPublicStatus })
        .eq('id', coach.id);

      if (error) throw error;

      // Update the local state
      setCoaches(prevCoaches => 
        prevCoaches.map(c => 
          c.id === coach.id 
            ? { ...c, public: newPublicStatus }
            : c
        )
      );

      toast.success(
        newPublicStatus 
          ? `${coach.name} is now public and visible to everyone!` 
          : `${coach.name} is now private and only visible to you.`
      );
    } catch (error) {
      console.error('Error updating coach public status:', error);
      toast.error('Failed to update coach visibility');
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your coaches...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My AI Coaches</h1>
          <p className="text-gray-600 mt-2">Manage your AI coaching personalities</p>
        </div>
        <Link
          to="/coach-builder"
          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium"
        >
          + Create New Coach
        </Link>
      </div>

      {coaches.length === 0 ? (
        // Empty state
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🤖</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No AI Coaches Yet</h2>
          <p className="text-gray-600 mb-8 max-w-md mx-auto">
            Create your first AI coach to start engaging with your audience through personalized SMS messages.
          </p>
          <Link
            to="/coach-builder"
            className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 font-medium text-lg"
          >
            Create Your First Coach
          </Link>
        </div>
      ) : (
        // Coaches grid
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {coaches.map((coach) => (
            <div key={coach.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{coach.name}</h3>
                  <p className="text-sm text-gray-600">@{coach.handle}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                    coach.active 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {coach.active ? 'Active' : 'Inactive'}
                  </div>
                  <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                    coach.public 
                      ? 'bg-blue-100 text-blue-800' 
                      : 'bg-orange-100 text-orange-800'
                  }`}>
                    {coach.public ? 'Public' : 'Private'}
                  </div>
                </div>
              </div>

              {coach.description && (
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                  {coach.description}
                </p>
              )}

              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Style:</span>
                  <span className="font-medium capitalize">
                    {coach.primary_response_style?.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Conversations:</span>
                  <span className="font-medium">{coach.total_conversations || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Content:</span>
                  <span className="font-medium">
                    {coach.content_processed ? 'Processed' : 'Pending'}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => openChat(coach)}
                    className="bg-green-100 text-green-700 px-3 py-2 rounded-lg hover:bg-green-200 text-sm font-medium"
                  >
                    💬 Chat
                  </button>
                  <button className="bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200 text-sm font-medium">
                    ✏️ Edit
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => togglePublicStatus(coach)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      coach.public
                        ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    }`}
                  >
                    {coach.public ? '🔒 Make Private' : '🌍 Publish'}
                  </button>
                  <button className="bg-purple-100 text-purple-700 px-3 py-2 rounded-lg hover:bg-purple-200 text-sm font-medium">
                    📊 Analytics
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Chat Modal */}
      {selectedCoach && (
        <CoachChatModal
          coach={selectedCoach}
          isOpen={chatModalOpen}
          onClose={closeChat}
        />
      )}
    </div>
  );
};

export default CoachDashboard; 