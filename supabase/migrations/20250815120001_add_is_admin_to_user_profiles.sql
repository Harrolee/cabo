-- Add is_admin flag to user_profiles to control admin access
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false NOT NULL;

-- Helpful index if you ever query admins
CREATE INDEX IF NOT EXISTS user_profiles_is_admin_idx ON public.user_profiles(is_admin);

COMMENT ON COLUMN public.user_profiles.is_admin IS 'Grants access to admin dashboard and admin-only features when true';



