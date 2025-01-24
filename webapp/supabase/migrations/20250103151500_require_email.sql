/*
  # Make email required in user_profiles
  
  Now that existing data has been updated with email addresses,
  we can safely add the NOT NULL constraint
*/

-- Make email required
ALTER TABLE user_profiles 
ALTER COLUMN email SET NOT NULL; 