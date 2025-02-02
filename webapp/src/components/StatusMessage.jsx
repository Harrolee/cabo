import React from 'react';

export function StatusMessage({ isSuccess }) {
  if (isSuccess) {
    return (
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Welcome to CaboFit! 🎉
        </h2>
        <p className="text-gray-600 mb-4">
          Your subscription is now active. You'll receive a confirmation text message shortly.
        </p>
        <p className="text-gray-600">
          Get ready for daily motivation to help you reach your fitness goals!
        </p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">
        Oops! Something went wrong 😕
      </h2>
      <p className="text-gray-600 mb-4">
        We couldn't complete your subscription. Please try again or contact support if the problem persists.
      </p>
    </div>
  );
} 