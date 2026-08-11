import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../main';
import { toast } from 'react-hot-toast';
import { isMobile } from '../constants';

// Art bundled with the original SMS product. It is only a fallback now, keyed
// on handle: a coach that has its own avatar_url always wins.
import zenMasterImg from '../assets/coach_pics/zen_master.png';
import gymBroImg from '../assets/coach_pics/gym_bro.png';
import danceTeacherImg from '../assets/coach_pics/dance_teacher.png';
import drillSergeantImg from '../assets/coach_pics/drill_sergeant.png';
import fratBroImg from '../assets/coach_pics/frat_bro.png';

const BUNDLED_AVATARS = {
  zen_master: zenMasterImg,
  gym_bro: gymBroImg,
  dance_teacher: danceTeacherImg,
  drill_sergeant: drillSergeantImg,
  frat_bro: fratBroImg,
};

const DEFAULT_AVATAR =
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80';

/** Deterministic accent per vertical, mirroring the mobile roster. */
const CATEGORY_TINTS = {
  fitness: '#FF6B4A',
  movement: '#4AC6FF',
  music: '#B36BFF',
  creative: '#FFB43D',
  wellness: '#3FBF7F',
  nutrition: '#8FD44A',
  business: '#5C7CFF',
  academic: '#FF7FA8',
  lifestyle: '#FFD24A',
  other: '#9A9AA8',
};

const PAGE_SIZE = 20;

const tintForCategory = (slug) => CATEGORY_TINTS[slug] || CATEGORY_TINTS.other;

const imageForCoach = (coach) =>
  coach.avatar_url || BUNDLED_AVATARS[coach.handle] || coach.cover_image_url || DEFAULT_AVATAR;

const formatPrice = (cents, currency = 'USD') => {
  if (cents == null) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
};

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

  const sendMessage = async (text) => {
    const userMessage = (text || '').trim();
    if (!userMessage) return;

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
      sendMessage(message);
    }
  };

  if (!isOpen) return null;

  const starters = (coach.starter_prompts || []).slice(0, 3);

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
                {coach.discipline || coach.category_label || `@${coach.handle}`}
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
              <p>{coach.intro_message || `Start a conversation with ${coach.name}!`}</p>
              {starters.length > 0 && (
                <div className="mt-4 space-y-2">
                  {starters.map((prompt, index) => (
                    <button
                      key={index}
                      onClick={() => sendMessage(prompt)}
                      disabled={isGenerating}
                      className="block w-full text-left text-sm px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-400 text-gray-700 disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
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
              onClick={() => sendMessage(message)}
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
  const [coaches, setCoaches] = useState([]);
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState(null);
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [showMobileInfo, setShowMobileInfo] = useState(false);
  const navigate = useNavigate();

  // Guards against an older in-flight query overwriting a newer one when the
  // user types quickly or flips categories mid-request.
  const requestId = useRef(0);

  useEffect(() => {
    supabase
      .from('coach_categories')
      .select('slug, label, emoji, sort_order')
      .eq('active', true)
      .order('sort_order')
      .then(({ data, error: categoryError }) => {
        if (categoryError) {
          console.warn('Could not load categories:', categoryError.message);
          return;
        }
        setCategories(data || []);
      });
  }, []);

  // Debounce the search box so every keystroke is not a round trip.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadRoster = useCallback(async (mode) => {
    const id = ++requestId.current;
    const offset = mode === 'more' ? coaches.length : 0;

    if (mode !== 'more') setLoading(true);

    try {
      const { data, error: rosterError } = await supabase.rpc('get_coach_roster', {
        p_category: category,
        p_search: search.trim() ? search.trim() : null,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      });

      if (rosterError) throw rosterError;
      if (id !== requestId.current) return;

      const page = data || [];
      setCoaches(prev => (mode === 'more' ? [...prev, ...page] : page));
      setExhausted(page.length < PAGE_SIZE);
      if (mode !== 'more') setCurrentIndex(0);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      console.error('Error fetching coaches:', err);
      setError(err?.message || 'Could not load the roster');
      if (mode !== 'more') setCoaches([]);
      toast.error(`Failed to fetch coaches: ${err?.message || 'unknown error'}`);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [category, search, coaches.length]);

  useEffect(() => {
    loadRoster('initial');
    // loadRoster closes over coaches.length, which would re-trigger every page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, search]);

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? coaches.length - 1 : prev - 1));
  };

  const handleNext = () => {
    const next = (currentIndex + 1) % coaches.length;
    // Reaching the end of the loaded page pulls the next one in.
    if (currentIndex === coaches.length - 1 && !exhausted) {
      loadRoster('more');
      setCurrentIndex(currentIndex + 1);
      return;
    }
    setCurrentIndex(next);
  };

  const currentCoach = coaches[Math.min(currentIndex, Math.max(coaches.length - 1, 0))];

  const filters = useMemo(() => {
    if (categories.length === 0) return null;
    return (
      <div className="flex gap-2 overflow-x-auto pb-1 max-w-full">
        <button
          onClick={() => setCategory(null)}
          className={`whitespace-nowrap px-3 py-1 rounded-full text-sm border ${
            category === null
              ? 'bg-white text-black border-white'
              : 'bg-black/50 text-white border-white/30'
          }`}
        >
          All
        </button>
        {categories.map((entry) => (
          <button
            key={entry.slug}
            onClick={() => setCategory(entry.slug)}
            className={`whitespace-nowrap px-3 py-1 rounded-full text-sm border ${
              category === entry.slug
                ? 'bg-white text-black border-white'
                : 'bg-black/50 text-white border-white/30'
            }`}
          >
            {entry.emoji ? `${entry.emoji} ` : ''}{entry.label}
          </button>
        ))}
      </div>
    );
  }, [categories, category]);

  const controls = (
    <div
      className={`absolute z-30 left-1/2 -translate-x-1/2 w-full px-4 flex flex-col items-center gap-2 ${
        isMobile ? 'top-16 max-w-md' : 'top-8 max-w-3xl'
      }`}
    >
      <input
        type="search"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search coaches, disciplines, skills"
        className="w-full px-4 py-2 rounded-full bg-black/60 text-white placeholder-white/60 border border-white/30 backdrop-blur-md focus:outline-none focus:border-white"
      />
      {filters}
    </div>
  );

  if (loading && coaches.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading coaches...</p>
        </div>
      </div>
    );
  }

  if (!currentCoach) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-black px-4">
        {controls}
        <div className="text-center">
          <p className="text-white text-xl mb-4">
            {error
              ? error
              : search || category
                ? 'Nothing matches that. Try a different search or category.'
                : 'No coaches are listed yet'}
          </p>
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

  const tint = tintForCategory(currentCoach.category_slug);
  const price = formatPrice(currentCoach.price_cents, currentCoach.currency);
  const expertise = currentCoach.expertise || [];
  const starterPrompts = currentCoach.starter_prompts || [];

  // What this coach *is* — the same facts the mobile card leads with.
  const facts = [
    currentCoach.category_label
      ? `${currentCoach.category_emoji ? `${currentCoach.category_emoji} ` : ''}${currentCoach.category_label}`
      : null,
    currentCoach.creator_name ? `by ${currentCoach.creator_name}` : null,
    currentCoach.subscriber_count > 0
      ? `${currentCoach.subscriber_count.toLocaleString()} subscriber${currentCoach.subscriber_count === 1 ? '' : 's'}`
      : null,
    price ? `${price}/${currentCoach.period === 'yearly' ? 'yr' : 'mo'}` : null,
  ].filter(Boolean);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-black overflow-hidden">
      <img
        src={imageForCoach(currentCoach)}
        alt={currentCoach.name}
        className="absolute inset-0 w-full h-full object-cover object-center z-0"
        style={{ filter: 'brightness(0.6)' }}
      />

      {/* Back button in top-right */}
      <div className={`absolute z-30 ${isMobile ? 'top-4 right-4' : 'top-8 right-8'}`}>
        <button
          onClick={() => navigate(-1)}
          className={`bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-bold rounded-full shadow-lg hover:scale-105 transition-transform duration-200 border-4 border-white/30 backdrop-blur-md ${isMobile ? 'py-2 px-4 text-sm' : 'py-3 px-6 text-lg'}`}
          style={{ boxShadow: '0 4px 32px 0 rgba(80, 0, 120, 0.25)' }}
        >
          {isMobile ? 'Back' : '← Back'}
        </button>
      </div>

      {/* Chat button in top-left */}
      <div className={`absolute z-30 ${isMobile ? 'top-4 left-4' : 'top-8 left-8'}`}>
        <button
          onClick={() => setChatModalOpen(true)}
          className={`bg-gradient-to-r from-green-500 to-blue-500 text-white font-bold rounded-full shadow-lg hover:scale-105 transition-transform duration-200 border-4 border-white/30 backdrop-blur-md ${isMobile ? 'py-2 px-4 text-sm' : 'py-3 px-6 text-lg'}`}
          style={{ boxShadow: '0 4px 32px 0 rgba(0, 120, 80, 0.25)' }}
        >
          Chat
        </button>
      </div>

      {/* Search + category filter */}
      {controls}

      {/* Desktop: Left edge info box */}
      {!isMobile && (
        <div className="absolute top-1/2 left-0 transform -translate-y-1/2 ml-8 z-10 max-w-xs w-80">
          <div className="bg-gray-900 bg-opacity-80 rounded-lg shadow-lg p-4 text-white">
            <h2 className="font-semibold text-xl mb-2">About</h2>
            <p className="text-base font-semibold mb-2" style={{ color: tint }}>
              {currentCoach.discipline || currentCoach.category_label || 'Coach'}
            </p>
            <ul className="list-disc list-inside text-base">
              {facts.map((fact, i) => (
                <li key={i}>{fact}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Desktop: Right edge info box */}
      {!isMobile && expertise.length > 0 && (
        <div className="absolute top-1/2 right-0 transform -translate-y-1/2 mr-8 z-10 max-w-xs w-80">
          <div className="bg-gray-900 bg-opacity-80 rounded-lg shadow-lg p-4 text-white">
            <h2 className="font-semibold text-xl mb-2">Helps with</h2>
            <ul className="list-disc list-inside text-base">
              {expertise.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Mobile: Info toggle button */}
      {isMobile && (
        <button
          onClick={() => setShowMobileInfo(!showMobileInfo)}
          className="absolute top-36 left-1/2 transform -translate-x-1/2 z-30 bg-gray-900 bg-opacity-70 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg"
        >
          {showMobileInfo ? 'Hide Info' : 'Show Info'}
        </button>
      )}

      {/* Mobile: Collapsible info panel at bottom */}
      {isMobile && showMobileInfo && (
        <div className="absolute bottom-44 left-0 right-0 z-25 px-4 max-h-[40vh] overflow-y-auto">
          <div className="bg-gray-900 bg-opacity-90 rounded-lg shadow-lg p-3 text-white space-y-3">
            <div>
              <h3 className="font-semibold text-sm mb-1">About</h3>
              <p className="text-xs font-semibold mb-1" style={{ color: tint }}>
                {currentCoach.discipline || currentCoach.category_label || 'Coach'}
              </p>
              <ul className="list-disc list-inside text-xs space-y-0.5">
                {facts.map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
            </div>
            {expertise.length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-1">Helps with</h3>
                <ul className="list-disc list-inside text-xs space-y-0.5">
                  {expertise.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {starterPrompts.length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-1">Ask about</h3>
                <ul className="list-disc list-inside text-xs space-y-0.5">
                  {starterPrompts.map((prompt, i) => (
                    <li key={i}>{prompt}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Coach name and description at the bottom */}
      <div className={`absolute bottom-0 left-1/2 transform -translate-x-1/2 w-full z-20 flex flex-col items-center ${isMobile ? 'pb-4 px-2' : 'pb-8'}`}>
        <div className="flex items-center mb-2">
          <h1 className={`font-extrabold text-white drop-shadow-lg text-center bg-black bg-opacity-40 rounded-lg ${isMobile ? 'text-3xl px-4 py-1' : 'text-5xl md:text-6xl px-6 py-2'}`}>
            {currentCoach.name}
          </h1>
        </div>
        {/* The discipline is the whole point — it is what makes a drummer
            legible next to a yoga instructor. */}
        <p
          className={`font-semibold text-center bg-black bg-opacity-40 rounded-lg mb-1 ${isMobile ? 'text-sm px-3 py-1' : 'text-xl px-4 py-1'}`}
          style={{ color: tint }}
        >
          {currentCoach.discipline || currentCoach.category_label || 'Coach'}
        </p>
        {currentCoach.tagline && (
          <p className={`text-white text-center bg-black bg-opacity-30 rounded-lg max-w-2xl mb-1 ${isMobile ? 'text-sm px-3 py-1' : 'text-lg px-4 py-1'}`}>
            {currentCoach.tagline}
          </p>
        )}
        {currentCoach.description && (
          <p className={`text-white text-center bg-black bg-opacity-30 rounded-lg max-w-2xl ${isMobile ? 'text-xs px-3 py-1' : 'text-base md:text-lg px-4 py-2'}`}>
            {currentCoach.description}
          </p>
        )}
        <div className={`flex justify-between w-full max-w-2xl px-4 ${isMobile ? 'mt-3' : 'mt-6'}`}>
          <button
            onClick={handlePrev}
            className={`bg-gray-800 hover:bg-gray-700 text-white font-bold rounded ${isMobile ? 'py-1.5 px-3 text-sm' : 'py-2 px-4'}`}
          >
            {isMobile ? 'Prev' : '← Prev'}
          </button>
          <div className="flex items-center space-x-2">
            <span className={`text-white ${isMobile ? 'text-xs' : 'text-sm'}`}>
              {currentIndex + 1} of {coaches.length}{exhausted ? '' : '+'}
            </span>
          </div>
          <button
            onClick={handleNext}
            className={`bg-gray-800 hover:bg-gray-700 text-white font-bold rounded ${isMobile ? 'py-1.5 px-3 text-sm' : 'py-2 px-4'}`}
          >
            {isMobile ? 'Next' : 'Next →'}
          </button>
        </div>
      </div>

      {/* Chat Modal - mount only when open to reset state on close */}
      {chatModalOpen && (
        <CoachChatModal
          key={currentCoach.id}
          coach={currentCoach}
          isOpen={true}
          onClose={() => setChatModalOpen(false)}
        />
      )}
    </div>
  );
}
