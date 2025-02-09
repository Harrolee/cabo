import React, { useState, useEffect } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { useSwipeable } from 'react-swipeable';
import { SignUpForm } from './SignUpForm';
import { PaymentForm } from './PaymentForm';
import { FooterLinks } from './FooterLinks';
import { StatusMessage } from './StatusMessage';

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
  setShowPrivacy
}) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [previewImages, setPreviewImages] = useState([]);
  const [paymentStatus, setPaymentStatus] = useState(null); // 'success' | 'error' | null
  
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
          {showInitialScreen ? (
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
          ) : paymentStatus ? (
            <StatusMessage isSuccess={paymentStatus === 'success'} />
          ) : (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <PaymentForm 
                userData={userData} 
                onPaymentSuccess={handlePaymentSuccessWrapper}
                onPaymentError={handlePaymentError}
              />
            </Elements>
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