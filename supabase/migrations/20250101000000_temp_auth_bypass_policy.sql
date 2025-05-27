-- Temporary policy to allow unauthenticated user lookups for authentication bypass
-- This should be removed when OTP functionality is restored

-- Add a temporary policy that allows SELECT for authentication purposes
CREATE POLICY "Temporary auth bypass - allow user lookup"
    ON public.user_profiles FOR SELECT
    USING (true); -- Allow all reads temporarily

-- Note: This is a TEMPORARY security bypass for development purposes
-- Remove this policy when OTP authentication is working again 