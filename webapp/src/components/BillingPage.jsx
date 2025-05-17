import React from 'react';
import { supabase } from '../main'; // Ensure supabase client is correctly imported
import toast, { Toaster } from 'react-hot-toast'; // Added for notifications
// import { useStripe } from '@stripe/react-stripe-js'; // If Stripe elements are used directly

function BillingPage() {
  // const stripe = useStripe();

  // TODO: Fetch subscription status
  // TODO: Implement cancel subscription logic

  const handleCancelSubscription = async () => {
    // toast.loading('Cancelling subscription...'); // Optional: immediate feedback

    try {
      const { error } = await supabase.functions.invoke('cancel-stripe-subscription', {
        // If your function expects a body, provide it here, e.g.:
        // body: { subscriptionId: 'sub_xxxxxxxxxxxxxx' }, // This would need to be fetched first
      });

      if (error) {
        console.error('Error invoking cancel-stripe-subscription function:', error);
        toast.error(error.message || 'Failed to cancel subscription. Please try again.');
      } else {
        toast.success('Subscription cancellation request processed. It may take a moment to reflect.');
        // TODO: Optionally, re-fetch subscription status here or navigate the user
      }
    } catch (e) {
      console.error('Unexpected error during subscription cancellation:', e);
      toast.error('An unexpected error occurred. Please contact support.');
    }
  };

  return (
    <div className="p-4">
      <Toaster position="top-center" /> 
      <h1 className="text-2xl font-bold mb-4">Billing Management</h1>
      <p>Current plan details and cancellation options will go here.</p>
      {/* TODO: Display current plan, renewal date, etc. */}
      <div className="mt-4">
        <button 
          onClick={handleCancelSubscription} 
          className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
        >
          Cancel Subscription
        </button>
      </div>
    </div>
  );
}

export default BillingPage; 