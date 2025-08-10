/*
  # Allow Public Access to Public Coaches
  
  This migration updates the RLS policies to allow unauthenticated users 
  to read public coaches from the coach_profiles table.
  
  This is needed for the HeroCoachPage to display public custom coaches
  to all users, not just authenticated ones.
*/

-- Drop the existing "Users can view public coaches" policy
DROP POLICY IF EXISTS "Users can view public coaches" ON public.coach_profiles;

-- Drop if the new policy already exists, to make idempotent
DROP POLICY IF EXISTS "Anyone can view public coaches" ON public.coach_profiles;

-- Create a new policy that allows anyone (including unauthenticated users) to view public coaches
CREATE POLICY "Anyone can view public coaches"
    ON public.coach_profiles FOR SELECT
    USING (public = true AND active = true);

-- Also grant SELECT permission to anonymous users for public coaches
GRANT SELECT ON public.coach_profiles TO anon;

-- Add helpful comment
COMMENT ON POLICY "Anyone can view public coaches" ON public.coach_profiles IS 'Allows unauthenticated users to view public coaches for the HeroCoachPage'; 