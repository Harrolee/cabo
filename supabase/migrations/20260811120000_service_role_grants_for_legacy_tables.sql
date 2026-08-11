/*
  # Service-role grants on the two pre-Supabase-conventions tables

  `user_profiles` and `subscriptions` come from the very first migration, which
  granted `authenticated` explicitly and left everything else to whatever
  default privileges happened to be in force. Every table added since grants
  `service_role` explicitly, so those two are the only ones where a backend job
  running with the service key can hit `permission denied` — which a local
  stack does today even though the hosted project does not.

  The daily SMS image job (`functions/motivational-images`) reads both tables
  with the service key, so make the grant explicit rather than inherited.
  RLS is unaffected: `service_role` bypasses it either way.
*/

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions  TO service_role;
