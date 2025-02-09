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
  const [previewImages, setPreviewImages] = useState([]);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);

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
  const [isLoading, setIsLoading] = useState(true);

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
        // Check for email parameter in URL when app loads
        const urlParams = new URLSearchParams(window.location.search);
        const emailParam = urlParams.get('email');
        
        if (emailParam) {
          // Fetch user data and setup payment
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
          setUserData(userData);
          setShowInitialScreen(false);
          setShowPayment(true);
        }
      } catch (error) {
        console.error('Error loading user data:', error);
        toast.error('Unable to load your information. Please try signing up again.');
      } finally {
        // Ensure loading state is removed even if there's an error
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []); // Run once when component mounts

  useEffect(() => {
    // Modified image import to store them in array order
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
    setShowInitialScreen(false);
  };

  const handleSubscribe = async (userData) => {
    try {
      setUserData(userData);
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

  // Add function to handle navigation
  const handlePreviewNavigation = (direction) => {
    if (direction === 'next') {
      setCurrentPreviewIndex((prev) => (prev + 1) % previewImages.length);
    } else {
      setCurrentPreviewIndex((prev) => 
        prev === 0 ? previewImages.length - 1 : prev - 1
      );
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
          <p className="mt-4 text-white text-lg">Loading CaboFit...</p>
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
        isMobile={isMobile}
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
}

export default App;