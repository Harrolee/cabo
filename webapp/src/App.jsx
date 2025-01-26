import React, { useState, useEffect, useRef } from 'react';
import { Toaster } from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { SignUpForm } from './components/SignUpForm';
import { TermsOfService } from './components/TermsOfService';
import { Modal } from './components/Modal';
import { MessageFlowInfo } from './components/MessageFlowInfo';
import { PaymentForm } from './components/PaymentForm';
import { DataPolicy } from './components/DataPolicy';
import { toast } from 'react-hot-toast';

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

  // Handle video ended event to swap videos
  const handleVideoEnded = () => {
    // Show the preloaded video
    if (nextVideoRef.current) {
      nextVideoRef.current.style.opacity = 1;
      nextVideoRef.current.play();
    }
    if (currentVideoRef.current) {
      currentVideoRef.current.style.opacity = 0;
    }

    // Update indices
    setCurrentVideoIndex(nextVideoIndex);
    setNextVideoIndex((nextVideoIndex + 1) % WORKOUT_VIDEOS.length);
  };

  // Preload the next video when indices change
  useEffect(() => {
    if (nextVideoRef.current) {
      nextVideoRef.current.load();
    }
  }, [nextVideoIndex]);

  const toggleInfoVisibility = () => {
    setShowInfo(!showInfo);
  };

  // Close modals when clicking outside
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
      }, 5000);
      
    } catch (error) {
      console.error('Error creating user profile:', error);
      toast.error('Something went wrong. Please try again.');
    }
  };

  return (
    <div className="relative min-h-screen">
      {/* Current Video */}
      <video
        ref={currentVideoRef}
        key={`current-${currentVideoIndex}`}
        autoPlay
        muted
        preload="auto"
        onEnded={handleVideoEnded}
        className="absolute top-0 left-0 w-full h-full object-cover transition-opacity duration-1000"
      >
        <source
          src={WORKOUT_VIDEOS[currentVideoIndex].url}
          type={WORKOUT_VIDEOS[currentVideoIndex].type}
        />
      </video>

      {/* Preloaded Next Video */}
      <video
        ref={nextVideoRef}
        key={`next-${nextVideoIndex}`}
        muted
        preload="auto"
        className="absolute top-0 left-0 w-full h-full object-cover opacity-0 transition-opacity duration-1000"
      >
        <source
          src={WORKOUT_VIDEOS[nextVideoIndex].url}
          type={WORKOUT_VIDEOS[nextVideoIndex].type}
        />
      </video>

      {/* Content Overlay */}
      <div className="relative z-10 min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-black bg-opacity-50">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            {showInitialScreen ? 'CaboFit' : 'Sign Up'}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-200">
            Get fit for Cabo with daily motivation texts and progress pics
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white bg-opacity-90 py-8 px-4 shadow sm:rounded-lg sm:px-10">
            {showInitialScreen ? (
              <button
                onClick={handleInitialSubscribe}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Let's Go!
              </button>
            ) : !showPayment ? (
              <SignUpForm onSubscribe={handleSubscribe} />
            ) : (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PaymentForm 
                  userData={userData} 
                  onPaymentSuccess={handlePaymentSuccess}
                />
              </Elements>
            )}
          </div>
        </div>

        {/* Show links only after initial screen */}
        {!showInitialScreen && (
          <>
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowInfo(true)}
                className="text-sm text-blue-500 hover:underline"
              >
                Message Flow Information
              </button>
            </div>

            <div className="mt-4 text-center">
              <button
                onClick={() => setShowTerms(true)}
                className="text-sm text-blue-500 hover:underline"
              >
                Terms of Service
              </button>
              {' | '}
              <button
                onClick={() => setShowPrivacy(true)}
                className="text-sm text-blue-500 hover:underline"
              >
                Privacy Policy
              </button>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      <Modal
        isOpen={showInfo}
        onClose={handleModalClose}
        title="Message Flow Information"
      >
        <MessageFlowInfo />
      </Modal>

      <Modal
        isOpen={showTerms}
        onClose={handleModalClose}
        title="Terms of Service"
      >
        <TermsOfService />
      </Modal>

      <Modal
        isOpen={showPrivacy}
        onClose={handleModalClose}
        title="Privacy Policy"
      >
        <DataPolicy />
      </Modal>

      <Toaster position="top-center" />
    </div>
  );
}

export default App;