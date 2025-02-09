/*
  # Initial schema for workout motivation app
  
  1. Tables
    - user_profiles: Core user data and preferences
    - subscriptions: Subscription and trial management
  
  2. Features
    - Row Level Security (RLS)
    - Automated timestamp management
    - Trial management functions
    - Signup procedure
*/

-- Create subscription status enum
CREATE TYPE subscription_status AS ENUM ('trial', 'active', 'expired', 'cancelled');

-- Create user_profiles table
CREATE TABLE public.user_profiles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    phone_number text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    timezone text DEFAULT 'UTC',
    spice_level integer DEFAULT 3 NOT NULL,
    image_preference text NOT NULL DEFAULT 'diverse group of people',
    CONSTRAINT phone_number_format CHECK (phone_number ~ '^\+[1-9]\d{1,14}$'),
    CONSTRAINT check_spice_level CHECK (spice_level >= 1 AND spice_level <= 5),
    UNIQUE(email),
    UNIQUE(phone_number)
);

-- Create subscriptions table
CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_email text NOT NULL REFERENCES user_profiles(email),
    stripe_customer_id text,
    stripe_subscription_id text,
    status subscription_status NOT NULL,
    trial_start_timestamp timestamptz DEFAULT NOW() NOT NULL,
    current_period_end timestamptz NOT NULL,
    last_payment_status text,
    last_payment_date timestamptz
);

-- Create indexes
CREATE INDEX user_profiles_email_idx ON public.user_profiles(email);
CREATE INDEX user_profiles_phone_number_idx ON public.user_profiles(phone_number);
CREATE INDEX user_profiles_active_idx ON public.user_profiles(active);
CREATE INDEX user_profiles_spice_level_idx ON public.user_profiles(spice_level);
CREATE INDEX subscriptions_user_email_idx ON public.subscriptions(user_email);
CREATE INDEX subscriptions_status_idx ON public.subscriptions(status);
CREATE INDEX subscriptions_trial_start_idx ON public.subscriptions(trial_start_timestamp);

-- Enable Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view own profile"
    ON public.user_profiles FOR SELECT
    USING (auth.jwt() ->> 'email' = email);

CREATE POLICY "Users can update own profile"
    ON public.user_profiles FOR UPDATE
    USING (auth.jwt() ->> 'email' = email);

CREATE POLICY "Allow public profile creation"
    ON public.user_profiles FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Users can view own subscription"
    ON public.subscriptions FOR SELECT
    USING (auth.jwt() ->> 'email' = user_email);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
CREATE TRIGGER handle_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_subscriptions_updated_at
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_updated_at();

-- Create subscription helper functions
CREATE OR REPLACE FUNCTION public.check_subscription_access(user_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT 
        CASE 
            WHEN status = 'active' THEN true
            WHEN status = 'trial' 
                AND NOW() < (trial_start_timestamp + INTERVAL '3 days') THEN true
            ELSE false
        END
    FROM subscriptions 
    WHERE user_email = $1;
$$;

CREATE OR REPLACE FUNCTION public.get_trial_days_remaining(user_email text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT 
        GREATEST(
            0,
            EXTRACT(EPOCH FROM ((trial_start_timestamp + INTERVAL '3 days') - NOW()))/86400
        )::INTEGER
    FROM subscriptions 
    WHERE user_email = $1
        AND status = 'trial';
$$;

-- Create signup procedure
CREATE OR REPLACE FUNCTION create_user_with_trial(
    p_phone text,
    p_name text,
    p_email text,
    p_image_preference text
) RETURNS json 
LANGUAGE plpgsql 
SECURITY DEFINER AS $$
DECLARE
    v_profile_id uuid;
    v_subscription_id uuid;
BEGIN
    INSERT INTO user_profiles (
        phone_number,
        full_name,
        email,
        image_preference
    ) VALUES (
        p_phone,
        p_name,
        p_email,
        p_image_preference
    ) RETURNING id INTO v_profile_id;

    INSERT INTO subscriptions (
        user_email,
        status,
        current_period_end
    ) VALUES (
        p_email,
        'trial'::subscription_status,
        NOW() + interval '3 days'
    ) RETURNING id INTO v_subscription_id;

    RETURN json_build_object(
        'profile_id', v_profile_id,
        'subscription_id', v_subscription_id
    );
EXCEPTION WHEN others THEN
    RAISE;
END;
$$;

-- Grant permissions
GRANT SELECT, UPDATE ON public.user_profiles TO authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT EXECUTE ON FUNCTION create_user_with_trial TO service_role;

-- Add helpful comments
COMMENT ON TABLE public.user_profiles IS 'Core user data and preferences for the workout motivation app';
COMMENT ON TABLE public.subscriptions IS 'User subscription and trial management';
COMMENT ON COLUMN user_profiles.spice_level IS 'Workout intensity level (1=gentle to 5=intense) affecting message and image content';
COMMENT ON COLUMN user_profiles.image_preference IS 'User preference for the type of people shown in workout motivation images';
COMMENT ON COLUMN subscriptions.trial_start_timestamp IS 'When the trial period began';
COMMENT ON COLUMN subscriptions.status IS 'Current status: trial, active, expired, or cancelled'; 