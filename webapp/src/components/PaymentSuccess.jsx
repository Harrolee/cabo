import React from 'react';

export function PaymentSuccess({ isPaymentFlow }) {
  return (
    <div className="text-center">
      <div className="mb-4">
        <svg className="mx-auto h-12 w-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        {isPaymentFlow ? "Congrats! You're all set" : "Thanks for signing up!"}
      </h3>
      <p className="text-sm text-gray-600">
        {isPaymentFlow 
          ? "Thank you for joining CaboFit! Get ready for daily beach fitness motivation texts and progress pics."
          : "Get ready for daily beach fitness motivation texts and progress pics. Check your phone to complete setup."
        }
      </p>
    </div>
  );
} 