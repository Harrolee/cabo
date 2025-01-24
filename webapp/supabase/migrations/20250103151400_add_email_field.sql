/*
  # Add email field to user_profiles
  
  1. Changes
    - Add email column to user_profiles
    - Make email unique
    - Create index for better query performance
  
  Note: We're not setting NOT NULL constraint immediately to handle existing data
*/

-- Add email column
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS email text;

-- Create unique index for email
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email 
ON user_profiles(email)
WHERE email IS NOT NULL;  -- Partial index to allow multiple NULL values

-- Add comment explaining the column
COMMENT ON COLUMN user_profiles.email IS 'User email address for Stripe subscription management';

/* 
  Note: The NOT NULL constraint should be added in a separate migration
  after existing data has been updated with email addresses:

  ALTER TABLE user_profiles 
  ALTER COLUMN email SET NOT NULL;
*/ 