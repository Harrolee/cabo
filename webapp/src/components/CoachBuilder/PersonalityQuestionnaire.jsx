import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCoachBuilder } from '../../contexts/CoachBuilderContext';
import ProgressStepper from './components/ProgressStepper';

const PersonalityQuestionnaire = () => {
  const navigate = useNavigate();
  const { coachData, updatePersonality, nextStep, prevStep } = useCoachBuilder();
  
  const [formData, setFormData] = useState({
    name: coachData.name || '',
    handle: coachData.handle || '',
    description: coachData.description || '',
    primary_response_style: coachData.primary_response_style || '',
    communication_traits: {
      energy_level: 5,
      directness: 5,
      formality: 3,
      emotion_focus: 5,
      // Merge with any existing values, but ensure defaults for missing fields
      ...(coachData.communication_traits || {})
    }
  });

  const [currentQuestion, setCurrentQuestion] = useState(0);

  const questions = [
    {
      id: 'basic_info',
      title: 'Basic Information',
      subtitle: 'Let\'s start with the basics about your AI coach',
      type: 'basic_info'
    },
    {
      id: 'response_style',
      title: 'Response Style',
      subtitle: 'How does your coach typically respond to people?',
      type: 'single_select',
      field: 'primary_response_style',
      options: [
        {
          value: 'tough_love',
          label: 'Tough Love',
          description: 'Challenges users, never coddles, redirects complaints into action'
        },
        {
          value: 'empathetic_mirror',
          label: 'Empathetic Mirror',
          description: 'Validates feelings first, then motivates from understanding'
        },
        {
          value: 'reframe_master',
          label: 'Reframe Master',
          description: 'Always flips negative perspectives into positive growth opportunities'
        },
        {
          value: 'data_driven',
          label: 'Data Driven',
          description: 'Uses facts, studies, and metrics to support advice'
        },
        {
          value: 'story_teller',
          label: 'Story Teller',
          description: 'Responds with personal anecdotes and relatable experiences'
        },
        {
          value: 'cheerleader',
          label: 'Cheerleader',
          description: 'High energy, lots of encouragement and celebration'
        },
        {
          value: 'wise_mentor',
          label: 'Wise Mentor',
          description: 'Calm, thoughtful guidance with deeper life lessons'
        }
      ]
    },
    {
      id: 'communication_style',
      title: 'Communication Style',
      subtitle: 'How does your coach communicate?',
      type: 'sliders',
      sliders: [
        {
          field: 'energy_level',
          label: 'Energy Level',
          low: 'Calm & Steady',
          high: 'High Energy & Intense',
          min: 1,
          max: 10
        },
        {
          field: 'directness',
          label: 'Directness',
          low: 'Gentle & Indirect',
          high: 'Direct & Blunt',
          min: 1,
          max: 10
        },
        {
          field: 'formality',
          label: 'Formality',
          low: 'Casual & Friendly',
          high: 'Professional & Structured',
          min: 1,
          max: 10
        },
        {
          field: 'emotion_focus',
          label: 'Approach',
          low: 'Logic & Facts',
          high: 'Feelings & Emotions',
          min: 1,
          max: 10
        }
      ]
    }
  ];

  // Ensure slider defaults are set when reaching the communication style question
  useEffect(() => {
    const currentQuestionData = questions[currentQuestion];
    if (currentQuestionData?.type === 'sliders') {
      // Ensure all slider fields have default values
      const defaultTraits = {
        energy_level: 5,
        directness: 5,
        formality: 3,
        emotion_focus: 5
      };
      
      setFormData(prev => ({
        ...prev,
        communication_traits: {
          ...defaultTraits,
          ...prev.communication_traits
        }
      }));
    }
  }, [currentQuestion]);

  const handleBasicInfoChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSliderChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      communication_traits: {
        ...prev.communication_traits,
        [field]: value
      }
    }));
  };

  const handleResponseStyleSelect = (value) => {
    setFormData(prev => ({
      ...prev,
      primary_response_style: value
    }));
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
    } else {
      // Save all data and go to next step
      updatePersonality(formData);
      nextStep();
      navigate('/coach-builder/content');
    }
  };

  const handlePrev = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(prev => prev - 1);
    } else {
      prevStep();
      navigate('/coach-builder');
    }
  };

  const isCurrentQuestionValid = () => {
    const question = questions[currentQuestion];
    switch (question.type) {
      case 'basic_info':
        return formData.name.trim() && formData.handle.trim();
      case 'single_select':
        return formData[question.field];
      case 'sliders':
        return true; // Sliders always have default values
      default:
        return true;
    }
  };

  const renderBasicInfo = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Coach Name *
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => handleBasicInfoChange('name', e.target.value)}
          placeholder="e.g., Sarah's Fitness Coach"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <p className="mt-1 text-sm text-gray-500">
          This is how your AI coach will introduce itself
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Handle *
        </label>
        <div className="flex">
          <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500">
            @
          </span>
          <input
            type="text"
            value={formData.handle}
            onChange={(e) => handleBasicInfoChange('handle', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            placeholder="my-coach"
            className="flex-1 px-4 py-3 border border-gray-300 rounded-r-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          A unique identifier for your coach (3-30 characters, letters, numbers, hyphens only)
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Description
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => handleBasicInfoChange('description', e.target.value)}
          placeholder="Describe your coaching philosophy and approach..."
          rows={4}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <p className="mt-1 text-sm text-gray-500">
          Optional: A brief description of your coaching style
        </p>
      </div>
    </div>
  );

  const renderSingleSelect = (question) => (
    <div className="space-y-4">
      {question.options.map((option) => (
        <div
          key={option.value}
          onClick={() => handleResponseStyleSelect(option.value)}
          className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
            formData[question.field] === option.value
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <h3 className="font-semibold text-gray-900 mb-1">{option.label}</h3>
          <p className="text-gray-600 text-sm">{option.description}</p>
        </div>
      ))}
    </div>
  );

  const renderSliders = (question) => (
    <div className="space-y-8">
      <div className="bg-blue-50 rounded-lg p-4 mb-6">
        <p className="text-blue-800 text-sm">
          💡 <strong>Tip:</strong> These sliders are set to balanced defaults. You can adjust them to fine-tune your coach's personality, or leave them as-is if you're happy with the defaults.
        </p>
      </div>
      
      {question.sliders.map((slider) => (
        <div key={slider.field}>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            {slider.label}
          </label>
          <div className="px-4">
            <input
              type="range"
              min={slider.min}
              max={slider.max}
              value={formData.communication_traits[slider.field]}
              onChange={(e) => handleSliderChange(slider.field, parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-sm text-gray-500 mt-2">
              <span>{slider.low}</span>
              <span className="font-medium text-blue-600">
                {formData.communication_traits[slider.field]}
              </span>
              <span>{slider.high}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const currentQuestionData = questions[currentQuestion];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <ProgressStepper />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm p-8">
          {/* Question Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {currentQuestionData.title}
            </h1>
            <p className="text-lg text-gray-600">
              {currentQuestionData.subtitle}
            </p>
          </div>

          {/* Question Content */}
          <div className="mb-8">
            {currentQuestionData.type === 'basic_info' && renderBasicInfo()}
            {currentQuestionData.type === 'single_select' && renderSingleSelect(currentQuestionData)}
            {currentQuestionData.type === 'sliders' && renderSliders(currentQuestionData)}
          </div>

          {/* Navigation */}
          <div className="flex justify-between items-center pt-6 border-t border-gray-200">
            <button
              onClick={handlePrev}
              className="px-6 py-2 text-gray-600 hover:text-gray-800 font-medium"
            >
              ← Back
            </button>

            <div className="text-sm text-gray-500">
              Question {currentQuestion + 1} of {questions.length}
            </div>

            <button
              onClick={handleNext}
              disabled={!isCurrentQuestionValid()}
              className={`px-6 py-2 rounded-lg font-medium ${
                isCurrentQuestionValid()
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {currentQuestion === questions.length - 1 ? 'Continue' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PersonalityQuestionnaire; 