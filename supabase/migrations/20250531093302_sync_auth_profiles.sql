/*
  # Synchronize auth.users and user_profiles
  
  This migration ensures that auth.users and user_profiles are properly linked
  and creates functions to keep them in sync going forward.
*/

-- First, let's see what we're working with
-- Find mismatched records
DO $$
DECLARE
    auth_id UUID;
    profile_id UUID;
    profile_email TEXT;
BEGIN
    -- Get your profile info
    SELECT id, email INTO profile_id, profile_email 
    FROM public.user_profiles 
    WHERE phone_number = '+12533800282';
    
    -- Get the auth user with this email
    SELECT id INTO auth_id 
    FROM auth.users 
    WHERE email = profile_email;
    
    RAISE NOTICE 'Profile ID: %, Auth ID: %, Email: %', profile_id, auth_id, profile_email;
    
    -- If they don't match, fix it
    IF auth_id IS NOT NULL AND auth_id != profile_id THEN
        RAISE NOTICE 'Fixing ID mismatch - updating profile to use auth ID';
        
        -- Update the user_profiles table to use the correct auth ID
        UPDATE public.user_profiles 
        SET id = auth_id 
        WHERE phone_number = '+12533800282';
        
        RAISE NOTICE 'Updated profile ID from % to %', profile_id, auth_id;
    END IF;
END $$;

-- Create a function to handle auth user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- When a new auth user is created, create a corresponding user profile
  INSERT INTO public.user_profiles (id, email, created_at, updated_at)
  VALUES (NEW.id, NEW.email, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET
    email = NEW.email,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically sync new auth users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create a function to get or create a unified user
CREATE OR REPLACE FUNCTION public.get_or_create_user(
  user_email TEXT,
  user_phone TEXT DEFAULT NULL,
  user_full_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  user_id UUID;
  auth_user_id UUID;
BEGIN
  -- First try to find existing auth user by email
  SELECT id INTO auth_user_id FROM auth.users WHERE email = user_email;
  
  IF auth_user_id IS NOT NULL THEN
    -- Auth user exists, ensure profile exists and is synced
    INSERT INTO public.user_profiles (
      id, email, phone_number, full_name, created_at, updated_at
    ) VALUES (
      auth_user_id, user_email, user_phone, user_full_name, NOW(), NOW()
    ) ON CONFLICT (id) DO UPDATE SET
      email = user_email,
      phone_number = COALESCE(user_phone, user_profiles.phone_number),
      full_name = COALESCE(user_full_name, user_profiles.full_name),
      updated_at = NOW();
    
    RETURN auth_user_id;
  ELSE
    -- No auth user exists, this shouldn't happen in normal flow
    -- But we can handle it by creating both
    user_id := gen_random_uuid();
    
    INSERT INTO auth.users (id, email, email_confirmed_at, created_at, updated_at)
    VALUES (user_id, user_email, NOW(), NOW(), NOW());
    
    INSERT INTO public.user_profiles (
      id, email, phone_number, full_name, created_at, updated_at
    ) VALUES (
      user_id, user_email, user_phone, user_full_name, NOW(), NOW()
    );
    
    RETURN user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 