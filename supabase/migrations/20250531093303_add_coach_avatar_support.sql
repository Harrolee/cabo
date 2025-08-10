/*
  # Add Coach Avatar Support Migration
  
  Adds avatar functionality to the coach builder system:
  1. Add avatar_url column for generated professional avatar (public)
  2. Add original_selfie_url column for uploaded selfie (private, for regeneration)
  3. Add avatar_style column to track chosen style
  4. Add indexes for performance
*/

-- Add avatar columns to coach_profiles table
DO $$
BEGIN
  -- Add columns if they do not exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'coach_profiles' AND column_name = 'avatar_url'
  ) THEN
    ALTER TABLE public.coach_profiles ADD COLUMN avatar_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'coach_profiles' AND column_name = 'original_selfie_url'
  ) THEN
    ALTER TABLE public.coach_profiles ADD COLUMN original_selfie_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'coach_profiles' AND column_name = 'avatar_style'
  ) THEN
    ALTER TABLE public.coach_profiles ADD COLUMN avatar_style text DEFAULT 'Digital Art';
  END IF;
END $$;

-- Add helpful comments
COMMENT ON COLUMN public.coach_profiles.avatar_url IS 'Generated avatar image URL for the coach (public, displayed in UI)';
COMMENT ON COLUMN public.coach_profiles.original_selfie_url IS 'Original selfie uploaded by coach creator (private, for regeneration)';
COMMENT ON COLUMN public.coach_profiles.avatar_style IS 'Style used for avatar generation (e.g., Digital Art, Comic book, Disney Character)';

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS coach_profiles_avatar_url_idx ON public.coach_profiles(avatar_url);
CREATE INDEX IF NOT EXISTS coach_profiles_avatar_style_idx ON public.coach_profiles(avatar_style);

-- Grant necessary permissions for service role (cloud functions)
GRANT UPDATE ON public.coach_profiles TO service_role;