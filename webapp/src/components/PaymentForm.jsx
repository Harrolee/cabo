import React, { useState, useEffect } from 'react';
import {
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';

export function PaymentForm({ userData, onPaymentSuccess, onPaymentError }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState(null);
  const [isPaymentElementsLoading, setIsPaymentElementsLoading] = useState(true);

  useEffect(() => {
    // Add listener for when Stripe Elements is ready
    const checkElements = async () => {
      if (elements) {
        setIsPaymentElementsLoading(false);
      }
    };
    checkElements();
  }, [elements]);

  const handleError = (error, context) => {
    console.error(`${context}:`, error);
    let userMessage = 'An unexpected error occurred. Please try again.';

    if (error.code === 'MISSING_FIELDS') {
      userMessage = 'Please ensure all required fields are filled out.';
    } else if (error.code === 'PAYMENT_METHOD_ERROR') {
      userMessage = 'There was an issue with your payment method. Please try again with a different card.';
    } else if (error.code === 'INVALID_STATUS') {
      userMessage = 'Your subscription status is invalid. Please contact support.';
    } else if (error.code === 'STRIPE_ERROR') {
      userMessage = error.message || 'Payment processing failed. Please try again.';
    }

    setMessage(userMessage);
    onPaymentError();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsProcessing(true);
    setMessage(null);

    if (!userData?.email) {
      handleError({ code: 'MISSING_FIELDS' }, 'Missing email');
      setIsProcessing(false);
      return;
    }

    try {
      // Confirm the SetupIntent
      const { error: setupError, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: window.location.origin,
          payment_method_data: {
            metadata: {
              email: userData.email
            }
          }
        },
        redirect: 'if_required',
      });

      if (setupError) {
        handleError(setupError, 'Setup confirmation error');
        setIsProcessing(false);
        return;
      }

      // Create subscription
      const response = await fetch(`${import.meta.env.VITE_API_URL}/create-stripe-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          email: userData.email,
          paymentMethodId: setupIntent.payment_method,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        handleError(data, 'Subscription creation error');
        return;
      }

      await onPaymentSuccess();
    } catch (error) {
      handleError(error, 'Unexpected error');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isPaymentElementsLoading) {
    return (
      <div className="min-h-[300px] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-600 text-sm">Loading payment form...</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Join CaboFit for $6/month
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Get daily beach fitness motivation texts and progress pics to get you Cabo-ready
        </p>
      </div>
      <PaymentElement options={{ layout: 'tabs' }} />
      <button
        type="submit"
        disabled={isProcessing || !stripe || !elements}
        className={`mt-4 w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
          isProcessing ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        {isProcessing ? 'Processing...' : 'Subscribe Now - $6/month'}
      </button>
      {message && (
        <div className="mt-4 text-sm text-center text-gray-700">
          {message}
        </div>
      )}
      {isProcessing && (
        <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-600"></div>
            <p className="mt-4 text-gray-600 text-sm">Processing payment...</p>
          </div>
        </div>
      )}
    </form>
  );
} 