import React, { useState, useEffect, useRef } from 'react';
import { Toaster } from 'react-hot-toast';
import { SignUpForm } from './components/SignUpForm';
import { MoreInfoSection } from './components/MoreInfoSection';
import { TermsOfService } from './components/TermsOfService';
import { DataHandling } from './components/DataHandling';
import { Modal } from './components/Modal';
import { MessageFlowInfo } from './components/MessageFlowInfo';

const SIGNUP_FUNCTION_URL = import.meta.env.VITE_SIGNUP_FUNCTION_URL;

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

      {/* Preloaded Next Video (hidden initially) */}
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
            Daily Workout Motivation
          </h2>
          <p className="mt-2 text-center text-sm text-gray-200">
            Sign up to receive daily motivation texts and progress pics
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white bg-opacity-90 py-8 px-4 shadow sm:rounded-lg sm:px-10">
            <SignUpForm signupUrl={SIGNUP_FUNCTION_URL} />
          </div>
        </div>

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

        <Toaster position="top-center" />
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
        <DataHandling />
      </Modal>
    </div>
  );
}

export default App;