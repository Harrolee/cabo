-- Gate coach publishing (setting coach_profiles.public = true) behind an active subscription

-- Helper function: returns true if user (by email) has an active publisher subscription
CREATE OR REPLACE FUNCTION public.can_publish_coaches(user_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM subscriptions s
    JOIN user_profiles u ON u.phone_number = s.user_phone
    WHERE u.email = can_publish_coaches.user_email
      AND s.status = 'active'
  );
$$;

COMMENT ON FUNCTION public.can_publish_coaches(text) IS 'Checks if a user has an active subscription allowing coach publishing';

-- Policy: owners can update their own coaches, but setting public=true requires can_publish_coaches(email)
DROP POLICY IF EXISTS "Users can update their own coaches" ON public.coach_profiles;

CREATE POLICY "Users can update their own coaches"
    ON public.coach_profiles FOR UPDATE
    USING (
        (auth.jwt() ->> 'phone' = (SELECT phone_number FROM user_profiles WHERE email = user_email)) OR
        (('+' || (auth.jwt() ->> 'phone')) = (SELECT phone_number FROM user_profiles WHERE email = user_email))
    )
    WITH CHECK (
        (
          -- Always allow non-public changes
          "public" IS DISTINCT FROM TRUE
        ) OR (
          -- Publishing requires active subscription
          "public" = TRUE AND public.can_publish_coaches(user_email)
        )
    );


