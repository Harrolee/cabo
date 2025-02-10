import React, { useState, useEffect } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { useSwipeable } from 'react-swipeable';
import { SignUpForm } from './SignUpForm';
import { PaymentForm } from './PaymentForm';
import { FooterLinks } from './FooterLinks';
import { StatusMessage } from './StatusMessage';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';

export function MainContent({ 
  showInitialScreen, 
  handleInitialSubscribe, 
  showSignupForm,
  handleSubscribe,
  userData,
  stripePromise,
  setShowInfo,
  setShowTerms,
  setShowPrivacy,
  isMobile,
}) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [previewImages, setPreviewImages] = useState([]);
  const [paymentStatus, setPaymentStatus] = useState(null); // 'success' | 'error' | null
  const [showSwipeHint, setShowSwipeHint] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [clientSecret, setClientSecret] = useState(null);
  
  useEffect(() => {
    if (isMobile) {
      // For mobile, load and sort numbered images
      const mobileImages = import.meta.glob('/src/assets/mobile-intro/*.{png,jpg,jpeg,gif}', {
        eager: true,
        import: 'default'
      });

      const sortedMobileImages = Object.entries(mobileImages)
        .sort(([pathA], [pathB]) => {
          // Extract numbers from filenames, default to 0 if no match
          const numA = parseInt(pathA.match(/(\d+)/)?.[0] || '0');
          const numB = parseInt(pathB.match(/(\d+)/)?.[0] || '0');
          return numA - numB;
        })
        .map(([path, src]) => ({
          src,
          alt: `Preview ${path.split('/').pop().split('.')[0]}`
        }));

      console.log('Loaded mobile images:', sortedMobileImages); // Debug log
      setPreviewImages(sortedMobileImages);
    } else {
      // For desktop, maintain existing behavior
      const images = import.meta.glob('/src/assets/preview-images/*.{png,jpg,jpeg,gif}', {
        eager: true,
        import: 'default'
      });

      const imageArray = Object.entries(images).map(([path, src]) => ({
        src,
        alt: `Preview ${path.split('/').pop().split('.')[0]}`
      }));

      setPreviewImages(imageArray);
    }
  }, [isMobile]);

  useEffect(() => {
    if (showSwipeHint) {
      const timer = setTimeout(() => setShowSwipeHint(false), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const createSetupIntent = async () => {
      if (!userData?.email) return;
      
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/create-setup-intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            email: userData.email,
          }),
        });

        // Check if response has content before trying to parse JSON
        const text = await response.text();
        if (!text) {
          console.error('Empty response from create-setup-intent');
          toast.error('Unable to start payment process. Please try again.');
          return;
        }

        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error('Invalid JSON response:', text);
          toast.error('Received invalid response from server. Please try again.');
          return;
        }
        
        if (!response.ok) {
          console.error('Setup intent creation error:', data);
          toast.error(data.message || 'Failed to setup payment. Please try again.');
          return;
        }

        if (!data.clientSecret) {
          console.error('No client secret in response:', data);
          toast.error('Invalid payment setup response. Please try again.');
          return;
        }

        setClientSecret(data.clientSecret);
      } catch (error) {
        console.error('Setup intent creation error:', error);
        toast.error('Unable to setup payment. Please try again.');
      }
    };

    // Create setup intent when we have an email param and we're showing the payment form
    const urlParams = new URLSearchParams(window.location.search);
    if (!showSignupForm && urlParams.get('email') && !clientSecret) {
      createSetupIntent();
    }
  }, [showSignupForm, userData?.email, clientSecret]);

  // Add this useEffect to handle initial loading
  useEffect(() => {
    // Give enough time for resources to load
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  const nextImage = () => {
    setCurrentImageIndex((prev) => 
      prev === previewImages.length - 1 ? 0 : prev + 1
    );
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => 
      prev === 0 ? previewImages.length - 1 : prev - 1
    );
  };

  const handlers = useSwipeable({
    onSwipedLeft: nextImage,
    onSwipedRight: prevImage,
    preventDefaultTouchmoveEvent: true,
    trackMouse: true
  });

  const handlePaymentSuccessWrapper = async () => {
    await handlePaymentSuccess();
    setPaymentStatus('success');
  };

  const handlePaymentError = () => {
    setPaymentStatus('error');
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
          <p className="mt-4 text-white text-lg">Loading CaboFit...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-black bg-opacity-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
          {showInitialScreen ? 'CaboFit' : 'Start Your Free Trial'}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-200">
          Get fit for Cabo with daily motivation texts and progress pics
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white bg-opacity-90 py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {showInitialScreen && isMobile ? (
            <div className="fixed inset-0 bg-black">
              <AnimatePresence initial={false}>
                {previewImages.length > 0 && (
                  <motion.div
                    key={currentImageIndex}
                    initial={{ opacity: 0, x: 300 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -300 }}
                    transition={{ duration: 0.3 }}
                    className="h-full w-full relative"
                    {...handlers}
                  >
                    {/* Product Demo Slides */}
                    {currentImageIndex === previewImages.length - 1 ? (
                      // Last slide - Call to action
                      <div className="h-full w-full flex flex-col items-center justify-center p-6 text-white">
                        <h2 className="text-3xl font-bold mb-4 text-center">
                          Ready to transform your fitness journey?
                        </h2>
                        <p className="text-lg mb-8 text-center">
                          Get started with your free trial today
                        </p>
                        <button
                          onClick={handleInitialSubscribe}
                          className="w-64 py-3 px-6 bg-indigo-600 rounded-full text-lg font-semibold shadow-lg"
                        >
                          I'm in!
                        </button>
                      </div>
                    ) : (
                      // Demo slides
                      <img
                        src={previewImages[currentImageIndex].src}
                        alt={previewImages[currentImageIndex].alt}
                        className="h-full w-full object-cover"
                      />
                    )}

                    {/* Enhanced Swipe Hint Animation */}
                    {showSwipeHint && currentImageIndex === 0 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center pointer-events-none"
                      >
                        <div className="flex items-center space-x-4">
                          <motion.div
                            animate={{ 
                              x: [-20, 20, -20],
                              opacity: [0.8, 1, 0.8]
                            }}
                            transition={{ 
                              duration: 1.5, 
                              repeat: Infinity,
                              ease: "easeInOut"
                            }}
                            className="flex items-center"
                          >
                            <span className="text-white text-xl">Swipe</span>
                            <svg 
                              className="w-8 h-8 text-white ml-2" 
                              fill="none" 
                              viewBox="0 0 24 24" 
                              stroke="currentColor"
                            >
                              <path 
                                strokeLinecap="round" 
                                strokeLinejoin="round" 
                                strokeWidth={2} 
                                d="M14 5l7 7m0 0l-7 7m7-7H3" 
                              />
                            </svg>
                          </motion.div>
                        </div>
                      </motion.div>
                    )}

                    {/* Progress Indicator */}
                    <div className="absolute bottom-8 left-0 right-0">
                      <div className="flex justify-center gap-2">
                        {[...Array(previewImages.length)].map((_, index) => (
                          <div
                            key={index}
                            className={`h-2 w-2 rounded-full ${
                              currentImageIndex === index ? 'bg-white' : 'bg-white/40'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : showSignupForm ? (
            <SignUpForm onSubscribe={handleSubscribe} />
          ) : clientSecret ? (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <PaymentForm 
                userData={userData} 
                onPaymentSuccess={handlePaymentSuccessWrapper}
                onPaymentError={handlePaymentError}
              />
            </Elements>
          ) : (
            <div className="text-center">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Thanks for signing up!
              </h3>
              <p className="text-sm text-gray-600">
                Check your phone for a text message to set up your preferences.
              </p>
            </div>
          )}
        </div>
      </div>

      {!showInitialScreen && <FooterLinks 
        setShowInfo={setShowInfo}
        setShowTerms={setShowTerms}
        setShowPrivacy={setShowPrivacy}
      />}
    </div>
  );
} 