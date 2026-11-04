CREATE TABLE public.fedizen_oauth_apps (
  redirect_uri text PRIMARY KEY,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.fedizen_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.fedizen_connections (
  user_id uuid PRIMARY KEY,
  access_token text NOT NULL,
  scope text NOT NULL,
  account_handle text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Server-only: tokens and app credentials never reach the browser.
GRANT ALL ON public.fedizen_oauth_apps, public.fedizen_oauth_states, public.fedizen_connections TO service_role;
REVOKE ALL ON public.fedizen_oauth_apps, public.fedizen_oauth_states, public.fedizen_connections FROM anon, authenticated;
ALTER TABLE public.fedizen_oauth_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fedizen_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fedizen_connections ENABLE ROW LEVEL SECURITY;