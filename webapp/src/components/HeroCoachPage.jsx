import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COACH_PERSONAS } from './coach-personas.js';
// You may need to adjust the import path depending on your build setup

const COACH_IMAGES = {
  zen_master: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
  gym_bro: 'https://images.unsplash.com/photo-1517960413843-0aee8e2d471c?auto=format&fit=crop&w=800&q=80',
  dance_teacher: 'https://images.unsplash.com/photo-1519864600265-abb23847ef2c?auto=format&fit=crop&w=800&q=80',
  drill_sergeant: 'https://images.unsplash.com/photo-1503676382389-4809596d5290?auto=format&fit=crop&w=800&q=80',
  frat_bro: 'https://images.unsplash.com/photo-1464983953574-0892a716854b?auto=format&fit=crop&w=800&q=80',
};

// Placeholder foods for each coach
const COACH_FOODS = {
  zen_master: ['Avocado Toast', 'Green Tea', 'Quinoa Salad'],
  gym_bro: ['Chicken Breast', 'Protein Shake', 'Broccoli'],
  dance_teacher: ['Smoothie Bowl', 'Grilled Salmon', 'Fruit Salad'],
  drill_sergeant: ['Egg Whites', 'Oatmeal', 'Lean Beef'],
  frat_bro: ['Pizza', 'Burgers', 'Energy Drinks'],
};

const coachKeys = Object.keys(COACH_PERSONAS);

export default function HeroCoachPage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const coachKey = coachKeys[currentIndex];
  const coach = COACH_PERSONAS[coachKey];
  const navigate = useNavigate();

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? coachKeys.length - 1 : prev - 1));
  };
  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % coachKeys.length);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-black overflow-hidden">
      <img
        src={COACH_IMAGES[coachKey]}
        alt={coach.name}
        className="absolute inset-0 w-full h-full object-cover object-center z-0"
        style={{ filter: 'brightness(0.6)' }}
      />
      {/* Back button in top-right */}
      <div className="absolute top-8 right-8 z-30">
        <button
          onClick={() => navigate(-1)}
          className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-full shadow-lg text-lg hover:scale-105 transition-transform duration-200 border-4 border-white/30 backdrop-blur-md"
          style={{ boxShadow: '0 4px 32px 0 rgba(80, 0, 120, 0.25)' }}
        >
          ← Back
        </button>
      </div>
      {/* Left edge info box */}
      <div className="absolute top-1/2 left-0 transform -translate-y-1/2 ml-2 md:ml-8 z-10 max-w-xs w-[90vw] md:w-80">
        <div className="bg-gray-900 bg-opacity-80 rounded-lg shadow-lg p-4 text-white mb-4">
          <h2 className="font-semibold text-xl mb-2">Characteristics</h2>
          <ul className="list-disc list-inside text-base">
            {coach.traits.map((trait, i) => (
              <li key={i}>{trait}</li>
            ))}
          </ul>
        </div>
        <div className="bg-gray-900 bg-opacity-80 rounded-lg shadow-lg p-4 text-white">
          <h2 className="font-semibold text-xl mb-2">Favorite Foods</h2>
          <ul className="list-disc list-inside text-base">
            {COACH_FOODS[coachKey].map((food, i) => (
              <li key={i}>{food}</li>
            ))}
          </ul>
        </div>
      </div>
      {/* Right edge info box */}
      <div className="absolute top-1/2 right-0 transform -translate-y-1/2 mr-2 md:mr-8 z-10 max-w-xs w-[90vw] md:w-80">
        <div className="bg-gray-900 bg-opacity-80 rounded-lg shadow-lg p-4 text-white">
          <h2 className="font-semibold text-xl mb-2">Pursuits</h2>
          <ul className="list-disc list-inside text-base">
            {coach.activities.map((activity, i) => (
              <li key={i}>{activity}</li>
            ))}
          </ul>
        </div>
      </div>
      {/* Coach name and description at the bottom */}
      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-full z-20 flex flex-col items-center pb-8">
        <h1 className="text-5xl md:text-6xl font-extrabold text-white drop-shadow-lg mb-2 text-center bg-black bg-opacity-40 px-6 py-2 rounded-lg">
          {coach.name}
        </h1>
        <p className="text-lg md:text-xl text-white text-center bg-black bg-opacity-30 px-4 py-2 rounded-lg max-w-2xl">
          {coach.description}
        </p>
        <div className="flex justify-between w-full max-w-2xl mt-6 px-4">
          <button
            onClick={handlePrev}
            className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
          >
            ← Prev
          </button>
          <button
            onClick={handleNext}
            className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
} 