-- Push notifications through Atlas's relay. Fedizen (Bonfire) puts the account's access token in every Mastodon-shaped
-- push payload, so Atlas never lets Fedizen push to a browser directly: Fedizen pushes to Atlas (one relay per person,
-- with a key pair only Atlas holds), Atlas decrypts, drops the token, and pushes a short notice to the person's browsers
-- with its own VAPID key. Server-only tables: row level security on, no policies, no anon/authenticated grants.

create table if not exists public.atlas_push_relays (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The unguessable path part of the relay URL Fedizen pushes to (/api/push/relay/<relay_id>).
  relay_id text not null unique check (relay_id ~ '^[A-Za-z0-9_-]{22,64}$'),
  -- The relay's P-256 private scalar, AES-256-GCM sealed with a key derived from the ATLAS_VAPID_PRIVATE_KEY secret.
  sealed_private text not null check (length(sealed_private) <= 200),
  iv text not null check (length(iv) <= 32),
  public_key text not null check (length(public_key) <= 100),
  auth_secret text not null check (length(auth_secret) <= 30),
  -- Fedizen's VAPID public key (server_key), to check that pushes to the relay come from Fedizen.
  server_key text check (length(server_key) <= 200),
  alerts jsonb not null default '{}'::jsonb check (jsonb_typeof(alerts) = 'object'),
  policy text not null default 'all' check (policy in ('all', 'followed', 'follower', 'none')),
  created_at timestamptz not null default now()
);

create table if not exists public.atlas_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The browser's push service URL and keys (PushSubscription), only ever sent to.
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1024),
  p256dh text not null check (length(p256dh) <= 100),
  auth text not null check (length(auth) <= 30),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists atlas_push_devices_user on public.atlas_push_devices (user_id);

alter table public.atlas_push_relays enable row level security;
alter table public.atlas_push_devices enable row level security;
revoke all on public.atlas_push_relays, public.atlas_push_devices from anon, authenticated;
