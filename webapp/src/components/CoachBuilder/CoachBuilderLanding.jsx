import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCoachBuilder } from '../../contexts/CoachBuilderContext';

const CoachBuilderLanding = () => {
  const navigate = useNavigate();
  const { resetCoachData, nextStep } = useCoachBuilder();

  const handleGetStarted = () => {
    resetCoachData();
    nextStep();
    navigate('/coach-builder/personality');
  };

  const features = [
    {
      icon: '🤖',
      title: 'AI-Powered Personality',
      description: 'Create a coach that responds with your unique style and approach'
    },
    {
      icon: '📝',
      title: 'Content Analysis',
      description: 'Upload your existing content to train your AI coach\'s voice'
    },
    {
      icon: '💬',
      title: 'SMS Integration',
      description: 'Your AI coach will send personalized messages via text'
    },
    {
      icon: '📊',
      title: 'Analytics Dashboard',
      description: 'Track engagement and performance of your AI coach'
    }
  ];

  const steps = [
    'Define your coaching personality and style',
    'Upload content to train your AI voice',
    'Preview and test your AI coach responses',
    'Launch and start engaging your audience'
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Navigation */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="text-xl font-bold text-gray-900">
              CaboFit
            </Link>
            <div className="flex space-x-4">
              <Link 
                to="/" 
                className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                Home
              </Link>
              <Link 
                to="/login" 
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                Login
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl md:text-6xl">
            Build Your AI
            <span className="text-blue-600"> Fitness Coach</span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-xl text-gray-600">
            Create a personalized AI coach that captures your unique training style and motivates your audience through SMS messages.
          </p>
          <div className="mt-8">
            <button
              onClick={handleGetStarted}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-lg text-lg transition duration-200 transform hover:scale-105"
            >
              Get Started Free
            </button>
            <p className="mt-2 text-sm text-gray-500">
              No account required to start building
            </p>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mt-20">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Everything you need to create your AI coach
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="bg-white rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-3xl mb-4">{feature.icon}</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {feature.title}
                </h3>
                <p className="text-gray-600">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* How it Works */}
        <div className="mt-20">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            How it works
          </h2>
          <div className="max-w-3xl mx-auto">
            {steps.map((step, index) => (
              <div key={index} className="flex items-start mb-8">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                    {index + 1}
                  </div>
                </div>
                <div className="ml-4">
                  <p className="text-lg text-gray-700">{step}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-20 bg-blue-600 rounded-2xl p-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to build your AI coach?
          </h2>
          <p className="text-blue-100 mb-6 text-lg">
            Join thousands of fitness professionals using AI to scale their coaching.
          </p>
          <button
            onClick={handleGetStarted}
            className="bg-white text-blue-600 font-bold py-3 px-8 rounded-lg text-lg hover:bg-gray-50 transition duration-200"
          >
            Start Building Now
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p>&copy; 2024 CaboFit. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default CoachBuilderLanding; 