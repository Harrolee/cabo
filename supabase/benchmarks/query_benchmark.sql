-- First, create test data
DO $$
DECLARE
  i INTEGER;
  phone_base TEXT := '+1206';
  random_timestamp TIMESTAMPTZ;
BEGIN
  -- Create 500 test users with subscriptions
  FOR i IN 1..500 LOOP
    -- Generate random phone number
    INSERT INTO user_profiles (
      full_name,
      email,
      phone_number,
      active,
      spice_level,
      image_preference
    ) VALUES (
      'Test User ' || i,
      'test' || i || '@example.com',
      phone_base || LPAD(i::TEXT, 7, '0'),
      TRUE,
      (random() * 4 + 1)::INTEGER,
      'diverse group of people'
    );

    -- Random timestamp in the last 7 days
    random_timestamp := NOW() - (random() * INTERVAL '7 days');

    -- Create subscription for user
    INSERT INTO subscriptions (
      user_phone,
      status,
      trial_start_timestamp,
      current_period_end
    ) VALUES (
      phone_base || LPAD(i::TEXT, 7, '0'),
      CASE 
        WHEN random() < 0.7 THEN 'trial'::subscription_status 
        ELSE 'active'::subscription_status 
      END,
      random_timestamp,
      random_timestamp + INTERVAL '3 days'
    );
  END LOOP;
END;
$$;

-- Wait for a moment to let the system settle
SELECT pg_sleep(1);

-- Test Query 1: Current approach with explicit join
EXPLAIN (ANALYZE, BUFFERS)
SELECT 
  user_profiles.phone_number, 
  user_profiles.full_name, 
  user_profiles.spice_level, 
  user_profiles.image_preference,
  user_profiles.email,
  subscription:subscriptions(
    status,
    trial_start_timestamp
  )
FROM user_profiles
WHERE active = true;

-- Test Query 2: Using array_agg to handle multiple subscriptions
EXPLAIN (ANALYZE, BUFFERS)
SELECT 
  user_profiles.phone_number, 
  user_profiles.full_name, 
  user_profiles.spice_level, 
  user_profiles.image_preference,
  user_profiles.email,
  array_agg(json_build_object(
    'status', subscriptions.status,
    'trial_start_timestamp', subscriptions.trial_start_timestamp
  )) as subscriptions
FROM user_profiles
LEFT JOIN subscriptions ON subscriptions.user_phone = user_profiles.phone_number
WHERE active = true
GROUP BY 
  user_profiles.phone_number, 
  user_profiles.full_name, 
  user_profiles.spice_level, 
  user_profiles.image_preference,
  user_profiles.email;

-- Test Query 3: Using correlated subquery
EXPLAIN (ANALYZE, BUFFERS)
SELECT 
  user_profiles.phone_number, 
  user_profiles.full_name, 
  user_profiles.spice_level, 
  user_profiles.image_preference,
  user_profiles.email,
  (
    SELECT json_build_object(
      'status', status,
      'trial_start_timestamp', trial_start_timestamp
    )
    FROM subscriptions 
    WHERE user_phone = user_profiles.phone_number
    ORDER BY created_at DESC
    LIMIT 1
  ) as subscription
FROM user_profiles
WHERE active = true;

-- Test Query 4: Using LATERAL join (might be fastest for single subscription)
EXPLAIN (ANALYZE, BUFFERS)
SELECT 
  user_profiles.phone_number, 
  user_profiles.full_name, 
  user_profiles.spice_level, 
  user_profiles.image_preference,
  user_profiles.email,
  sub.subscription
FROM user_profiles
CROSS JOIN LATERAL (
  SELECT json_build_object(
    'status', status,
    'trial_start_timestamp', trial_start_timestamp
  ) as subscription
  FROM subscriptions 
  WHERE user_phone = user_profiles.phone_number
  ORDER BY created_at DESC
  LIMIT 1
) sub
WHERE active = true;

-- Clean up test data
DELETE FROM subscriptions 
WHERE user_phone LIKE '+1206%';

DELETE FROM user_profiles 
WHERE phone_number LIKE '+1206%'; 