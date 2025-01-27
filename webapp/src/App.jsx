import React, { useState, useEffect, useRef } from 'react';
import { Toaster } from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js';
import { toast } from 'react-hot-toast';
import { VideoBackground } from './components/VideoBackground';
import { MainContent } from './components/MainContent';
import { PolicyModals } from './components/PolicyModals';

const STRIPE_PUBLIC_KEY = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
const stripePromise = loadStripe(STRIPE_PUBLIC_KEY);

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
      
      // Set client secret and show payment form immediately
      setClientSecret(data.clientSecret);
      setShowPayment(true);
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
      <VideoBackground
        currentVideoRef={currentVideoRef}
        nextVideoRef={nextVideoRef}
        currentVideoIndex={currentVideoIndex}
        nextVideoIndex={nextVideoIndex}
        handleVideoEnded={handleVideoEnded}
        WORKOUT_VIDEOS={WORKOUT_VIDEOS}
      />

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
      />

      <PolicyModals
        showInfo={showInfo}
        showTerms={showTerms}
        showPrivacy={showPrivacy}
        handleModalClose={handleModalClose}
      />

      <Toaster position="top-center" />
    </div>
  );
}

export default App;