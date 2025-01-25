import React, { useState } from 'react';
import {
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';
import toast from 'react-hot-toast';

export function PaymentForm({ userData }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsProcessing(true);

    try {
      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin,
        },
        redirect: 'if_required',
      });

      if (stripeError) {
        setMessage(stripeError.message);
        return;
      }

      // Payment successful, now create the user profile
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

      setMessage('Payment successful! Your subscription is now active.');
    } catch (error) {
      setMessage(error.message || 'An unexpected error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Join CaboFit for $2/month
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Get daily beach fitness motivation texts and progress pics to help you get Cabo-ready.
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
        {isProcessing ? 'Processing...' : 'Subscribe Now - $2/month'}
      </button>
      {message && (
        <div className="mt-4 text-sm text-center text-gray-700">
          {message}
        </div>
      )}
    </form>
  );
} 