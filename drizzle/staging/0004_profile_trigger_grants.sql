-- Applied ONLY to the new disposable Supabase Atlas staging project.
-- Deliberately outside drizzle/migrations/ and its journal: no production auto-rollout.
-- Restrict direct RPC invocation of the privileged auth.users signup trigger.
-- Invocation by the existing auth.users trigger remains authorized.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Browser clients never need anonymous profile reads. Authenticated users retain
-- their exact owner-scoped RLS SELECT/INSERT/UPDATE policies.
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles FROM anon;
