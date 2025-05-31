import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../main';
import { toast } from 'react-hot-toast';

const CoachAvatarEdit = () => {
  const navigate = useNavigate();
  const { coachId } = useParams();
  const [coach, setCoach] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [generateMethod, setGenerateMethod] = useState('upload'); // 'upload' or 'generate'
  
  // Avatar generation state
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedAvatars, setGeneratedAvatars] = useState([]);
  const [selectedAvatar, setSelectedAvatar] = useState(null);

  const avatarStyles = [
    { value: 'realistic', label: 'Realistic Photo' },
    { value: 'professional', label: 'Professional Headshot' },
    { value: 'cartoon', label: 'Cartoon Style' },
    { value: 'fitness', label: 'Fitness Coach' },
    { value: 'athletic', label: 'Athletic Portrait' }
  ];

  useEffect(() => {
    if (coachId) {
      fetchCoach();
    }
  }, [coachId]);

  const fetchCoach = async () => {
    try {
      const { data: coachData, error } = await supabase
        .from('coach_profiles')
        .select('*')
        .eq('id', coachId)
        .single();

      if (error) throw error;
      setCoach(coachData);
      
      // Set up default prompt based on coach data
      setAvatarPrompt(`A ${coachData.primary_response_style || 'motivational'} fitness coach`);
    } catch (error) {
      console.error('Error fetching coach:', error);
      toast.error('Failed to load coach data');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      toast.error('Image must be less than 5MB');
      return;
    }

    try {
      setUploading(true);

      // Upload to Supabase storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${coachId}-avatar-${Date.now()}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('coach-avatars')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('coach-avatars')
        .getPublicUrl(fileName);

      // Update coach profile
      const { error: updateError } = await supabase
        .from('coach_profiles')
        .update({ 
          avatar_url: urlData.publicUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', coachId);

      if (updateError) throw updateError;

      setCoach(prev => ({ ...prev, avatar_url: urlData.publicUrl }));
      toast.success('Avatar uploaded successfully!');
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast.error('Failed to upload avatar');
    } finally {
      setUploading(false);
    }
  };

  const generateAvatars = async () => {
    if (!avatarPrompt.trim()) {
      toast.error('Please enter a description for your avatar');
      return;
    }

    try {
      setGenerating(true);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/motivational-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: avatarPrompt,
          style: 'portrait',
          count: 4 // Generate 4 options
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate avatars');
      }

      const data = await response.json();
      setGeneratedAvatars(data.images || []);
      toast.success('Avatars generated successfully!');
    } catch (error) {
      console.error('Error generating avatars:', error);
      toast.error('Failed to generate avatars');
    } finally {
      setGenerating(false);
    }
  };

  const selectGeneratedAvatar = async (avatarUrl) => {
    try {
      setUploading(true);

      // Update coach profile with selected avatar
      const { error } = await supabase
        .from('coach_profiles')
        .update({ 
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', coachId);

      if (error) throw error;

      setCoach(prev => ({ ...prev, avatar_url: avatarUrl }));
      setSelectedAvatar(avatarUrl);
      toast.success('Avatar updated successfully!');
    } catch (error) {
      console.error('Error updating avatar:', error);
      toast.error('Failed to update avatar');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading coach...</p>
        </div>
      </div>
    );
  }

  if (!coach) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Coach Not Found</h1>
        <button
          onClick={() => navigate('/my-coaches')}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
        >
          ← Back to My Coaches
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(`/my-coaches/${coachId}/edit`)}
                className="text-gray-600 hover:text-gray-800 p-2 hover:bg-gray-100 rounded-lg"
                title="Back to Coach Edit"
              >
                ←
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Edit Avatar</h1>
                <p className="text-gray-600">Update your coach's profile picture</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Current Avatar */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Avatar</h2>
          <div className="flex items-center gap-4">
            {coach.avatar_url ? (
              <img
                src={coach.avatar_url}
                alt={`${coach.name} avatar`}
                className="w-24 h-24 object-cover rounded-full border-4 border-gray-200"
              />
            ) : (
              <div className="w-24 h-24 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-2xl">
                {coach.name.charAt(0)}
              </div>
            )}
            <div>
              <h3 className="font-medium text-gray-900">{coach.name}</h3>
              <p className="text-gray-600">@{coach.handle}</p>
              <p className="text-sm text-gray-500">
                {coach.avatar_url ? 'Custom avatar' : 'Default avatar'}
              </p>
            </div>
          </div>
        </div>

        {/* Method Selection */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Choose Method</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => setGenerateMethod('upload')}
              className={`p-4 border-2 rounded-lg text-left transition-colors ${
                generateMethod === 'upload'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-2">📁</div>
              <h3 className="font-medium text-gray-900">Upload Image</h3>
              <p className="text-sm text-gray-600">Upload your own photo or image</p>
            </button>
            
            <button
              onClick={() => setGenerateMethod('generate')}
              className={`p-4 border-2 rounded-lg text-left transition-colors ${
                generateMethod === 'generate'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-2">🎨</div>
              <h3 className="font-medium text-gray-900">Generate Avatar</h3>
              <p className="text-sm text-gray-600">Create an AI-generated portrait</p>
            </button>
          </div>
        </div>

        {/* Upload Section */}
        {generateMethod === 'upload' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload New Avatar</h2>
            <div className="mb-4">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                disabled={uploading}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-sm text-gray-500 mt-2">
                Accepted formats: JPG, PNG, GIF. Max size: 5MB
              </p>
            </div>
            {uploading && (
              <div className="flex items-center gap-2 text-blue-600">
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-blue-600"></div>
                <span>Uploading...</span>
              </div>
            )}
          </div>
        )}

        {/* Generate Section */}
        {generateMethod === 'generate' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Generate Avatar</h2>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Avatar Description
              </label>
              <textarea
                value={avatarPrompt}
                onChange={(e) => setAvatarPrompt(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Describe your ideal avatar (e.g., 'A confident fitness coach with a warm smile')"
              />
              <p className="text-sm text-gray-500 mt-1">
                Be descriptive but keep it professional. This will be your coach's face.
              </p>
            </div>

            <button
              onClick={generateAvatars}
              disabled={generating || !avatarPrompt.trim()}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {generating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                  Generating...
                </>
              ) : (
                'Generate Avatars'
              )}
            </button>

            {/* Generated Avatars */}
            {generatedAvatars.length > 0 && (
              <div className="mt-6">
                <h3 className="text-md font-medium text-gray-900 mb-4">Choose Your Avatar</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {generatedAvatars.map((avatar, index) => (
                    <div key={index} className="relative">
                      <img
                        src={avatar.url}
                        alt={`Generated avatar ${index + 1}`}
                        className={`w-full aspect-square object-cover rounded-lg cursor-pointer border-4 transition-all ${
                          selectedAvatar === avatar.url
                            ? 'border-blue-500 ring-2 ring-blue-500 ring-offset-2'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => selectGeneratedAvatar(avatar.url)}
                      />
                      {selectedAvatar === avatar.url && (
                        <div className="absolute -top-2 -right-2 bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">
                          ✓
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Help Text */}
        <div className="mt-6 bg-blue-50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-900 mb-2">💡 Avatar Tips</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Choose an avatar that represents your coaching style and personality</li>
            <li>• Professional and friendly images work best for building trust</li>
            <li>• Make sure the image is clear and well-lit</li>
            <li>• Square images (1:1 ratio) work best for profile pictures</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default CoachAvatarEdit; 