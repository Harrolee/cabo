import React, { useState, useEffect } from 'react';
import { Elements } from '@stripe/stripe-js';
import { PaymentForm } from './PaymentForm';
import { toast } from 'react-hot-toast';

export function PaymentFlow({ 
  userData, 
  stripePromise, 
  onPaymentSuccess, 
  onPaymentError 
}) {
  const [clientSecret, setClientSecret] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const createSetupIntent = async () => {
      if (!userData?.email) {
        onPaymentError();
        toast.error('Missing email address');
        return;
      }
      
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

        const text = await response.text();
        if (!text) {
          throw new Error('Empty response from create-setup-intent');
        }

        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error('Invalid JSON response from server');
        }
        
        if (!response.ok) {
          throw new Error(data.message || 'Failed to setup payment');
        }

        if (!data.clientSecret) {
          throw new Error('Invalid payment setup response');
        }

        setClientSecret(data.clientSecret);
        setIsLoading(false);
      } catch (error) {
        console.error('Setup intent creation error:', error);
        toast.error(error.message || 'Unable to setup payment. Please try again.');
        onPaymentError();
        setIsLoading(false);
      }
    };

    createSetupIntent();
  }, [userData?.email, onPaymentError]);

  if (isLoading || !clientSecret) {
    return (
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-600"></div>
        <p className="mt-4 text-gray-600">Setting up payment...</p>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <PaymentForm 
        userData={userData} 
        onPaymentSuccess={onPaymentSuccess}
        onPaymentError={onPaymentError}
      />
    </Elements>
  );
} 