/*
  # Add spice level to user profiles
  
  1. Changes
    - Add spice_level column to user_profiles
    - Add constraint to ensure valid values (1-5)
    - Create index for query performance
    
  2. Description
    - spice_level determines intensity of workout messages and images
    - 1 = very gentle
    - 5 = extremely intense
*/

-- Add spice_level column with default of 3 (moderate)
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS spice_level integer DEFAULT 3;

-- Update any existing NULL values to default
UPDATE user_profiles 
SET spice_level = 3 
WHERE spice_level IS NULL;

-- Add constraint to ensure valid values
ALTER TABLE user_profiles 
ADD CONSTRAINT check_spice_level 
CHECK (spice_level >= 1 AND spice_level <= 5);

-- Make the column NOT NULL after setting default values
ALTER TABLE user_profiles 
ALTER COLUMN spice_level SET NOT NULL;

-- Add an index since we'll be querying by spice level
CREATE INDEX IF NOT EXISTS idx_user_profiles_spice_level 
ON user_profiles(spice_level);

-- Add comment explaining the column
COMMENT ON COLUMN user_profiles.spice_level IS 'Workout intensity level (1=gentle to 5=intense) affecting message and image content'; 