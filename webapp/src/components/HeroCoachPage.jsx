import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../main';
import { COACH_PERSONAS } from './coach-personas.js';
import { toast } from 'react-hot-toast';
// You may need to adjust the import path depending on your build setup

const COACH_IMAGES = {
  zen_master: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
  gym_bro: 'https://images.unsplash.com/photo-1517960413843-0aee8e2d471c?auto=format&fit=crop&w=800&q=80',
  dance_teacher: 'https://images.unsplash.com/photo-1519864600265-abb23847ef2c?auto=format&fit=crop&w=800&q=80',
  drill_sergeant: 'https://images.unsplash.com/photo-1503676382389-4809596d5290?auto=format&fit=crop&w=800&q=80',
  frat_bro: 'https://images.unsplash.com/photo-1464983953574-0892a716854b?auto=format&fit=crop&w=800&q=80',
  // Default image for custom coaches
  custom_default: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
};

// Placeholder foods for each coach
const COACH_FOODS = {
  zen_master: ['Avocado Toast', 'Green Tea', 'Quinoa Salad'],
  gym_bro: ['Chicken Breast', 'Protein Shake', 'Broccoli'],
  dance_teacher: ['Smoothie Bowl', 'Grilled Salmon', 'Fruit Salad'],
  drill_sergeant: ['Egg Whites', 'Oatmeal', 'Lean Beef'],
  frat_bro: ['Pizza', 'Burgers', 'Energy Drinks'],
  custom_default: ['Personalized Nutrition', 'Custom Meal Plans', 'Healthy Choices'],
};



// Chat Modal Component
const CoachChatModal = ({ coach, isOpen, onClose }) => {
  const [conversation, setConversation] = useState([]);
  const [message, setMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const generateResponse = async (userMessage) => {
    try {
      setIsGenerating(true);
      
      // Use the coach response generator for all coaches (both predefined and custom)
      const response = await fetch(`${import.meta.env.VITE_API_URL}/coach-response-generator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coachId: coach.id, // Now using UUID for all coaches
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

  const handleSendMessage = async () => {
    if (!message.trim()) return;

    const userMessage = message.trim();
    setMessage('');

    // Add user message to conversation
    const newUserMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    };

    setConversation(prev => [...prev, newUserMessage]);

    // Generate and add coach response
    const coachResponse = await generateResponse(userMessage);
    const newCoachMessage = {
      role: 'assistant',
      content: coachResponse,
      timestamp: new Date().toISOString()
    };

    setConversation(prev => [...prev, newCoachMessage]);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md h-[600px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-bold">
              {coach.name.charAt(0)}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{coach.name}</h3>
              <p className="text-sm text-gray-500">
                {coach.type === 'custom' ? `@${coach.handle}` : 'Predefined Coach'}
              </p>
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
            <div className="text-center text-gray-500 mt-8">
              <p>Start a conversation with {coach.name}!</p>
              <p className="text-sm mt-2">Ask about fitness, motivation, or anything else.</p>
            </div>
          ) : (
            conversation.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] p-3 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="text-sm">{msg.content}</p>
                </div>
              </div>
            ))
          )}
          {isGenerating && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-900 p-3 rounded-lg">
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-gray-600"></div>
                  <span className="text-sm">{coach.name} is typing...</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Message Input */}
        <div className="p-4 border-t">
          <div className="flex space-x-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={`Message ${coach.name}...`}
              className="flex-1 p-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows="2"
              disabled={isGenerating}
            />
            <button
              onClick={handleSendMessage}
              disabled={!message.trim() || isGenerating}
              className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function HeroCoachPage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [allCoaches, setAllCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAllCoaches();
  }, []);

  const fetchAllCoaches = async () => {
    try {
      // Fetch all coaches from database (both predefined and custom)
      const { data: coachData, error } = await supabase
        .from('coach_profiles')
        .select('*')
        .eq('active', true)
        .eq('public', true) // Only show public coaches
        .order('created_at', { ascending: true }); // Predefined coaches first (created earlier)

      if (error) {
        console.error('Error fetching coaches:', error);
        toast.error(`Failed to fetch coaches: ${error.message}`);
        setAllCoaches([]);
        return;
      }

      // Map all coaches to the display format
      const allCoaches = (coachData || []).map(coach => {
        // Check if this is a predefined coach by looking at the handle
        const isPredefined = ['zen_master', 'gym_bro', 'dance_teacher', 'drill_sergeant', 'frat_bro'].includes(coach.handle);
        
        return {
          id: coach.id, // Now using the UUID from database
          type: isPredefined ? 'predefined' : 'custom',
          name: coach.name,
          description: coach.description || 'A custom AI coach tailored for personalized guidance',
          traits: [
            `Primary style: ${coach.primary_response_style?.replace('_', ' ')}`,
            coach.secondary_response_style ? `Secondary style: ${coach.secondary_response_style?.replace('_', ' ')}` : null,
            `Energy level: ${coach.communication_traits?.energy_level || 5}/10`,
            `Directness: ${coach.communication_traits?.directness || 5}/10`,
            `Conversations: ${coach.total_conversations || 0}`
          ].filter(Boolean),
          activities: isPredefined 
            ? (COACH_PERSONAS[coach.handle]?.activities || ['Fitness coaching', 'Motivation', 'Wellness guidance'])
            : ['Custom coaching', 'Personalized motivation', 'AI-powered guidance'],
          // Use avatar_url if available, otherwise fallback to predefined or default image
          image: coach.avatar_url || 
                  (isPredefined && COACH_IMAGES[coach.handle] ? COACH_IMAGES[coach.handle] : COACH_IMAGES.custom_default),
          foods: isPredefined && COACH_FOODS[coach.handle] 
            ? COACH_FOODS[coach.handle] 
            : COACH_FOODS.custom_default,
          handle: coach.handle,
          // Include the full coach data for response generation
          coachData: coach
        };
      });

      setAllCoaches(allCoaches);
    } catch (error) {
      console.error('Error fetching coaches:', error);
      toast.error('Failed to load coaches');
      setAllCoaches([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? allCoaches.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % allCoaches.length);
  };

  const openChat = () => {
    setChatModalOpen(true);
  };

  const closeChat = () => {
    setChatModalOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading coaches...</p>
        </div>
      </div>
    );
  }

  if (allCoaches.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <p className="text-white text-xl mb-4">No coaches available</p>
          <button
            onClick={() => navigate(-1)}
            className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-full"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  const currentCoach = allCoaches[currentIndex];

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-black overflow-hidden">
      <img
        src={currentCoach.image}
        alt={currentCoach.name}
        className="absolute inset-0 w-full h-full object-cover object-center z-0"
        style={{ filter: 'brightness(0.6)' }}
      />
      
      {/* Back button in top-right */}
      <div className="absolute top-8 right-8 z-30">
        <button
          onClick={() => navigate(-1)}
          className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-full shadow-lg text-lg hover:scale-105 transition-transform duration-200 border-4 border-white/30 backdrop-blur-md"
          style={{ boxShadow: '0 4px 32px 0 rgba(80, 0, 120, 0.25)' }}
        >
          ← Back
        </button>
      </div>

      {/* Chat button in top-left */}
      <div className="absolute top-8 left-8 z-30">
        <button
          onClick={openChat}
          className="bg-gradient-to-r from-green-500 to-blue-500 text-white font-bold py-3 px-6 rounded-full shadow-lg text-lg hover:scale-105 transition-transform duration-200 border-4 border-white/30 backdrop-blur-md"
          style={{ boxShadow: '0 4px 32px 0 rgba(0, 120, 80, 0.25)' }}
        >
          💬 Chat
        </button>
      </div>

      {/* Left edge info box */}
      <div className="absolute top-1/2 left-0 transform -translate-y-1/2 ml-2 md:ml-8 z-10 max-w-xs w-[90vw] md:w-80">
        <div className="bg-gray-900 bg-opacity-80 rounded-lg shadow-lg p-4 text-white mb-4">
          <h2 className="font-semibold text-xl mb-2">Characteristics</h2>
          <ul className="list-disc list-inside text-base">
            {currentCoach.traits.map((trait, i) => (
              <li key={i}>{trait}</li>
            ))}
          </ul>
        </div>
        <div className="bg-gray-900 bg-opacity-80 rounded-lg shadow-lg p-4 text-white">
          <h2 className="font-semibold text-xl mb-2">Favorite Foods</h2>
          <ul className="list-disc list-inside text-base">
            {currentCoach.foods.map((food, i) => (
              <li key={i}>{food}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right edge info box */}
      <div className="absolute top-1/2 right-0 transform -translate-y-1/2 mr-2 md:mr-8 z-10 max-w-xs w-[90vw] md:w-80">
        <div className="bg-gray-900 bg-opacity-80 rounded-lg shadow-lg p-4 text-white">
          <h2 className="font-semibold text-xl mb-2">Pursuits</h2>
          <ul className="list-disc list-inside text-base">
            {currentCoach.activities.map((activity, i) => (
              <li key={i}>{activity}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Coach name and description at the bottom */}
      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-full z-20 flex flex-col items-center pb-8">
        <div className="flex items-center mb-2">
          <h1 className="text-5xl md:text-6xl font-extrabold text-white drop-shadow-lg text-center bg-black bg-opacity-40 px-6 py-2 rounded-lg">
            {currentCoach.name}
          </h1>
        </div>
        <p className="text-lg md:text-xl text-white text-center bg-black bg-opacity-30 px-4 py-2 rounded-lg max-w-2xl">
          {currentCoach.description}
        </p>
        <div className="flex justify-between w-full max-w-2xl mt-6 px-4">
          <button
            onClick={handlePrev}
            className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
          >
            ← Prev
          </button>
          <div className="flex items-center space-x-2">
            <span className="text-white text-sm">
              {currentIndex + 1} of {allCoaches.length}
            </span>
          </div>
          <button
            onClick={handleNext}
            className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Chat Modal */}
      <CoachChatModal
        coach={currentCoach}
        isOpen={chatModalOpen}
        onClose={closeChat}
      />
    </div>
  );
} 