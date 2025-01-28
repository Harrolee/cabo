/*
  # Add image preference to user profiles
  
  1. Changes
    - Add image_preference column to user_profiles
    - Add comment explaining the column's purpose
    - Create index for query performance
    
  2. Description
    - image_preference stores user's preference for what kind of people
      they want to see in their workout motivation images
    - Examples: "female athletes", "older adults", "diverse group of people"
*/

-- Add image_preference column
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS image_preference text;

-- Update any existing NULL values to a default that shows diverse representation
UPDATE user_profiles 
SET image_preference = 'diverse group of people' 
WHERE image_preference IS NULL;

-- Make the column NOT NULL after setting default values
ALTER TABLE user_profiles 
ALTER COLUMN image_preference SET NOT NULL;

-- Add an index since we'll be querying by image preference
CREATE INDEX IF NOT EXISTS idx_user_profiles_image_preference 
ON user_profiles(image_preference);

-- Add comment explaining the column
COMMENT ON COLUMN user_profiles.image_preference IS 'User preference for the type of people shown in workout motivation images'; 