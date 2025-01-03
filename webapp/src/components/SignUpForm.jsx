import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { createUserProfile } from '../lib/api';

export function SignUpForm() {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    phone_number: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await createUserProfile(formData);
      toast.success('Successfully signed up!');
      setFormData({ full_name: '', phone_number: '' });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-gray-700">
          Full Name
        </label>
        <input
          type="text"
          id="fullName"
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          value={formData.full_name}
          onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
          Phone Number
        </label>
        <input
          type="tel"
          id="phone"
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          value={formData.phone_number}
          onChange={(e) => setFormData(prev => ({ ...prev, phone_number: e.target.value }))}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
      >
        {loading ? 'Signing up...' : 'Sign Up'}
      </button>
    </form>
  );
}