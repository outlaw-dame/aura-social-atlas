-- Lookups Atlas's server makes on public data and keeps between requests: an actor's own avatar, the people credited
-- on a linked article (and any episode or video found there), the "Voices to know" list and its avatars. The server
-- keeps them in memory, which Railway's App Sleeping empties every time the service sleeps (5–10 min after its last
-- outbound traffic), so after each wake every page looked them up again from dozens of other servers. This table keeps
-- them across restarts. Public data only, never anything about an Atlas account or Fedizen session.
-- Server-only: row level security on, no policies, no anon/authenticated grants.

create table if not exists public.atlas_lookup_cache (
  kind text not null check (kind in ('avatar', 'authors', 'voices', 'voice-avatars')),
  key text not null check (length(key) between 1 and 2048),
  value jsonb not null check (pg_column_size(value) <= 65536),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (kind, key)
);

create index if not exists atlas_lookup_cache_expires_at on public.atlas_lookup_cache (expires_at);

alter table public.atlas_lookup_cache enable row level security;
revoke all on public.atlas_lookup_cache from anon, authenticated;

-- Expired rows are dropped by the server as it writes (see lookup-cache.server.ts); this keeps a forgotten table small.
comment on table public.atlas_lookup_cache is 'Server-only cache of public lookups (avatars, article credits, Voices). Safe to truncate at any time.';
