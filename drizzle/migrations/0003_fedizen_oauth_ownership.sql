-- Atlas Fedizen OAuth ownership constraints.
--
-- Run under the normal privileged Drizzle migration role, never in a
-- browser session. This is ADDITIVE and preserves all existing grants/RLS.
-- Account deletion must revoke local persisted grants and pending OAuth
-- PKCE states. A user can have only one active pending connection state.
--
-- Fail closed if any row would be orphaned or conflict with uniqueness;
-- do not silently delete production credentials or authorization states.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.fedizen_connections c
    LEFT JOIN auth.users u ON u.id = c.user_id
    WHERE u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Fedizen connection ownership preflight failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fedizen_oauth_states s
    LEFT JOIN auth.users u ON u.id = s.user_id
    WHERE u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Fedizen OAuth state ownership preflight failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fedizen_oauth_states
    GROUP BY user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'More than one pending OAuth state exists for an Atlas user';
  END IF;
END
$$;

ALTER TABLE public.fedizen_connections
  ADD CONSTRAINT fedizen_connections_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.fedizen_oauth_states
  ADD CONSTRAINT fedizen_oauth_states_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.fedizen_oauth_states
  ADD CONSTRAINT fedizen_oauth_states_one_per_user UNIQUE (user_id);
