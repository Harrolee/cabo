import React from 'react';
import { Toaster } from 'react-hot-toast';
import { SignUpForm } from './components/SignUpForm';

export function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Daily Workout Motivation
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Sign up to receive daily before/after picture motivation
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <SignUpForm />
        </div>
      </div>
      <Toaster position="top-center" />
    </div>
  );
}

export default App;