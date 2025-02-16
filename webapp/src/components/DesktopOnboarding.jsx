import React from 'react';

// Import images using Vite's syntax
import defineSelfImage from '/src/assets/intro/0-defineSelf.png';
import personalizedImages from '/src/assets/intro/1-personalized_images.png';
import chatImage from '/src/assets/intro/2-chat.png';

export function DesktopOnboarding({ handleInitialSubscribe }) {
  const features = [
    {
      title: "Describe Yourself 🤔",
      description: "Pick a coach and tell them what you want. Send a selfie and describe yourself for super-personalized motivation",
      // description: "Get matched with a supportive buddy who understands your goals and keeps you motivated",
      image: defineSelfImage
    },
    {
      title: "Sneak a peek 👀",
      description: "What's that in panel two of comic you? Got a blonde surfer 'miron your gains, bruh. CRUNCH ON! 💪",
      image: personalizedImages
    },
    {
      title: "Share Your Journey 🎉",
      description: "Celebrate (commiserate?) with your coach. ",
      image: chatImage
    }
  ];

  return (
    <div className="min-h-screen w-full flex flex-col items-center">
      <div className="w-full max-w-[1800px] px-8 py-16">
        <h1 className="text-6xl font-bold mb-24 text-center text-white">
          Your Personal Fitness <br />
          Journey Awaits
        </h1>
        
        <div className="flex justify-between gap-12 mb-24">
          {features.map((feature, index) => (
            <div 
              key={index} 
              className="flex-1 bg-white/95 backdrop-blur-sm rounded-3xl p-8 shadow-lg flex flex-col items-center text-center"
            >
              <h3 className="text-2xl font-bold mb-4">
                {feature.title}
              </h3>
              <div className="w-full max-w-sm aspect-[9/19] mb-8 rounded-3xl overflow-hidden bg-gray-50 shadow-xl">
                <img 
                  src={feature.image} 
                  alt={feature.title}
                  className="w-full h-full object-cover object-center"
                />
              </div>
              <p className="text-gray-600 text-lg max-w-sm">
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        <div className="flex justify-center">
          <button
            onClick={handleInitialSubscribe}
            className="w-72 py-4 px-8 bg-indigo-600 text-white rounded-full text-xl font-semibold shadow-lg hover:bg-indigo-700 transition-colors"
          >
            Let's go baby!
          </button>
        </div>
      </div>
    </div>
  );
} 