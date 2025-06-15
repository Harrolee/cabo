import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { supabase } from '../../main';

export const LoginPage = () => {
  const [loading, setLoading] = useState(false);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const from = location.state?.from?.pathname || "/settings";

  const handlePhoneSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: phone,
      });
      if (error) throw error;
      setShowOtpInput(true);
      toast.success('Check your phone for the verification code!');
    } catch (error) {
      toast.error(error.error_description || error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: phone,
        token: otp,
        type: 'sms'
      });
      if (error) throw error;
      toast.success('Successfully logged in!');
      navigate(from, { replace: true });
    } catch (error) {
      toast.error(error.error_description || error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="p-8 bg-white shadow-md rounded-lg w-full max-w-md">
        <h2 className="text-2xl font-bold text-center mb-6">Sign In</h2>
        {!showOtpInput ? (
          <>
            <p className="text-center mb-4 text-sm text-gray-600">
              Enter your phone number to receive a verification code.
            </p>
            <form onSubmit={handlePhoneSubmit}>
              <input
                type="tel"
                placeholder="+1XXXXXXXXXX"
                value={phone}
                required
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-2 mb-4 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send Verification Code'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-center mb-4 text-sm text-gray-600">
              Enter the verification code sent to {phone}
            </p>
            <form onSubmit={handleOtpSubmit}>
              <input
                type="text"
                placeholder="Enter 6-digit code"
                value={otp}
                required
                onChange={(e) => setOtp(e.target.value)}
                className="w-full px-4 py-2 mb-4 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </button>
            </form>
            <button
              onClick={() => setShowOtpInput(false)}
              className="w-full mt-2 text-sm text-blue-600 hover:text-blue-800"
            >
              Use a different phone number
            </button>
          </>
        )}
        <p className="text-xs text-gray-500 mt-4 text-center">
          If you don't have an account, sign up on our main page.
        </p>
      </div>
    </div>
  );
}; 