-- Applied to isolated Atlas staging ONLY; not in production Drizzle journal.
-- Optimizes auth.uid() evaluation (Supabase RLS initplan) without altering
-- who can SELECT, INSERT or UPDATE their own profile.
ALTER POLICY "Users can read their own profile" ON public.profiles
  USING ((SELECT auth.uid()) = id);

ALTER POLICY "Users can insert their own profile" ON public.profiles
  WITH CHECK ((SELECT auth.uid()) = id);

ALTER POLICY "Users can update their own profile" ON public.profiles
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);
