import React, { useState, useEffect } from 'react';
import { supabase } from '../main'; // Assuming supabase client is exported from main
import { toast } from 'react-hot-toast';

function SettingsPage() {
  const [coach, setCoach] = useState('');
  const [coachType, setCoachType] = useState('predefined');
  const [customCoachId, setCustomCoachId] = useState('');
  const [spiceLevel, setSpiceLevel] = useState(2);
  const [imagePreference, setImagePreference] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [userPhone, setUserPhone] = useState(null);
  const [customCoaches, setCustomCoaches] = useState([]);

  const predefinedCoachOptions = [
    'zen_master',
    'gym_bro', 
    'dance_teacher',
    'drill_sergeant',
    'frat_bro'
  ];

  useEffect(() => {
    const fetchUserData = async () => {
      setInitialLoading(true);
      console.log("fetchUserData called");
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      console.log("Full auth user object:", user);

      if (userError) {
        toast.error("Error fetching user authentication data. Please try logging in again.");
        console.error("Error fetching auth user:", userError);
        setInitialLoading(false);
        return;
      }

      if (user) {
        console.log(`User details - ID: ${user.id}, Email: ${user.email}, Phone: ${user.phone}`);
        setUserId(user.id);

        let normalizedPhone = user.phone;
        if (normalizedPhone && !normalizedPhone.startsWith('+')) {
          // Assuming North American numbers based on your previous DB constraint
          // If it's a 10-digit number, prepend +1. If it's 11 digits starting with 1, prepend +.
          if (normalizedPhone.length === 10 && /^[2-9]\d{9}$/.test(normalizedPhone)) {
            normalizedPhone = `+1${normalizedPhone}`;
          } else if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
            normalizedPhone = `+${normalizedPhone}`;
          }
          // Add more robust normalization if other international formats are expected from auth
          console.log(`Normalized user.phone from '${user.phone}' to '${normalizedPhone}'`);
        }

        setUserPhone(normalizedPhone);

        if (!normalizedPhone) {
          console.warn("User phone from auth is null or empty, even after normalization attempt.");
          toast.error("Your phone number is not available from authentication. Cannot load or save settings.");
          setInitialLoading(false);
          return;
        }

        // Fetch user profile with coach information
        const { data, error } = await supabase
          .from('user_profiles')
          .select(`
            coach, 
            coach_type, 
            custom_coach_id, 
            spice_level, 
            image_preference,
            coach_profiles!custom_coach_id(id, name, handle)
          `)
          .eq('phone_number', normalizedPhone)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            toast.error("Your user profile was not found using your phone number. Please contact support or try re-registering.");
            console.error(`Profile not found (PGRST116) for normalized phone: '${normalizedPhone}', Original auth phone: '${user.phone}'`, error);
          } else {
            toast.error("Failed to load your settings.");
            console.error("Error fetching profile (other than PGRST116):", error);
          }
        } else if (data) {
          console.log("Profile data fetched using phone:", data);
          setCoachType(data.coach_type || 'predefined');
          setCoach(data.coach || '');
          setCustomCoachId(data.custom_coach_id || '');
          setSpiceLevel(data.spice_level);
          setImagePreference(data.image_preference);
          toast.success("Settings loaded.");
        }

        // Fetch user's custom coaches
        const { data: coachData, error: coachError } = await supabase
          .from('coach_profiles')
          .select('id, name, handle, active')
          .eq('user_id', user.id)
          .eq('active', true)
          .order('name');

        if (coachError) {
          console.error("Error fetching custom coaches:", coachError);
        } else {
          setCustomCoaches(coachData || []);
        }
      } else {
        toast.error("No user logged in. Please log in again.");
        console.log("No user object returned from supabase.auth.getUser()");
      }
      setInitialLoading(false);
    };

    fetchUserData();
  }, []);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    console.log("handleSaveSettings called. Current userPhone state (should be normalized):", userPhone);

    if (!userPhone) {
      toast.error("User phone number not identified. Cannot save settings.");
      console.error("Save aborted: userPhone (normalized) is not set.");
      return;
    }

    setLoading(true);
    console.log("Attempting to save settings with:", { 
      coach, 
      coachType, 
      customCoachId, 
      spiceLevel, 
      imagePreference, 
      userPhone 
    });

    try {
      const updateData = {
        coach_type: coachType,
        spice_level: Number(spiceLevel),
        image_preference: imagePreference,
      };

      if (coachType === 'predefined') {
        updateData.coach = coach;
        updateData.custom_coach_id = null;
      } else {
        updateData.coach = null;
        updateData.custom_coach_id = customCoachId;
      }

      const { data, error } = await supabase
        .from('user_profiles')
        .update(updateData)
        .eq('phone_number', userPhone)
        .select();

      if (error) {
        console.error("Supabase update error:", error);
        throw error;
      }
      toast.success("Settings saved successfully!");
      console.log("Settings saved successfully, updated data:", data);
    } catch (error) {
      toast.error(`Failed to save settings: ${error.message}`);
      console.error("Error saving settings (catch block):", error);
    } finally {
      setLoading(false);
      console.log("setLoading(false) called in finally block");
    }
  };

  if (initialLoading) {
    return (
      <div className="p-4 flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        <p className="ml-3 text-lg">Loading settings...</p>
      </div>
    );
  }
  
  return (
    <div className="p-6 max-w-2xl mx-auto bg-white shadow-md rounded-lg">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">App Settings</h1>
      <p className="mb-6 text-gray-600">Customize your workout experience.</p>
      
      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Coach Type Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Coach Type
          </label>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                value="predefined"
                checked={coachType === 'predefined'}
                onChange={(e) => setCoachType(e.target.value)}
                className="mr-2"
              />
              <span>Predefined Coaches</span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="custom"
                checked={coachType === 'custom'}
                onChange={(e) => setCoachType(e.target.value)}
                className="mr-2"
                disabled={customCoaches.length === 0}
              />
              <span>My Custom Coaches {customCoaches.length === 0 && '(Create one first)'}</span>
            </label>
          </div>
        </div>

        {/* Predefined Coach Selection */}
        {coachType === 'predefined' && (
          <div>
            <label htmlFor="coach" className="block text-sm font-medium text-gray-700 mb-1">
              Preferred Coach
            </label>
            <select 
              id="coach" 
              value={coach} 
              onChange={(e) => setCoach(e.target.value)}
              className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              required
            >
              <option value="">Select a coach...</option>
              {predefinedCoachOptions.map(option => (
                <option key={option} value={option}>
                  {option.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">Choose the coaching style that motivates you best.</p>
          </div>
        )}

        {/* Custom Coach Selection */}
        {coachType === 'custom' && (
          <div>
            <label htmlFor="customCoach" className="block text-sm font-medium text-gray-700 mb-1">
              Your Custom Coach
            </label>
            <select 
              id="customCoach" 
              value={customCoachId} 
              onChange={(e) => setCustomCoachId(e.target.value)}
              className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              required
            >
              <option value="">Select your coach...</option>
              {customCoaches.map(coach => (
                <option key={coach.id} value={coach.id}>
                  {coach.name} (@{coach.handle})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Choose from your custom AI coaches. 
              <a href="/coach-builder" className="text-indigo-600 hover:text-indigo-500 ml-1">
                Create a new one →
              </a>
            </p>
          </div>
        )}

        <div>
          <label htmlFor="spiceLevel" className="block text-sm font-medium text-gray-700 mb-1">
            Spice Level (1-5)
          </label>
          <input 
            type="number" 
            id="spiceLevel" 
            min="1" 
            max="5" 
            value={spiceLevel} 
            onChange={(e) => setSpiceLevel(parseInt(e.target.value, 10))}
            className="mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            required
          />
          <p className="mt-1 text-xs text-gray-500">How intense do you want your motivational messages and image suggestions? (1=Mild, 5=Very Intense)</p>
        </div>

        <div>
          <label htmlFor="imagePreference" className="block text-sm font-medium text-gray-700 mb-1">
            Image Preference
          </label>
          <input 
            type="text" 
            id="imagePreference" 
            value={imagePreference} 
            onChange={(e) => setImagePreference(e.target.value)}
            placeholder="e.g., 'solo athletes', 'nature scenes', 'group workouts'"
            className="mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            required
          />
           <p className="mt-1 text-xs text-gray-500">Describe the type of imagery you find most motivating.</p>
        </div>

        <button 
          type="submit" 
          disabled={loading || initialLoading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}

export default SettingsPage; 