import React, { useState, useEffect } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { useSwipeable } from 'react-swipeable';
import { SignUpForm } from './SignUpForm';
import { PaymentForm } from './PaymentForm';
import { FooterLinks } from './FooterLinks';
import { StatusMessage } from './StatusMessage';
import { PaymentSuccess } from './PaymentSuccess';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { PaymentFlow } from './PaymentFlow';
import { OnboardingFlow } from './OnboardingFlow';

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
  isPaymentFlow,
}) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [previewImages, setPreviewImages] = useState([]);
  const [paymentStatus, setPaymentStatus] = useState(null); // 'success' | 'error' | null
  const [showSwipeHint, setShowSwipeHint] = useState(true);
  const [isContentLoading, setIsContentLoading] = useState(true);
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

  // Update the useEffect for loading state
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsContentLoading(false);
    }, isPaymentFlow ? 0 : 1000); // No artificial delay for payment flow

    return () => clearTimeout(timer);
  }, [isPaymentFlow]);

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

  const handlePaymentSuccess = () => {
    setPaymentStatus('success');
  };

  const handlePaymentError = () => {
    setPaymentStatus('error');
  };

  if (isContentLoading || (isPaymentFlow && !clientSecret)) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
          <p className="mt-4 text-white text-lg">
            {isPaymentFlow ? 'Setting up payment...' : 'Loading CaboFit...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-black bg-opacity-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
          {paymentStatus === 'success' ? 'Welcome to CaboFit!' :
           showInitialScreen ? 'CaboFit' : 
           isPaymentFlow ? 'Start Your Subscription' : 'Start Your Free Trial'}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-200">
          {paymentStatus === 'success' ? 
            'Get ready for daily motivation texts and progress pics' :
            'Get fit for Cabo with daily motivation texts and progress pics'
          }
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white bg-opacity-90 py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {paymentStatus === 'success' ? (
            <PaymentSuccess />
          ) : isPaymentFlow ? (
            <PaymentFlow 
              userData={userData}
              stripePromise={stripePromise}
              onPaymentSuccess={handlePaymentSuccess}
              onPaymentError={handlePaymentError}
            />
          ) : (
            <OnboardingFlow 
              handleInitialSubscribe={() => {
                console.log('handleInitialSubscribe called from MainContent');
                handleInitialSubscribe();
              }}
              onSubscribe={handleSubscribe}
              isMobile={isMobile}
              showSignupForm={!showInitialScreen && showSignupForm}
              showInitialScreen={showInitialScreen}
            />
          )}
        </div>
      </div>

      {!showInitialScreen && <FooterLinks {...{ setShowInfo, setShowTerms, setShowPrivacy }} />}
    </div>
  );
} 