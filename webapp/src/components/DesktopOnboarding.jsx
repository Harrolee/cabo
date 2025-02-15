import React from 'react';

// Import images using Vite's syntax
import coachImage from '/src/assets/intro/coach.jpeg';
import chatImage from '/src/assets/intro/chat.png';
import personalizedImage from '/src/assets/intro/personalized_images.png';

export function DesktopOnboarding({ handleInitialSubscribe }) {
  const features = [
    {
      title: "Choose Your Coach",
      description: "Get matched with a supportive buddy who understands your goals and keeps you motivated",
      image: coachImage
    },
    {
      title: "Daily Motivation",
      description: "Receive personalized messages and AI-generated images that inspire you to take action",
      image: personalizedImage
    },
    {
      title: "Share Your Journey",
      description: "Chat with your coach after workouts to celebrate wins and get personalized advice",
      image: chatImage
    }
  ];

  return (
    <div className="min-h-screen w-full flex flex-col items-center">
      <div className="w-full max-w-[1800px] px-8 py-16">
        <h1 className="text-6xl font-bold mb-24 text-center text-white">
          Your Personal<br />
          Fitness Journey<br />
          Awaits
        </h1>
        
        <div className="flex justify-between gap-12 mb-24">
          {features.map((feature, index) => (
            <div 
              key={index} 
              className="flex-1 bg-white/95 backdrop-blur-sm rounded-3xl p-8 shadow-lg flex flex-col items-center text-center"
            >
              <div className="w-full max-w-sm aspect-[9/19] mb-8 rounded-3xl overflow-hidden bg-gray-50 shadow-xl">
                <img 
                  src={feature.image} 
                  alt={feature.title}
                  className="w-full h-full object-cover object-center"
                />
              </div>
              <h3 className="text-2xl font-bold mb-4">
                {feature.title}
              </h3>
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
            Start My Journey
          </button>
        </div>
      </div>
    </div>
  );
} 