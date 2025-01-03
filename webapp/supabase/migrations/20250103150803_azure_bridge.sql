/*
  # Update user profiles schema

  1. Changes
    - Rename 'name' column to 'full_name'
    - Ensure table and policies exist with proper configuration
*/

-- First, check if we need to rename the column
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'user_profiles' 
    AND column_name = 'name'
  ) THEN
    ALTER TABLE user_profiles RENAME COLUMN name TO full_name;
  END IF;
END $$;

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone_number text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(phone_number)
);

-- Enable RLS if not already enabled
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist and recreate them
DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Allow public profile creation" ON user_profiles;
  DROP POLICY IF EXISTS "Allow authenticated users to read profiles" ON user_profiles;
END $$;

-- Create policies
CREATE POLICY "Allow public profile creation"
  ON user_profiles
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to read profiles"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (true);