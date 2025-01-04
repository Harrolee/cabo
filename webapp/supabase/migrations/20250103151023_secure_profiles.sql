/*
  # Secure profile reading access
  
  1. Changes
    - Remove public read access to profiles
    - Keep public write access for profile creation
    - Only allow service role to read profiles (bypasses RLS)
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Allow anyone to read profiles" ON user_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to read profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;

-- Keep the insert policy
DROP POLICY IF EXISTS "Allow anyone to create profiles" ON user_profiles;
CREATE POLICY "Allow anyone to create profiles"
  ON user_profiles
  FOR INSERT
  WITH CHECK (true);

-- No SELECT policies means only service role can read
-- Service role bypasses RLS automatically, so we don't need to create any SELECT policies 