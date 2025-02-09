import React, { useState } from 'react';
import toast from 'react-hot-toast';

export function SignUpForm({ onSubscribe }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAgreed, setIsAgreed] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAgreed) {
      alert('You must agree to receive motivational messages.');
      return;
    }

    // Validate North American phone number
    const phoneRegex = /^\+1[2-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      toast.error('Please enter a valid North American phone number (+1 followed by a 10-digit number)');
      return;
    }

    setIsLoading(true);

    try {
      await onSubscribe({
        name,
        email,
        phone
      });
      setName('');
      setPhone('');
      setEmail('');
    } catch (error) {
      console.error('Signup error:', error);
      toast.error(error.message || 'Failed to sign up. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Name
        </label>
        <div className="mt-1">
          <input
            id="name"
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          />
        </div>
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <div className="mt-1">
          <input
            id="email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="you@example.com"
          />
        </div>
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
          Phone Number
        </label>
        <div className="mt-1">
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="+1 followed by your 10-digit number"
          />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Currently only available for North American phone numbers
        </p>
      </div>

      <div className="mt-4 flex items-center">
        <input
          id="marketing-consent"
          name="marketing-consent"
          type="checkbox"
          checked={isAgreed}
          onChange={() => setIsAgreed(!isAgreed)}
          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
        />
        <label htmlFor="marketing-consent" className="ml-2 block text-sm text-gray-900">
          Start my 3-day free trial. I agree to receive daily beach fitness motivation texts from CaboFit at the phone number provided. I have read and agree to the Terms of Service, Privacy Policy, and Message Flow Information. I understand I will receive one message and two motivational images per day. Reply STOP to opt-out, HELP for help. Standard messaging rates may apply.
        </label>
      </div>

      <div>
        <button
          type="submit"
          disabled={isLoading || !isAgreed}
          className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
            isLoading || !isAgreed ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {isLoading ? 'Starting trial...' : 'Sign Up'}
        </button>
      </div>
    </form>
  );
}