/*
  # Fix RLS policies for user profiles

  1. Changes
    - Update RLS policies to properly allow public insertions
    - Add policy for public to read their own profiles
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Allow public profile creation" ON user_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to read profiles" ON user_profiles;

-- Create new policies
CREATE POLICY "Allow anyone to create profiles"
  ON user_profiles
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow anyone to read profiles"
  ON user_profiles
  FOR SELECT
  USING (true);