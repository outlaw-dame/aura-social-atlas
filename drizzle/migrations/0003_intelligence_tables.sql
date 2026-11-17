create table if not exists public.atlas_ai_keys (
  user_id uuid not null,
  provider text not null check (provider in ('anthropic', 'openai', 'google', 'mistral', 'moonshot', 'cloudflare')),
  ciphertext text not null check (length(ciphertext) <= 4096),
  iv text not null check (length(iv) <= 32),
  key_id text not null check (length(key_id) <= 32),
  hint text not null check (length(hint) <= 8),
  models jsonb not null default '[]'::jsonb check (jsonb_typeof(models) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table if not exists public.atlas_ai_settings (
  user_id uuid primary key,
  enabled boolean not null default false,
  provider text check (provider in ('anthropic', 'openai', 'google', 'mistral', 'moonshot', 'cloudflare')),
  model text check (length(model) <= 200),
  deep_matching boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.atlas_content_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  text text not null check (length(text) between 1 and 200),
  kind text not null check (kind in ('word', 'phrase', 'hashtag', 'topic')),
  action text not null default 'hide' check (action in ('hide', 'warn', 'blur')),
  semantic boolean not null default true,
  expansions jsonb not null default '[]'::jsonb check (jsonb_typeof(expansions) = 'array'),
  places text[] not null default array['home', 'public', 'account'] check (places <@ array['home', 'public', 'account'] and cardinality(places) > 0),
  expires_at timestamptz,
  except_following boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists atlas_content_filters_user_text on public.atlas_content_filters (user_id, lower(text));

revoke all on public.atlas_ai_keys, public.atlas_ai_settings, public.atlas_content_filters from anon, authenticated;
grant all on public.atlas_ai_keys, public.atlas_ai_settings, public.atlas_content_filters to service_role;

alter table public.atlas_ai_keys enable row level security;
alter table public.atlas_ai_settings enable row level security;
alter table public.atlas_content_filters enable row level security;