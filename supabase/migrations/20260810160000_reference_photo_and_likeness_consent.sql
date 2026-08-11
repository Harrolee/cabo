/*
  # Reference photo and likeness consent

  `…140000` added `user_profiles.reference_photo_url` and
  `user_profiles.likeness_consent` so the visualiser could pick PhotoMaker and
  keep the member's own face. Nothing ever wrote either column, so every
  generated image was a faceless scene. This migration makes that path safe to
  reach.

  Two things matter here, because a face is biometric-adjacent data:

  1. **Only the backend may set these columns.** `user_profiles` has a
     permissive "Users can update own profile" policy, so without a guard any
     member could flip `likeness_consent` themselves — or, much worse, point
     `reference_photo_url` at a photograph of somebody else and generate images
     of a person who never consented to anything. Both columns are now written
     exclusively by the `coach-visualizer` function with the service role,
     which is also the only place that can put a file in the member-media
     bucket.

  2. **Withdrawal has to delete the file, not just clear a flag.** The columns
     and the stored object are kept in lockstep by that same function: granting
     writes the object then the pointer, revoking deletes the object then the
     pointer, and generation treats a pointer with no object behind it as no
     consent. The timestamps below exist so that "when did they agree to this,
     and to what" is answerable later.
*/

ALTER TABLE public.user_profiles
    -- When consent was given. NULL whenever likeness_consent is false.
    ADD COLUMN IF NOT EXISTS likeness_consent_at        timestamptz,
    -- When the stored reference photo was last replaced.
    ADD COLUMN IF NOT EXISTS reference_photo_updated_at timestamptz;

COMMENT ON COLUMN public.user_profiles.reference_photo_url
    IS 'gs:// URI of the member''s private reference photo in the member-media bucket. Never public: the visualiser mints a short-lived signed URL at generation time. NULL means there is no stored photo.';
COMMENT ON COLUMN public.user_profiles.likeness_consent_at
    IS 'When the member consented to their likeness being used. Cleared on withdrawal.';
COMMENT ON COLUMN public.user_profiles.reference_photo_updated_at
    IS 'When the stored reference photo was last written. Cleared when the photo is deleted.';

/*
  The backend could not write this table at all.

  `user_profiles` predates the app and was only ever granted to `anon` and
  `authenticated`; `service_role` has never had SELECT or UPDATE on it. Nothing
  noticed because the one function that reads it — the visualiser, fetching the
  reference photo — discards the PostgREST error and treats the result as "no
  profile", which is indistinguishable from "no consent". So the identity path
  could not have worked even once both columns were populated.
*/
GRANT SELECT, INSERT, UPDATE ON public.user_profiles TO service_role;

-- ---------------------------------------------------------------------------
-- Consent and the photo pointer are backend-only columns
-- ---------------------------------------------------------------------------

/*
  Same shape as protect_subscription_billing_fields(): a BEFORE UPDATE trigger
  rather than a WITH CHECK, so the write silently keeps the old value instead
  of erroring out an unrelated profile update (the app patches notification
  preferences on this row). `auth.uid() IS NULL` means there is no end user on
  the request — migrations and the service role — and those are trusted.
*/
CREATE OR REPLACE FUNCTION public.protect_likeness_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.reference_photo_url        := OLD.reference_photo_url;
  NEW.likeness_consent           := OLD.likeness_consent;
  NEW.likeness_consent_at        := OLD.likeness_consent_at;
  NEW.reference_photo_updated_at := OLD.reference_photo_updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_likeness_fields_trigger ON public.user_profiles;
CREATE TRIGGER protect_likeness_fields_trigger
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW EXECUTE PROCEDURE public.protect_likeness_fields();

COMMENT ON FUNCTION public.protect_likeness_fields
    IS 'Keeps likeness consent and the reference photo pointer writable only by the backend, so consent cannot be self-granted and the pointer cannot be aimed at someone else''s photograph.';

-- ---------------------------------------------------------------------------
-- Invariant: no stored photo without consent
-- ---------------------------------------------------------------------------

/*
  Belt and braces on top of the application logic. If consent is ever cleared
  by any path, the pointer goes with it in the same statement, so the
  visualiser can never resolve a photo for a member who has withdrawn — and the
  orphaned object is picked up and deleted on the next status or generate call.
*/
ALTER TABLE public.user_profiles
    DROP CONSTRAINT IF EXISTS reference_photo_requires_consent;
ALTER TABLE public.user_profiles
    ADD CONSTRAINT reference_photo_requires_consent
    CHECK (reference_photo_url IS NULL OR likeness_consent);
