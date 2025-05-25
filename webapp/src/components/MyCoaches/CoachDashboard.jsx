import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../main';
import { toast } from 'react-hot-toast';

const CoachDashboard = () => {
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetchCoaches();
  }, []);

  const fetchCoaches = async () => {
    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      
      if (!user) {
        setLoading(false);
        return;
      }

      setUser(user);

      // Get user's coaches
      const { data: coachData, error: coachError } = await supabase
        .from('coach_profiles')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (coachError) throw coachError;

      setCoaches(coachData || []);
    } catch (error) {
      console.error('Error fetching coaches:', error);
      toast.error('Failed to load your coaches');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your coaches...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My AI Coaches</h1>
          <p className="text-gray-600 mt-2">Manage your AI coaching personalities</p>
        </div>
        <Link
          to="/coach-builder"
          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium"
        >
          + Create New Coach
        </Link>
      </div>

      {coaches.length === 0 ? (
        // Empty state
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🤖</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No AI Coaches Yet</h2>
          <p className="text-gray-600 mb-8 max-w-md mx-auto">
            Create your first AI coach to start engaging with your audience through personalized SMS messages.
          </p>
          <Link
            to="/coach-builder"
            className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 font-medium text-lg"
          >
            Create Your First Coach
          </Link>
        </div>
      ) : (
        // Coaches grid
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {coaches.map((coach) => (
            <div key={coach.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{coach.name}</h3>
                  <p className="text-sm text-gray-600">@{coach.handle}</p>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                  coach.active 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {coach.active ? 'Active' : 'Inactive'}
                </div>
              </div>

              {coach.description && (
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                  {coach.description}
                </p>
              )}

              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Style:</span>
                  <span className="font-medium capitalize">
                    {coach.primary_response_style?.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Conversations:</span>
                  <span className="font-medium">{coach.total_conversations || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Content:</span>
                  <span className="font-medium">
                    {coach.content_processed ? 'Processed' : 'Pending'}
                  </span>
                </div>
              </div>

              <div className="flex space-x-2">
                <button className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 text-sm font-medium">
                  Edit
                </button>
                <button className="flex-1 bg-blue-100 text-blue-700 px-4 py-2 rounded-lg hover:bg-blue-200 text-sm font-medium">
                  Analytics
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CoachDashboard; 