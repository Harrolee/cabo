import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Toaster, toast } from 'react-hot-toast';
import { supabase } from './main';
import { LoginPage } from './components/auth/LoginPage';
import { AuthenticatedLayout } from './components/layout/AuthenticatedLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { MainAppContent } from './components/MainAppContent';
import { STRIPE_PUBLIC_KEY } from './constants';
import SettingsPage from './components/SettingsPage';
import BillingPage from './components/BillingPage';
import HeroCoachPage from './components/HeroCoachPage';

// Coach Builder imports
import { CoachBuilderProvider } from './contexts/CoachBuilderContext';
import CoachBuilderLanding from './components/CoachBuilder/CoachBuilderLanding';
import PersonalityQuestionnaire from './components/CoachBuilder/PersonalityQuestionnaire';
import ContentUpload from './components/CoachBuilder/ContentUpload';
import AvatarUpload from './components/CoachBuilder/AvatarUpload';
import CoachPreview from './components/CoachBuilder/CoachPreview';
import CoachSavePrompt from './components/CoachBuilder/CoachSavePrompt';
import CoachDashboard from './components/MyCoaches/CoachDashboard';
import CoachContentManager from './components/MyCoaches/CoachContentManager';
import CoachEdit from './components/MyCoaches/CoachEdit';
import CoachAvatarEdit from './components/MyCoaches/CoachAvatarEdit';
import AdminDashboard from './components/AdminDashboard';
import { AdminProtectedRoute } from './components/AdminProtectedRoute';

const stripePromise = loadStripe(STRIPE_PUBLIC_KEY);



export function App() {
  // Authentication state
  const [session, setSession] = useState(null);
  
  // Application state
  const [userData, setUserData] = useState(null);
  const [urlParams] = useState(() => new URLSearchParams(window.location.search));
  const [isPaymentFlow] = useState(() => Boolean(urlParams.get('email')));
  const [showInitialScreen, setShowInitialScreen] = useState(true);
  const [showSignupForm, setShowSignupForm] = useState(true);
  
  // Loading state management
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [hasAppLoaded, setHasAppLoaded] = useState(false);
  const [isMainContentLoading, setIsMainContentLoading] = useState(true);
  const [hasMainContentLoaded, setHasMainContentLoaded] = useState(false);

  // Initialize authentication
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Initialize app state
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const emailParam = urlParams.get('email');
        if (emailParam) {
          setUserData({ email: emailParam });
          setShowInitialScreen(false);
          setShowSignupForm(false);
        }
      } catch (error) {
        console.error('Error loading user data:', error);
        toast.error('Unable to load your information. Please try signing up again.');
      } finally {
        const delay = urlParams.get('email') ? 0 : 1000;
        setTimeout(() => {
          setIsAppLoading(false);
          setHasAppLoaded(true);
          setTimeout(() => {
            setIsMainContentLoading(false);
            setHasMainContentLoaded(true);
          }, 500);
        }, delay);
      }
    };

    initializeApp();
  }, [urlParams]);

  return (
    <>
    <Toaster position="top-center" />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/coaches" element={<HeroCoachPage />} />
      
      {/* Coach Builder - Unauthenticated Routes */}
      <Route path="/coach-builder/*" element={
        <CoachBuilderProvider>
          <Routes>
            <Route index element={<CoachBuilderLanding />} />
            <Route path="personality" element={<PersonalityQuestionnaire />} />
            <Route path="content" element={<ContentUpload />} />
            <Route path="avatar" element={<AvatarUpload />} />
            <Route path="preview" element={<CoachPreview />} />
            <Route path="save" element={<CoachSavePrompt />} />
          </Routes>
        </CoachBuilderProvider>
      } />
      
      <Route element={<ProtectedRoute session={session}><AuthenticatedLayout session={session} /></ProtectedRoute>}>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/my-coaches" element={<CoachDashboard />} />
        <Route path="/my-coaches/:coachId/content" element={<CoachContentManager />} />
        <Route path="/my-coaches/:coachId/edit" element={<CoachEdit />} />
        <Route path="/my-coaches/:coachId/avatar" element={<CoachAvatarEdit />} />
        <Route path="/admin" element={<AdminProtectedRoute session={session}><AdminDashboard /></AdminProtectedRoute>} />
      </Route>

      <Route path="/*" element={
        <MainAppContent 
          session={session}
          stripePromise={stripePromise}
          isAppLoading={isAppLoading}
          hasAppLoaded={hasAppLoaded}
          isMainContentLoading={isMainContentLoading}
          hasMainContentLoaded={hasMainContentLoaded}
          urlParams={urlParams}
          isPaymentFlow={isPaymentFlow}
          userData={userData}
          setUserData={setUserData}
          showInitialScreen={showInitialScreen}
          setShowInitialScreen={setShowInitialScreen}
          showSignupForm={showSignupForm}
          setShowSignupForm={setShowSignupForm}
        />
      } />
    </Routes>
    </>
  );
}