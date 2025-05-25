import React from 'react';
import { useCoachBuilder } from '../../../contexts/CoachBuilderContext';

const ProgressStepper = ({ className = '' }) => {
  const { currentStep, steps } = useCoachBuilder();

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center">
            {/* Step Circle */}
            <div className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  index <= currentStep
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {index < currentStep ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              
              {/* Step Label */}
              <div className="ml-2 hidden sm:block">
                <p
                  className={`text-sm font-medium ${
                    index <= currentStep ? 'text-gray-900' : 'text-gray-500'
                  }`}
                >
                  {step.name}
                </p>
              </div>
            </div>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div
                className={`w-8 h-0.5 mx-2 ${
                  index < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Mobile Step Labels */}
      <div className="sm:hidden mt-4 text-center">
        <p className="text-sm font-medium text-gray-900">
          Step {currentStep + 1} of {steps.length}: {steps[currentStep]?.name}
        </p>
      </div>
    </div>
  );
};

export default ProgressStepper; 