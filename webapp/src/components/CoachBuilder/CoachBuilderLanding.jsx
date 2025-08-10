import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCoachBuilder } from '../../contexts/CoachBuilderContext';
import Background from './components/Background';

const CoachBuilderLanding = () => {
  const navigate = useNavigate();
  const { resetCoachData, nextStep, startQuickStart } = useCoachBuilder();

  const handleGetStarted = () => {
    resetCoachData();
    nextStep();
    navigate('/coach-builder/personality');
  };

  const handleQuickStart = () => {
    resetCoachData();
    startQuickStart();
    navigate('/coach-builder/preview');
  };

  // Minimal, fast path experience — no feature grid or long copy

  return (
    <Background>
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-5">
        <Link to="/" className="text-white font-bold text-xl tracking-wide">CaboFit</Link>
        <div className="flex items-center gap-4">
          <Link to="/login" className="text-white/80 hover:text-white text-sm">Login</Link>
        </div>
      </div>

      {/* Centered hero content */}
      <div className="flex items-center justify-center px-6">
        <div className="w-full max-w-3xl text-center mt-12">
          <h1 className="text-white text-5xl md:text-6xl font-extrabold drop-shadow-md">
            Build your coach in 1 minute
          </h1>
          <p className="text-white/90 text-lg md:text-xl mt-4">
            Start with a tunable coach card. No account needed.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={handleQuickStart}
              className="bg-white text-gray-900 font-bold py-3 px-8 rounded-full shadow-lg hover:shadow-xl hover:scale-[1.02] transition"
            >
              Quick Start →
            </button>
            <button
              onClick={handleGetStarted}
              className="text-white/90 hover:text-white underline-offset-4 hover:underline"
            >
              Advanced setup
            </button>
          </div>

          <p className="text-white/70 text-sm mt-3">You can edit everything later.</p>
        </div>
      </div>
    </Background>
  );
};

export default CoachBuilderLanding; 