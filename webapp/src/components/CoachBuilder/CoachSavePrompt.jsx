import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../main';
import { useCoachBuilder } from '../../contexts/CoachBuilderContext';
import ProgressStepper from './components/ProgressStepper';
import Background from './components/Background';

const CoachSavePrompt = () => {
  const navigate = useNavigate();
  const { 
    coachData, 
    saveCoach, 
    resetCoachData, 
    prevStep,
    validateCoachData,
    isProcessing
  } = useCoachBuilder();
  
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error) {
        console.error('Error getting user:', error);
        setUser(null);
        setLoading(false);
        return;
      }

      if (user) {
        setUser(user);
        
        // Get user profile to get email
        let normalizedPhone = user.phone;
        if (normalizedPhone && !normalizedPhone.startsWith('+')) {
          if (normalizedPhone.length === 10 && /^[2-9]\d{9}$/.test(normalizedPhone)) {
            normalizedPhone = `+1${normalizedPhone}`;
          } else if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
            normalizedPhone = `+${normalizedPhone}`;
          }
        }

        if (normalizedPhone) {
          const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('phone_number', normalizedPhone)
            .single();

          if (profileError) {
            console.error('Error getting user profile:', profileError);
          } else {
            setUserProfile(profile);
          }
        }
      }
    } catch (error) {
      console.error('Error checking user:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCoach = async () => {
    if (!userProfile) {
      setSaveError('Unable to find user profile. Please try logging in again.');
      return;
    }

    // Validate coach data before attempting to save
    const validation = validateCoachData();
    if (!validation.isValid) {
      setSaveError(`Please complete the following required fields:\n• ${validation.errors.join('\n• ')}`);
      return;
    }

    try {
      setSaveError('');
      const savedCoach = await saveCoach(userProfile.email);
      setSaveSuccess(true);
      
      // Redirect to My Coaches after a short delay
      setTimeout(() => {
        resetCoachData();
        navigate('/my-coaches');
      }, 2000);
    } catch (error) {
      setSaveError(error.message || 'Failed to save coach. Please try again.');
    }
  };

  const handleLogin = () => {
    // Store current coach data in sessionStorage before redirect
    sessionStorage.setItem('pendingCoachData', JSON.stringify(coachData));
    navigate('/login', { state: { from: { pathname: '/coach-builder/save' } } });
  };

  const handlePrev = () => {
    prevStep();
    navigate('/coach-builder/preview');
  };

  const handleStartOver = () => {
    resetCoachData();
    navigate('/coach-builder');
  };

  const handleGoToPersonality = () => {
    navigate('/coach-builder/personality');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (saveSuccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-sm p-8 max-w-md text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Coach Saved!</h1>
          <p className="text-gray-600 mb-4">
            Your AI coach has been successfully created and saved.
          </p>
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-sm text-gray-500 mt-2">Redirecting to My Coaches...</p>
        </div>
      </div>
    );
  }

  return (
    <Background>
      {/* Header */}
      <div className="bg-white/80 backdrop-blur shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <ProgressStepper />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white/90 backdrop-blur rounded-lg shadow-sm p-8">
          {!user ? (
            // Not logged in
            <>
              <div className="text-center mb-8">
                <div className="text-6xl mb-4">🔐</div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  Save Your AI Coach
                </h1>
                <p className="text-lg text-gray-600">
                  You need to be logged in to save your coach and start using it.
                </p>
              </div>

              {/* Coach Summary */}
              <div className="bg-blue-50 rounded-lg p-6 mb-8">
                <h2 className="font-semibold text-blue-900 mb-3">Your Coach Summary</h2>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-blue-700">Name:</span>
                    <span className="font-medium">{coachData.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-700">Handle:</span>
                    <span className="font-medium">@{coachData.handle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-700">Style:</span>
                    <span className="font-medium capitalize">
                      {coachData.primary_response_style?.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-700">Content Files:</span>
                    <span className="font-medium">
                      {coachData.content?.length || 0}
                      {(!coachData.content || coachData.content.length === 0) && 
                        <span className="text-blue-600 text-xs ml-1">(can add later)</span>
                      }
                    </span>
                  </div>
                </div>
              </div>

              {/* Login Options */}
              <div className="space-y-4">
                <button
                  onClick={handleLogin}
                  className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 font-medium text-lg"
                >
                  Login to Save Coach
                </button>
                
                <div className="text-center">
                  <p className="text-sm text-gray-600 mb-4">
                    Don't have an account? You'll be able to create one after login.
                  </p>
                  
                  <div className="flex justify-center space-x-4">
                    <button
                      onClick={handlePrev}
                      className="text-gray-600 hover:text-gray-800 text-sm"
                    >
                      ← Back to Preview
                    </button>
                    <button
                      onClick={handleStartOver}
                      className="text-gray-600 hover:text-gray-800 text-sm"
                    >
                      Start Over
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            // Logged in - show save interface
            <>
              <div className="text-center mb-8">
                <div className="text-6xl mb-4">💾</div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  Ready to Save!
                </h1>
                <p className="text-lg text-gray-600">
                  You're logged in as {userProfile?.email || user.email}. 
                  Your coach will be saved to your account.
                </p>
              </div>

              {/* Coach Summary */}
              <div className="bg-green-50 rounded-lg p-6 mb-8">
                <h2 className="font-semibold text-green-900 mb-3">Final Coach Details</h2>
                <div className="space-y-3">
                  <div>
                    <span className="text-green-700 font-medium">Name:</span>
                    <span className="ml-2">
                      {coachData.name || <span className="text-red-500 italic">Not provided</span>}
                    </span>
                  </div>
                  <div>
                    <span className="text-green-700 font-medium">Handle:</span>
                    <span className="ml-2">
                      @{coachData.handle || <span className="text-red-500 italic">Not provided</span>}
                    </span>
                  </div>
                  <div>
                    <span className="text-green-700 font-medium">Response Style:</span>
                    <span className="ml-2 capitalize">
                      {coachData.primary_response_style?.replace('_', ' ') || 
                       <span className="text-red-500 italic">Not selected - complete personality questionnaire</span>}
                    </span>
                  </div>
                  <div>
                    <span className="text-green-700 font-medium">Content Files:</span>
                    <span className="ml-2">
                      {coachData.content?.length || 0} uploaded
                      {(!coachData.content || coachData.content.length === 0) && 
                        <span className="text-green-600 text-sm ml-1">(you can add content files later to improve your coach's responses)</span>
                      }
                    </span>
                  </div>
                  {coachData.description && (
                    <div>
                      <span className="text-green-700 font-medium">Description:</span>
                      <p className="mt-1 text-sm text-gray-700">{coachData.description}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Error Message */}
              {saveError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                  <div className="flex items-start">
                    <div className="text-red-400 mr-2">⚠️</div>
                    <div>
                      <h3 className="text-red-800 font-medium mb-1">Unable to Save Coach</h3>
                      <div className="text-red-700 text-sm whitespace-pre-line">{saveError}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Validation Helper */}
              {(() => {
                const validation = validateCoachData();
                if (!validation.isValid) {
                  return (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                      <div className="flex items-start">
                        <div className="text-yellow-400 mr-2">⚠️</div>
                        <div className="flex-1">
                          <h3 className="text-yellow-800 font-medium mb-2">Complete Required Fields</h3>
                          <div className="space-y-2">
                            {validation.errors.map((error, index) => (
                              <div key={index} className="text-yellow-700 text-sm">• {error}</div>
                            ))}
                          </div>
                          {!coachData.primary_response_style && (
                            <button
                              onClick={handleGoToPersonality}
                              className="mt-3 text-sm bg-yellow-100 text-yellow-800 px-3 py-1 rounded hover:bg-yellow-200"
                            >
                              Complete Personality Questionnaire →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Save Button */}
              <div className="space-y-4">
                {(() => {
                  const validation = validateCoachData();
                  const isDisabled = isProcessing || !validation.isValid;
                  
                  return (
                    <button
                      onClick={handleSaveCoach}
                      disabled={isDisabled}
                      className={`w-full py-3 px-6 rounded-lg font-medium text-lg ${
                        isDisabled
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      {isProcessing ? (
                        <div className="flex items-center justify-center">
                          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
                          Saving Coach...
                        </div>
                      ) : !validation.isValid ? (
                        'Complete Required Fields First'
                      ) : (
                        'Save My AI Coach'
                      )}
                    </button>
                  );
                })()}
                
                <div className="flex justify-center space-x-4">
                  <button
                    onClick={handlePrev}
                    disabled={isProcessing}
                    className="text-gray-600 hover:text-gray-800 text-sm disabled:opacity-50"
                  >
                    ← Back to Preview
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Background>
  );
};

export default CoachSavePrompt; 