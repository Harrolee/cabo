import React from 'react';
import heroBg from '../../../assets/background-image/coach-builder.png';

export default function CoachBuilderBackground({ children }) {
  return (
    <div className="relative min-h-screen text-gray-900">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${heroBg})`, filter: 'brightness(0.6)' }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/40 to-black/60" />
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}


