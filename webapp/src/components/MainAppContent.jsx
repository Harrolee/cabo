import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Toaster } from 'react-hot-toast';
import { VideoBackground } from './VideoBackground';
import { MainContent } from './MainContent';
import { PolicyModals } from './PolicyModals';
import { useVideoManager } from '../hooks/useVideoManager';
import { usePreviewManager } from '../hooks/usePreviewManager';
import { isMobile } from '../constants';
import backgroundImage from '/src/assets/background-image/beach-palm-tree.jpg';

export const MainAppContent = ({ 
  session, 
  stripePromise,
  isAppLoading,
  hasAppLoaded,
  isMainContentLoading,
  hasMainContentLoaded,
  urlParams,
  isPaymentFlow,
  userData,
  setUserData,
  showInitialScreen,
  setShowInitialScreen,
  showSignupForm,
  setShowSignupForm
}) => {
  // UI state
  const [showInfo, setShowInfo] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Custom hooks
  const videoManager = useVideoManager();
  const previewManager = usePreviewManager();

  const navigate = useNavigate();

  // Show loading screen only during initial app load
  if (!hasAppLoaded && isAppLoading && !session) {
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

  const handleModalClose = () => {
    setShowInfo(false);
    setShowTerms(false);
    setShowPrivacy(false);
  };

  const handleInitialSubscribe = () => {
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

  return (
    <div className="relative min-h-screen">
      {!isMobile ? (
        <VideoBackground
          currentVideoRef={videoManager.currentVideoRef}
          nextVideoRef={videoManager.nextVideoRef}
          currentVideoIndex={videoManager.currentVideoIndex}
          nextVideoIndex={videoManager.nextVideoIndex}
          handleVideoEnded={videoManager.handleVideoEnded}
          WORKOUT_VIDEOS={videoManager.WORKOUT_VIDEOS}
          videosReady={videoManager.videosReady}
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
        isContentLoading={isMainContentLoading}
        hasContentLoaded={hasMainContentLoaded}
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
                src={previewManager.previewImages[previewManager.currentPreviewIndex]}
                alt={`Preview ${previewManager.currentPreviewIndex + 1} of ${previewManager.previewImages.length}`}
                className="w-full rounded-lg shadow-lg"
              />
              {isMobile && (
                <>
                  <button
                    onClick={() => previewManager.handlePreviewNavigation('prev')}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 rounded-full p-2 shadow-lg"
                    aria-label="Previous image"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => previewManager.handlePreviewNavigation('next')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 rounded-full p-2 shadow-lg"
                    aria-label="Next image"
                  >
                    →
                  </button>
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/80 px-3 py-1 rounded-full">
                    {previewManager.currentPreviewIndex + 1} / {previewManager.previewImages.length}
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