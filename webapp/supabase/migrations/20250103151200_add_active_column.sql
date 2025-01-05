-- Add active column to user_profiles
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;

-- Update existing rows to have active = true
UPDATE user_profiles 
SET active = true 
WHERE active IS NULL;

-- Make the column NOT NULL after setting default values
ALTER TABLE user_profiles 
ALTER COLUMN active SET NOT NULL;

-- Add an index for better query performance since we filter on this column
CREATE INDEX IF NOT EXISTS idx_user_profiles_active 
ON user_profiles(active); 