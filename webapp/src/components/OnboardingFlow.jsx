import React from 'react';
import { MobileOnboarding } from './MobileOnboarding';
import { DesktopOnboarding } from './DesktopOnboarding';
import { SignUpForm } from './SignUpForm';

export function OnboardingFlow({ 
  handleInitialSubscribe, 
  onSubscribe, 
  isMobile, 
  showSignupForm
}) {
  if (showSignupForm) {
    return <SignUpForm onSubscribe={onSubscribe} />;
  }

  return isMobile ? (
    <MobileOnboarding 
      handleInitialSubscribe={handleInitialSubscribe}
    />
  ) : (
    <DesktopOnboarding 
      handleInitialSubscribe={handleInitialSubscribe}
    />
  );
} 