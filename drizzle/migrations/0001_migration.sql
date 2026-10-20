alter table public.profiles
  add column bio text,
  add column featured_hashtags text[] not null default '{}';