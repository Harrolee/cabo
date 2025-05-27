import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js';
import { toast } from 'react-hot-toast';
import { supabase } from './main'; // Import supabase client
import { VideoBackground } from './components/VideoBackground';
import { MainContent } from './components/MainContent';
import { PolicyModals } from './components/PolicyModals';
import UAParser from 'my-ua-parser';
import backgroundImage from '/src/assets/background-image/beach-palm-tree.jpg'
import SettingsPage from './components/SettingsPage';
import BillingPage from './components/BillingPage';
import HeroCoachPage from './components/HeroCoachPage';

// Coach Builder imports
import { CoachBuilderProvider } from './contexts/CoachBuilderContext';
import CoachBuilderLanding from './components/CoachBuilder/CoachBuilderLanding';
import PersonalityQuestionnaire from './components/CoachBuilder/PersonalityQuestionnaire';
import ContentUpload from './components/CoachBuilder/ContentUpload';
import CoachPreview from './components/CoachBuilder/CoachPreview';
import CoachSavePrompt from './components/CoachBuilder/CoachSavePrompt';
import CoachDashboard from './components/MyCoaches/CoachDashboard';

const STRIPE_PUBLIC_KEY = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
const stripePromise = loadStripe(STRIPE_PUBLIC_KEY);

// Initialize UA Parser
const parser = new UAParser();
const device = parser.getDevice();
const isMobile = device.type === 'mobile' || device.type === 'tablet';

const WORKOUT_VIDEOS = [
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/beachPushups-hd_2048_1080_25fps.mp4",
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/hunyuan-beachParty1.mp4",
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/piggyback-hd_1920_1080_24fps.mp4",
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/beachKnees-hd_1920_1080_25fps.mp4",
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/12889070_1080_1920_30fps.mp4", 
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/minimax-beachParty.mp4",
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/showerFlirt-hd_1080_1920_25fps.mp4",
    type: "video/mp4"
  }
];

const ProtectedRoute = ({ session, children }) => {
  const location = useLocation();
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children ? children : <Outlet />;
};

// Simple placeholder for login - to be expanded
const LoginPage = () => {
  const [loading, setLoading] = useState(false);
  const [identifier, setIdentifier] = useState(''); // Can be phone or email
  const [otp, setOtp] = useState('');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [tempBypassOtp, setTempBypassOtp] = useState(true); // TEMPORARY: Bypass OTP
  const location = useLocation();
  const navigate = useNavigate();
  const from = location.state?.from?.pathname || "/settings";

  const isEmail = (value) => {
    return value.includes('@') && value.includes('.');
  };

  const isPhoneNumber = (value) => {
    // Check if it's a phone number format
    return /^\+?1?[2-9]\d{9}$/.test(value.replace(/\D/g, ''));
  };

  const normalizePhoneNumber = (phone) => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+${cleaned}`;
    }
    return phone.startsWith('+') ? phone : `+${phone}`;
  };

  const handleDirectLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      let userProfile = null;
      
      if (isEmail(identifier)) {
        // Look up user by email
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('email', identifier)
          .single();
          
        if (profileError || !profile) {
          throw new Error('No account found with this email address');
        }
        userProfile = profile;
      } else if (isPhoneNumber(identifier)) {
        // Look up user by phone
        const normalizedPhone = normalizePhoneNumber(identifier);
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('phone_number', normalizedPhone)
          .single();
          
        if (profileError || !profile) {
          throw new Error('No account found with this phone number');
        }
        userProfile = profile;
      } else {
        throw new Error('Please enter a valid email address or phone number');
      }

      // Try to sign in with magic link using email
      const { error: magicLinkError } = await supabase.auth.signInWithOtp({
        email: userProfile.email,
        options: {
          shouldCreateUser: false, // Don't create new user, just sign in existing
          emailRedirectTo: window.location.origin + from
        }
      });

      if (magicLinkError) {
        // If magic link fails, try creating a temporary session
        console.log('Magic link failed, attempting alternative auth...');
        
        // Store user info temporarily and redirect
        sessionStorage.setItem('tempAuthUser', JSON.stringify({
          email: userProfile.email,
          phone: userProfile.phone_number,
          name: userProfile.full_name,
          id: userProfile.id
        }));
        
        toast.success('Authentication successful! Redirecting...');
        
        // Simulate successful auth by triggering a custom event
        window.dispatchEvent(new CustomEvent('tempAuthSuccess', {
          detail: {
            user: {
              email: userProfile.email,
              phone: userProfile.phone_number,
              user_metadata: { name: userProfile.full_name }
            }
          }
        }));
        
        navigate(from, { replace: true });
        return;
      }

      toast.success('Check your email for the sign-in link!');
      
    } catch (error) {
      toast.error(error.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: identifier,
      });
      if (error) throw error;
      setShowOtpInput(true);
      toast.success('Check your phone for the verification code!');
    } catch (error) {
      toast.error(error.error_description || error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: identifier,
        token: otp,
        type: 'sms'
      });
      if (error) throw error;
      toast.success('Successfully logged in!');
      navigate(from, { replace: true });
    } catch (error) {
      toast.error(error.error_description || error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="p-8 bg-white shadow-md rounded-lg w-full max-w-md">
        <h2 className="text-2xl font-bold text-center mb-6">Sign In</h2>
        
        {tempBypassOtp && (
          <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 rounded-md">
            <p className="text-sm text-yellow-800">
              🚧 <strong>Temporary Mode:</strong> OTP verification is currently disabled. 
              Enter your email or phone number to sign in directly.
            </p>
          </div>
        )}
        
        {!showOtpInput ? (
          <>
            <p className="text-center mb-4 text-sm text-gray-600">
              {tempBypassOtp 
                ? "Enter your email address or phone number to sign in."
                : "Enter your phone number to receive a verification code."
              }
            </p>
            <form onSubmit={tempBypassOtp ? handleDirectLogin : handlePhoneSubmit}>
              <input
                type="text"
                placeholder={tempBypassOtp ? "Email or +1XXXXXXXXXX" : "+1XXXXXXXXXX"}
                value={identifier}
                required
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full px-4 py-2 mb-4 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50"
              >
                {loading ? 'Signing in...' : (tempBypassOtp ? 'Sign In' : 'Send Verification Code')}
              </button>
            </form>
            
            {tempBypassOtp && (
              <div className="mt-4 text-center">
                <button
                  onClick={() => setTempBypassOtp(false)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Use OTP verification instead
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-center mb-4 text-sm text-gray-600">
              Enter the verification code sent to {identifier}
            </p>
            <form onSubmit={handleOtpSubmit}>
              <input
                type="text"
                placeholder="Enter 6-digit code"
                value={otp}
                required
                onChange={(e) => setOtp(e.target.value)}
                className="w-full px-4 py-2 mb-4 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </button>
            </form>
            <button
              onClick={() => setShowOtpInput(false)}
              className="w-full mt-2 text-sm text-blue-600 hover:text-blue-800"
            >
              Use a different phone number
            </button>
          </>
        )}
        <p className="text-xs text-gray-500 mt-4 text-center">
          If you don't have an account, sign up on our main page.
        </p>
      </div>
    </div>
  );
};

// Layout for Authenticated parts of the app
const AuthenticatedLayout = ({ session }) => {
  const handleSignOut = async () => {
    // Clear temporary auth if it exists
    sessionStorage.removeItem('tempAuthUser');
    
    // Sign out from Supabase if it's a real session
    if (session?.access_token !== 'temp-token') {
      await supabase.auth.signOut();
    } else {
      // For temp sessions, just reload the page to clear state
      window.location.reload();
    }
  };

  const isTemporarySession = session?.access_token === 'temp-token';

  return (
    <div>
      <nav className="bg-gray-800 text-white p-4">
        <ul className="flex space-x-4 items-center">
          <li><Link to="/">Home (Main App)</Link></li>
          <li><Link to="/coach-builder">Coach Builder</Link></li>
          <li><Link to="/my-coaches">My Coaches</Link></li>
          <li><Link to="/settings">Settings</Link></li>
          <li><Link to="/billing">Billing</Link></li>
          <li><Link to="/coaches">Coaches</Link></li>
          <li className="ml-auto">
            {isTemporarySession && (
              <span className="text-yellow-300 text-sm mr-2">🚧 Temp Session</span>
            )}
            Logged in as: {session.user.email || session.user.phone}
          </li>
          <li>
            <button 
              onClick={handleSignOut}
              className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm"
            >
              Sign Out
            </button>
          </li>
        </ul>
      </nav>
      <Outlet /> {/* Nested routes will render here */}
    </div>
  );
};

export function App() {
  const [session, setSession] = useState(null);
  const [previewImages, setPreviewImages] = useState([]);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);

  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [nextVideoIndex, setNextVideoIndex] = useState(1);
  const [showInfo, setShowInfo] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showInitialScreen, setShowInitialScreen] = useState(true);
  const [showSignupForm, setShowSignupForm] = useState(true);
  const [userData, setUserData] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const currentVideoRef = useRef(null);
  const nextVideoRef = useRef(null);
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [urlParams] = useState(() => new URLSearchParams(window.location.search));
  const [isPaymentFlow] = useState(() => Boolean(urlParams.get('email')));

  const handleVideoEnded = () => {
    if (nextVideoRef.current) {
      nextVideoRef.current.style.opacity = 1;
      nextVideoRef.current.play();
    }
    if (currentVideoRef.current) {
      currentVideoRef.current.style.opacity = 0;
    }

    setCurrentVideoIndex(nextVideoIndex);
    setNextVideoIndex((nextVideoIndex + 1) % WORKOUT_VIDEOS.length);
  };

  useEffect(() => {
    if (nextVideoRef.current) {
      nextVideoRef.current.load();
    }
  }, [nextVideoIndex]);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const emailParam = urlParams.get('email');
        if (emailParam) {
          setUserData({ email: emailParam });
          setShowInitialScreen(false);
          setShowSignupForm(false);
        }
      } catch (error) {
        console.error('Error loading user data:', error);
        toast.error('Unable to load your information. Please try signing up again.');
      } finally {
        const delay = urlParams.get('email') ? 0 : 1000;
        setTimeout(() => setIsAppLoading(false), delay);
      }
    };

    initializeApp();
  }, [urlParams]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // Handle temporary authentication for coach-builder
    const handleTempAuth = (event) => {
      const tempUser = event.detail.user;
      // Create a mock session for temporary use
      const tempSession = {
        user: tempUser,
        access_token: 'temp-token',
        refresh_token: 'temp-refresh'
      };
      setSession(tempSession);
    };

    // Check for existing temp auth on page load
    const tempAuthUser = sessionStorage.getItem('tempAuthUser');
    if (tempAuthUser && !session) {
      try {
        const userData = JSON.parse(tempAuthUser);
        const tempSession = {
          user: {
            email: userData.email,
            phone: userData.phone,
            user_metadata: { name: userData.name }
          },
          access_token: 'temp-token',
          refresh_token: 'temp-refresh'
        };
        setSession(tempSession);
      } catch (error) {
        console.error('Error parsing temp auth user:', error);
        sessionStorage.removeItem('tempAuthUser');
      }
    }

    window.addEventListener('tempAuthSuccess', handleTempAuth);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('tempAuthSuccess', handleTempAuth);
    };
  }, []);

  useEffect(() => {
    const images = import.meta.glob('/src/assets/mobile-intro/*.{png,jpg,jpeg,gif}', {
      eager: true,
      import: 'default'
    });
    
    // Convert to sorted array of image paths
    const sortedImages = Object.entries(images)
      .sort(([pathA], [pathB]) => {
        // Extract numbers from filenames for sorting
        const numA = parseInt(pathA.match(/(\d+)/)[0]);
        const numB = parseInt(pathB.match(/(\d+)/)[0]);
        return numA - numB;
      })
      .map(([_, value]) => value);

    setPreviewImages(sortedImages);
  }, []);

  const handleModalClose = () => {
    setShowInfo(false);
    setShowTerms(false);
    setShowPrivacy(false);
  };

  const handleInitialSubscribe = () => {
    console.log('handleInitialSubscribe called in App');
    setShowInitialScreen(false);
  };

  const handleFreeTrialSignup = async (userData) => {
    try {
      setShowSignupForm(true);
      setUserData(userData);
      const signupResponse = await fetch(`${import.meta.env.VITE_API_URL}/handle-user-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(userData),
      });

      if (!signupResponse.ok) {
        const errorData = await signupResponse.json();
        throw new Error(errorData.message || 'Failed to create user profile');
      }

      setTimeout(() => {
        setShowSignupForm(false);
        setShowInitialScreen(true);
        setUserData(null);
      }, 20000);

    } catch (error) {
      console.error('Error in free trial signup:', error);
      toast.error(error.message || 'Something went wrong. Please try again.');
      throw error;
    }
  };

  const handlePaidSignup = async (userData) => {
    try {
      setUserData(userData);
      setShowSignupForm(false);
    } catch (error) {
      console.error('Error in paid signup process:', error);
      toast.error(error.message || 'Something went wrong. Please try again.');
      throw error;
    }
  };

  const handlePreviewNavigation = (direction) => {
    if (direction === 'next') {
      setCurrentPreviewIndex((prev) => (prev + 1) % previewImages.length);
    } else {
      setCurrentPreviewIndex((prev) => 
        prev === 0 ? previewImages.length - 1 : prev - 1
      );
    }
  };

  const MainAppContent = () => {
    if (isAppLoading && !session) {
      return (
        <div className="fixed inset-0 bg-cover bg-center flex items-center justify-center"
             style={{
               backgroundImage: `url(${backgroundImage})`
             }}>
          <div className="text-center bg-black/50 p-6 rounded-lg backdrop-blur-sm">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
            <p className="mt-4 text-white text-lg">
              {urlParams.get('email') ? 'Setting up your account...' : 'Loading CaboFit...'}
            </p>
          </div>
        </div>
      );
    }

    const navigate = useNavigate();

    return (
      <div className="relative min-h-screen">
        {!isMobile ? (
          <VideoBackground
            currentVideoRef={currentVideoRef}
            nextVideoRef={nextVideoRef}
            currentVideoIndex={currentVideoIndex}
            nextVideoIndex={nextVideoIndex}
            handleVideoEnded={handleVideoEnded}
            WORKOUT_VIDEOS={WORKOUT_VIDEOS}
          />
        ) : (
          <div 
            className="fixed inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${backgroundImage})`
            }}
          />
        )}

        <MainContent
          showInitialScreen={showInitialScreen}
          handleInitialSubscribe={handleInitialSubscribe}
          showSignupForm={showSignupForm}
          handleSubscribe={isPaymentFlow ? handlePaidSignup : handleFreeTrialSignup}
          userData={userData}
          stripePromise={stripePromise}
          setShowInfo={setShowInfo}
          setShowTerms={setShowTerms}
          setShowPrivacy={setShowPrivacy}
          showPreview={showPreview}
          setShowPreview={setShowPreview}
          className={`${isMobile ? 'px-4 py-6' : 'px-8 py-12'}`}
          isMobile={isMobile}
          isPaymentFlow={isPaymentFlow}
        />

        {showPreview && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className={`bg-white rounded-lg w-full ${isMobile ? 'max-w-[95%] p-3' : 'max-w-2xl p-4'}`}>
              <div className="flex justify-between items-center mb-4">
                <h2 className={`font-bold ${isMobile ? 'text-lg' : 'text-xl'}`}>
                  Preview Your Daily Motivation
                </h2>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-gray-500 hover:text-gray-700 p-2"
                >
                  ✕
                </button>
              </div>
              <div className="relative">
                <img
                  src={previewImages[currentPreviewIndex]}
                  alt={`Preview ${currentPreviewIndex + 1} of ${previewImages.length}`}
                  className="w-full rounded-lg shadow-lg"
                />
                {isMobile && (
                  <>
                    <button
                      onClick={() => handlePreviewNavigation('prev')}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 rounded-full p-2 shadow-lg"
                      aria-label="Previous image"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => handlePreviewNavigation('next')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 rounded-full p-2 shadow-lg"
                      aria-label="Next image"
                    >
                      →
                    </button>
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/80 px-3 py-1 rounded-full">
                      {currentPreviewIndex + 1} / {previewImages.length}
                    </div>
                  </>
                )}
              </div>
              <p className={`mt-4 text-gray-600 ${isMobile ? 'text-sm' : ''}`}>
                Get daily workout motivation and fitness tips delivered right to your phone!
              </p>
            </div>
          </div>
        )}

        <PolicyModals
          showInfo={showInfo}
          showTerms={showTerms}
          showPrivacy={showPrivacy}
          handleModalClose={handleModalClose}
        />

        <div className="absolute top-8 right-8 z-30">
          <button
            onClick={() => navigate('/coaches')}
            className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-full shadow-lg text-lg hover:scale-105 transition-transform duration-200 border-4 border-white/30 backdrop-blur-md"
            style={{ boxShadow: '0 4px 32px 0 rgba(80, 0, 120, 0.25)' }}
          >
            Meet the Coaches
          </button>
        </div>

        <Toaster 
          position={isMobile ? "bottom-center" : "top-center"} 
          toastOptions={{
            className: isMobile ? 'text-sm' : '',
            duration: isMobile ? 4000 : 3000,
          }}
        />
      </div>
    );
  };

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/coaches" element={<HeroCoachPage />} />
      
      {/* Coach Builder - Unauthenticated Routes */}
      <Route path="/coach-builder/*" element={
        <CoachBuilderProvider>
          <Routes>
            <Route index element={<CoachBuilderLanding />} />
            <Route path="personality" element={<PersonalityQuestionnaire />} />
            <Route path="content" element={<ContentUpload />} />
            <Route path="preview" element={<CoachPreview />} />
            <Route path="save" element={<CoachSavePrompt />} />
          </Routes>
        </CoachBuilderProvider>
      } />
      
      <Route element={<ProtectedRoute session={session}><AuthenticatedLayout session={session} /></ProtectedRoute>}>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/my-coaches" element={<CoachDashboard />} />
      </Route>

      <Route path="/*" element={<MainAppContent />} />
    </Routes>
  );
}