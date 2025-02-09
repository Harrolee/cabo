import React, { useState, useEffect, useRef } from 'react';
import { Toaster } from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js';
import { toast } from 'react-hot-toast';
import { VideoBackground } from './components/VideoBackground';
import { MainContent } from './components/MainContent';
import { PolicyModals } from './components/PolicyModals';
import UAParser from 'my-ua-parser';

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

export function App() {
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [nextVideoIndex, setNextVideoIndex] = useState(1);
  const [showInfo, setShowInfo] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showInitialScreen, setShowInitialScreen] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [clientSecret, setClientSecret] = useState('');
  const [userData, setUserData] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const currentVideoRef = useRef(null);
  const nextVideoRef = useRef(null);

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
    // Check for email parameter in URL when app loads
    const urlParams = new URLSearchParams(window.location.search);
    const emailParam = urlParams.get('email');
    
    if (emailParam) {
      // Fetch user data and setup payment
      const setupExistingUser = async () => {
        try {
          // Fetch user data from backend
          const response = await fetch(`${import.meta.env.VITE_API_URL}/get-user-data`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ email: emailParam }),
          });
          
          if (!response.ok) {
            throw new Error('User not found');
          }
          
          const userData = await response.json();
          
          // Create subscription and get client secret
          const subscriptionResponse = await fetch(`${import.meta.env.VITE_API_URL}/create-subscription`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify(userData),
          });
          
          const data = await subscriptionResponse.json();
          
          if (!data.clientSecret) {
            throw new Error('No client secret received from server');
          }
          
          // Set up payment form
          setUserData(userData);
          setClientSecret(data.clientSecret);
          setShowInitialScreen(false);
          setShowPayment(true);
        } catch (error) {
          console.error('Error setting up payment:', error);
          toast.error('Unable to load your payment information. Please try signing up again.');
        }
      };

      setupExistingUser();
    }
  }, []); // Run once when component mounts

  const handleModalClose = () => {
    setShowInfo(false);
    setShowTerms(false);
    setShowPrivacy(false);
  };

  const handleInitialSubscribe = () => {
    setShowInitialScreen(false);
  };

  const handleSubscribe = async (userData) => {
    try {
      setUserData(userData);
      
      // Create subscription and get client secret from backend
      const subscriptionResponse = await fetch(`${import.meta.env.VITE_API_URL}/create-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(userData),
      });
      
      if (subscriptionResponse.status === 409) {
        throw new Error('This phone number is already registered with CaboFit');
      }
      
      const data = await subscriptionResponse.json();
      
      if (!data.clientSecret) {
        throw new Error('No client secret received from server');
      }
      
      // Store client secret for later use when user clicks payment link
      setClientSecret(data.clientSecret);
      
      // Instead of showing payment form, proceed to signup completion
      await handlePaymentSuccess();
      
    } catch (error) {
      console.error('Error in subscription process:', error);
      toast.error(error.message || 'Something went wrong. Please try again.');
      throw error;
    }
  };

  const handlePaymentSuccess = async () => {
    try {
      if (!userData) {
        toast.error('Session expired. Please sign up again.');
        setShowPayment(false);
        return;
      }

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

      // Reset form state after a delay to allow success message to be seen
      setTimeout(() => {
        setShowPayment(false);
        setShowInitialScreen(true);
        setUserData(null);
      }, 20000);
      
    } catch (error) {
      console.error('Error creating user profile:', error);
      toast.error('Something went wrong. Please try again.');
    }
  };

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
          className="fixed inset-0 bg-gradient-to-b from-sky-400 to-blue-500"
          style={{
            backgroundImage: `
              radial-gradient(circle at 80% 50%, rgba(255,255,255,0.12) 0%, transparent 60%),
              radial-gradient(circle at 20% 30%, rgba(255,255,255,0.15) 0%, transparent 50%)
            `
          }}
        />
      )}

      <MainContent
        showInitialScreen={showInitialScreen}
        handleInitialSubscribe={handleInitialSubscribe}
        showPayment={showPayment}
        handleSubscribe={handleSubscribe}
        userData={userData}
        handlePaymentSuccess={handlePaymentSuccess}
        stripePromise={stripePromise}
        clientSecret={clientSecret}
        setShowInfo={setShowInfo}
        setShowTerms={setShowTerms}
        setShowPrivacy={setShowPrivacy}
        showPreview={showPreview}
        setShowPreview={setShowPreview}
        className={`${isMobile ? 'px-4 py-6' : 'px-8 py-12'}`}
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
            <img
              src="/path/to/your/preview-image.jpg"
              alt="Preview of daily motivational content"
              className="w-full rounded-lg shadow-lg"
            />
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
}

export default App;