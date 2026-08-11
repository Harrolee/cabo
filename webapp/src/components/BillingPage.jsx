import React, { useEffect, useState } from 'react';
import { supabase } from '../main';
import toast, { Toaster } from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL;

function BillingPage() {
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [userEmail, setUserEmail] = useState(null);

  const fetchSubscription = async () => {
    setLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        toast.error('Please log in to view billing.');
        return;
      }
      setUserEmail(user.email);

      const resp = await fetch(`${API_URL}/get-user-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });

      if (!resp.ok) {
        if (resp.status === 404) {
          setSubscription(null);
        } else {
          toast.error('Could not load subscription details.');
        }
        return;
      }
      const data = await resp.json();
      setSubscription(data);
    } catch (err) {
      console.error('Error loading billing:', err);
      toast.error('Could not load subscription details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscription();
  }, []);

  const handleCancelSubscription = async () => {
    const ok = window.confirm(
      'Cancel your subscription? You will lose access at the end of your current period.'
    );
    if (!ok) return;

    setCancelling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Please log in again to cancel.');
        return;
      }

      const resp = await fetch(`${API_URL}/cancel-stripe-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(result.error || 'Failed to cancel subscription.');
        return;
      }
      if (result.code === 'ALREADY_CANCELLED') {
        toast('Your subscription was already cancelled.');
      } else {
        toast.success('Subscription cancelled.');
      }
      await fetchSubscription();
    } catch (e) {
      console.error('Cancel subscription error:', e);
      toast.error('An unexpected error occurred. Please contact support.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Toaster position="top-center" />
        <p>Loading billing details…</p>
      </div>
    );
  }

  const status = subscription?.subscription_status;
  const trialEnd = subscription?.trial_end ? new Date(subscription.trial_end) : null;
  const isCancelled = status === 'cancelled';
  const canCancel = !!status && !isCancelled;

  return (
    <div className="p-6 max-w-2xl mx-auto bg-white shadow-md rounded-lg">
      <Toaster position="top-center" />
      <h1 className="text-2xl font-bold mb-4">Billing Management</h1>

      {subscription ? (
        <div className="space-y-3 mb-6">
          <div>
            <span className="text-sm text-gray-500">Account</span>
            <div className="font-medium">{userEmail}</div>
          </div>
          <div>
            <span className="text-sm text-gray-500">Status</span>
            <div className="font-medium capitalize">{status || 'unknown'}</div>
          </div>
          {trialEnd && (
            <div>
              <span className="text-sm text-gray-500">
                {trialEnd > new Date() ? 'Trial ends' : 'Trial ended'}
              </span>
              <div className="font-medium">{trialEnd.toLocaleDateString()}</div>
            </div>
          )}
        </div>
      ) : (
        <p className="mb-6 text-gray-600">No subscription found on this account.</p>
      )}

      <div className="mt-4">
        <button
          onClick={handleCancelSubscription}
          disabled={cancelling || !canCancel}
          className="bg-red-500 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded"
        >
          {cancelling
            ? 'Cancelling…'
            : isCancelled
            ? 'Already Cancelled'
            : 'Cancel Subscription'}
        </button>
      </div>
    </div>
  );
}

export default BillingPage;
