-- Other spellings of a hashtag a person follows (#PS5 → #PS5Pro, #PlayStation5), found by Atlas when they followed it
-- (src/lib/tag-variants.ts). Following the hashtag also follows the FediBuzz relays for these behind the scenes, so
-- their posts reach Fedizen too; this row says which ones belong to which followed hashtag, so unfollowing it removes
-- them and their posts read as the hashtag the person follows (src/lib/fedibuzz-follows.server.ts).
-- Server-only: row level security on, no policies, no anon/authenticated grants.

create table if not exists public.atlas_tag_variants (
  user_id uuid not null references auth.users (id) on delete cascade,
  tag text not null check (tag ~ '^[a-z0-9_]{1,100}$'),
  variants text[] not null default '{}' check (cardinality(variants) <= 6),
  updated_at timestamptz not null default now(),
  primary key (user_id, tag)
);

alter table public.atlas_tag_variants enable row level security;
revoke all on public.atlas_tag_variants from anon, authenticated;

comment on table public.atlas_tag_variants is 'Server-only: other spellings of each hashtag a person follows, followed through FediBuzz relays (see src/lib/fedibuzz-follows.server.ts).';
