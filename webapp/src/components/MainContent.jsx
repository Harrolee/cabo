import React, { useState, useEffect } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { useSwipeable } from 'react-swipeable';
import { SignUpForm } from './SignUpForm';
import { PaymentForm } from './PaymentForm';
import { FooterLinks } from './FooterLinks';
import { StatusMessage } from './StatusMessage';
import { motion, AnimatePresence } from 'framer-motion';

export function MainContent({ 
  showInitialScreen, 
  handleInitialSubscribe, 
  showPayment, 
  handleSubscribe,
  userData,
  handlePaymentSuccess,
  stripePromise,
  clientSecret,
  setShowInfo,
  setShowTerms,
  setShowPrivacy,
  isMobile,
}) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [previewImages, setPreviewImages] = useState([]);
  const [paymentStatus, setPaymentStatus] = useState(null); // 'success' | 'error' | null
  const [showSwipeHint, setShowSwipeHint] = useState(true);
  
  // Add this to check for email parameter
  const [hasEmailParam] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return !!urlParams.get('email');
  });

  useEffect(() => {
    // Dynamically import all images from the preview-images directory
    const images = import.meta.glob('/src/assets/preview-images/*.{png,jpg,jpeg,gif}', {
      eager: true,
      import: 'default'
    });

    // Convert the images object to an array of image objects
    const imageArray = Object.entries(images).map(([path, src]) => ({
      src,
      alt: `Preview ${path.split('/').pop().split('.')[0]}`
    }));

    setPreviewImages(imageArray);
  }, []);

  useEffect(() => {
    if (showSwipeHint) {
      const timer = setTimeout(() => setShowSwipeHint(false), 2000);
      return () => clearTimeout(timer);
    }
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
                    // Demo GIF slides
                    <img
                      src={previewImages[currentImageIndex].src}
                      alt={previewImages[currentImageIndex].alt}
                      className="h-full w-full object-cover"
                    />
                  )}

                  {/* Swipe Hint Animation */}
                  {showSwipeHint && currentImageIndex === 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 2, repeat: 1 }}
                      className="absolute inset-0 pointer-events-none"
                    >
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                        <motion.div
                          animate={{ x: [0, 50, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                          className="text-white text-6xl opacity-50"
                        >
                          →
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
              </AnimatePresence>
            </div>
          ) : showInitialScreen ? (
            <>
              {previewImages.length > 0 && (
                /* iPhone Message Container */
                <div className="bg-gray-100 rounded-2xl p-4 mx-2 mb-6 relative" {...handlers}>
                  <div className="aspect-[2/3] relative">
                    <img
                      src={previewImages[currentImageIndex].src}
                      alt={previewImages[currentImageIndex].alt}
                      className="absolute inset-0 w-full h-full object-contain rounded-lg shadow-lg"
                    />
                  </div>

                  {/* Carousel Navigation Dots */}
                  {previewImages.length > 1 && (
                    <div className="flex justify-center gap-2 mt-4">
                      {previewImages.map((_, index) => (
                        <button
                          key={index}
                          className={`h-2 w-2 rounded-full ${
                            currentImageIndex === index ? 'bg-indigo-600' : 'bg-gray-300'
                          }`}
                          onClick={() => setCurrentImageIndex(index)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Arrow Navigation */}
                  {previewImages.length > 1 && (
                    <>
                      <button
                        className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-white bg-opacity-50 rounded-full p-2 hover:bg-opacity-75"
                        onClick={prevImage}
                      >
                        <svg className="h-6 w-6 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <button
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-white bg-opacity-50 rounded-full p-2 hover:bg-opacity-75"
                        onClick={nextImage}
                      >
                        <svg className="h-6 w-6 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              )}
              <button
                onClick={handleInitialSubscribe}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Let's Go!
              </button>
            </>
          ) : !showPayment ? (
            <SignUpForm onSubscribe={handleSubscribe} />
          ) : hasEmailParam ? ( // Only show payment form if we have email param
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <PaymentForm 
                userData={userData} 
                onPaymentSuccess={handlePaymentSuccessWrapper}
                onPaymentError={handlePaymentError}
              />
            </Elements>
          ) : (
            <StatusMessage isSuccess={true} /> // Show success message for new signups
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