/*
  # Create user profiles table for workout motivation app

  1. New Tables
    - `user_profiles`
      - `id` (uuid, primary key)
      - `full_name` (text, not null)
      - `phone_number` (text, not null, unique)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `user_profiles` table
    - Add policy for inserting new profiles
    - Add policy for reading profiles (admin only)
*/

CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone_number text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(phone_number)
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Policy to allow anyone to insert their profile
CREATE POLICY "Allow public profile creation"
  ON user_profiles
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Policy to allow only authenticated users to read profiles (for admin purposes)
CREATE POLICY "Allow authenticated users to read profiles"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (true);