/*
  # Integrate Custom Coaches with User Profiles
  
  This migration adds support for users to select custom coaches alongside predefined coaches
  for their SMS conversations and app experience.
  
  1. Changes to user_profiles table:
    - Add coach_type column (predefined/custom)
    - Add custom_coach_id column (references coach_profiles)
    - Update constraints to support both coach types
  
  2. Maintains backward compatibility with existing predefined coaches
*/

-- Add new columns to user_profiles table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'coach_type'
  ) THEN
    ALTER TABLE public.user_profiles 
    ADD COLUMN coach_type VARCHAR(20) DEFAULT 'predefined' CHECK (coach_type IN ('predefined', 'custom'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'custom_coach_id'
  ) THEN
    ALTER TABLE public.user_profiles 
    ADD COLUMN custom_coach_id UUID REFERENCES public.coach_profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Update the coach column to be nullable (since custom coaches won't use it)
DO $$
BEGIN
  -- Only drop NOT NULL if currently set
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'coach' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.user_profiles ALTER COLUMN coach DROP NOT NULL;
  END IF;
END $$;

-- Add a constraint to ensure either coach (predefined) or custom_coach_id is set
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_coach_selection'
  ) THEN
    ALTER TABLE public.user_profiles 
    ADD CONSTRAINT check_coach_selection 
    CHECK (
      (coach_type = 'predefined' AND coach IS NOT NULL AND custom_coach_id IS NULL) OR
      (coach_type = 'custom' AND custom_coach_id IS NOT NULL AND coach IS NULL)
    );
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_custom_coach ON public.user_profiles(custom_coach_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_coach_type ON public.user_profiles(coach_type);

-- Update existing records to have proper coach_type
UPDATE public.user_profiles 
SET coach_type = COALESCE(coach_type, 'predefined')
WHERE coach IS NOT NULL;

-- Add helpful comments
COMMENT ON COLUMN public.user_profiles.coach_type IS 'Type of coach: predefined (built-in) or custom (user-created)';
COMMENT ON COLUMN public.user_profiles.custom_coach_id IS 'Reference to user-created coach when coach_type is custom';
COMMENT ON CONSTRAINT check_coach_selection ON public.user_profiles IS 'Ensures either predefined coach or custom coach is selected, but not both'; 