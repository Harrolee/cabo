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
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const from = location.state?.from?.pathname || "/settings";

  const handlePhoneSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: phone,
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
        phone: phone,
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
        {!showOtpInput ? (
          <>
            <p className="text-center mb-4 text-sm text-gray-600">
              Enter your phone number to receive a verification code.
            </p>
            <form onSubmit={handlePhoneSubmit}>
              <input
                type="tel"
                placeholder="+1XXXXXXXXXX"
                value={phone}
                required
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-2 mb-4 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send Verification Code'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-center mb-4 text-sm text-gray-600">
              Enter the verification code sent to {phone}
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
  return (
    <div>
      <nav className="bg-gray-800 text-white p-4">
        <ul className="flex space-x-4 items-center">
          <li><Link to="/">Home (Main App)</Link></li>
          <li><Link to="/settings">Settings</Link></li>
          <li><Link to="/billing">Billing</Link></li>
          <li className="ml-auto">Logged in as: {session.user.email}</li>
          <li>
            <button 
              onClick={() => supabase.auth.signOut()} 
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

    return () => subscription.unsubscribe();
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
      
      <Route element={<ProtectedRoute session={session}><AuthenticatedLayout session={session} /></ProtectedRoute>}>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/billing" element={<BillingPage />} />
      </Route>

      <Route path="/*" element={<MainAppContent />} />
    </Routes>
  );
}