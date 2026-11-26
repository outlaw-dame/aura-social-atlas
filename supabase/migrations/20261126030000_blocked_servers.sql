-- Servers a person blocks, kept by Atlas (src/lib/server-blocklist.ts). Fedizen (Bonfire) gives apps no list of the
-- servers a person blocks there, so Atlas keeps its own: added by hand or imported from a blocklist file on Settings →
-- Moderation, and applied wherever Atlas shows posts from other servers. Fedizen doesn't know about this list.
-- Server-only: row level security on, no policies, no anon/authenticated grants.

create table if not exists public.atlas_blocked_servers (
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null check (char_length(domain) between 3 and 253 and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  added_at timestamptz not null default now(),
  primary key (user_id, domain)
);

alter table public.atlas_blocked_servers enable row level security;
revoke all on public.atlas_blocked_servers from anon, authenticated;

comment on table public.atlas_blocked_servers is 'Server-only: servers each person blocks in Atlas (imported or added on Settings → Moderation). Not synced to Fedizen.';
