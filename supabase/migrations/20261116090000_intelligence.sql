-- Intelligence (opt-in AI with people's own keys) and Atlas keyword filters.
-- All three tables are read and written only by Atlas's server functions with the service role, always scoped to the
-- signed-in person's id. Row level security is on with no policies, so the anon and authenticated roles (the browser)
-- can't read them at all: an AI key, even encrypted, never reaches a browser.

create table if not exists public.atlas_ai_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google', 'mistral', 'moonshot', 'cloudflare')),
  -- AES-256-GCM, bound to (user_id, provider); the encryption key is a Worker secret, never stored here.
  ciphertext text not null check (length(ciphertext) <= 4096),
  iv text not null check (length(iv) <= 32),
  key_id text not null check (length(key_id) <= 32),
  -- The key's last four characters, the only part ever shown again.
  hint text not null check (length(hint) <= 8),
  models jsonb not null default '[]'::jsonb check (jsonb_typeof(models) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table if not exists public.atlas_ai_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  provider text check (provider in ('anthropic', 'openai', 'google', 'mistral', 'moonshot', 'cloudflare')),
  model text check (length(model) <= 200),
  -- Check every post against topic filters, not only posts whose words match (sends more post text to the provider).
  deep_matching boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.atlas_content_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null check (length(text) between 1 and 200),
  kind text not null check (kind in ('word', 'phrase', 'hashtag', 'topic')),
  -- hide: gone from feeds; warn: behind "Filtered: …"; blur: images and video hidden (Mastodon's three actions).
  action text not null default 'hide' check (action in ('hide', 'warn', 'blur')),
  semantic boolean not null default true,
  -- Other wordings the AI model found; the person can edit them.
  expansions jsonb not null default '[]'::jsonb check (jsonb_typeof(expansions) = 'array'),
  -- Where it applies, after Mastodon's contexts: home (Following, For You, circles), public, account (profiles).
  places text[] not null default array['home', 'public', 'account'] check (places <@ array['home', 'public', 'account'] and cardinality(places) > 0),
  -- When it stops applying (null: never), like Mastodon's and Bluesky's expiring filters.
  expires_at timestamptz,
  -- Skip posts from people the person follows (Bluesky's "exclude users you follow").
  except_following boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists atlas_content_filters_user_text on public.atlas_content_filters (user_id, lower(text));

alter table public.atlas_ai_keys enable row level security;
alter table public.atlas_ai_settings enable row level security;
alter table public.atlas_content_filters enable row level security;
revoke all on public.atlas_ai_keys, public.atlas_ai_settings, public.atlas_content_filters from anon, authenticated;
