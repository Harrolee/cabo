/*
  # A device must be able to change hands

  `push_devices.expo_token` is unique per install, and the RLS policy only let
  a caller touch rows where `user_id = auth.uid()`. So when a second person
  signed in on a device that had already registered — a shared phone, a handed-
  down device, or simply a sign-out whose cleanup did not run — the client's
  upsert resolved to an UPDATE of someone else's row and was refused:

      new row violates row-level security policy for table "push_devices"

  The failure was silent (the client only warns), so that account would never
  receive a notification again.

  Registration now goes through a SECURITY DEFINER function that reassigns the
  token to the caller. Doing it here rather than loosening the policy keeps
  "who may take a token" in one auditable place, and keeps direct table writes
  owner-only.
*/

CREATE OR REPLACE FUNCTION public.register_push_device(
    p_expo_token  text,
    p_platform    text,
    p_device_name text DEFAULT NULL,
    p_app_version text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Unsupported platform: %', p_platform;
  END IF;

  INSERT INTO public.push_devices (
      user_id, expo_token, platform, device_name, app_version,
      enabled, failure_count, last_error, last_seen_at
  )
  VALUES (
      v_user_id, p_expo_token, p_platform, p_device_name, p_app_version,
      true, 0, NULL, now()
  )
  ON CONFLICT (expo_token) DO UPDATE SET
      -- The token identifies the *install*, so whoever is signed in now owns it.
      user_id       = v_user_id,
      platform      = EXCLUDED.platform,
      device_name   = COALESCE(EXCLUDED.device_name, public.push_devices.device_name),
      app_version   = COALESCE(EXCLUDED.app_version, public.push_devices.app_version),
      enabled       = true,
      failure_count = 0,
      last_error    = NULL,
      last_seen_at  = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.register_push_device(text, text, text, text)
    IS 'Registers this install''s Expo token to the caller, taking it over from a previous account if the device changed hands';

GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text) TO authenticated;

/*
  Same problem in reverse on sign-out: the client deletes by token, which is
  correct only while it still owns the row. Deleting is also too aggressive —
  it drops the row a *different* signed-in account may already have claimed.
  Releasing only disables it, and only if the caller still owns it.
*/
CREATE OR REPLACE FUNCTION public.release_push_device(p_expo_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.push_devices
    SET enabled = false, last_error = 'signed out'
    WHERE expo_token = p_expo_token
      AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.release_push_device(text) TO authenticated;
