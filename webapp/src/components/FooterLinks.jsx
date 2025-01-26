import React from 'react';

export function FooterLinks({ setShowInfo, setShowTerms, setShowPrivacy }) {
  return (
    <>
      <div className="mt-4 text-center">
        <button
          onClick={() => setShowInfo(true)}
          className="text-sm text-blue-500 hover:underline"
        >
          Message Flow Information
        </button>
      </div>

      <div className="mt-4 text-center">
        <button
          onClick={() => setShowTerms(true)}
          className="text-sm text-blue-500 hover:underline"
        >
          Terms of Service
        </button>
        {' | '}
        <button
          onClick={() => setShowPrivacy(true)}
          className="text-sm text-blue-500 hover:underline"
        >
          Privacy Policy
        </button>
      </div>
    </>
  );
} 