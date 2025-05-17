-- Drop existing email-based RLS policies for user_profiles (if they somehow still exist)
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;

-- Drop the phone-based RLS policies we are about to redefine
DROP POLICY IF EXISTS "Users can view their own profile via phone" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile via phone" ON public.user_profiles;

-- Create new RLS policies for user_profiles using phone number, with flexible matching for JWT claim
CREATE POLICY "Users can view their own profile via phone"
    ON public.user_profiles FOR SELECT
    USING (
        (auth.jwt() ->> 'phone' = phone_number) OR -- Case 1: JWT phone claim has '+' (e.g., '+1253...')
        (('+' || (auth.jwt() ->> 'phone')) = phone_number) -- Case 2: JWT phone claim is missing '+' (e.g., '1253...')
    );

CREATE POLICY "Users can update their own profile via phone"
    ON public.user_profiles FOR UPDATE
    USING (
        (auth.jwt() ->> 'phone' = phone_number) OR
        (('+' || (auth.jwt() ->> 'phone')) = phone_number)
    )
    WITH CHECK (
        (auth.jwt() ->> 'phone' = phone_number) OR
        (('+' || (auth.jwt() ->> 'phone')) = phone_number)
    );

-- Note: The "Allow public profile creation" policy for INSERT operations
-- from the initial schema (20250200950000_initial_schema.sql) is not modified here.
-- It will remain in effect, which is typically desired for signup flows.