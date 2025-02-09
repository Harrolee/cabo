import React, { useState } from 'react';
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsProcessing(true);

    if (!userData?.email) {
      setMessage('Missing user email. Please try again.');
      setIsProcessing(false);
      onPaymentError();
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
        setMessage(setupError.message);
        onPaymentError();
        return;
      }

      // Create subscription through backend endpoint
      const response = await fetch(`${import.meta.env.VITE_API_URL}/create-stripe-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          email: userData.email,
          customerId: userData.customerId,
          paymentMethodId: setupIntent.payment_method,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create subscription');
      }

      await onPaymentSuccess();
    } catch (error) {
      setMessage(error.message || 'An unexpected error occurred');
      onPaymentError();
    } finally {
      setIsProcessing(false);
    }
  };

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
      <PaymentElement />
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
    </form>
  );
} 