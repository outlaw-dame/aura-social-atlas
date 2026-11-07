-- Collections: curated sets of accounts to recommend, modelled on Mastodon 4.6 Collections.
-- Same limits as Mastodon: name ≤ 40, description ≤ 100, one topic hashtag, ≤ 25 accounts per
-- collection, ≤ 10 collections per person. Accounts are featured only with their consent, which the
-- server checks against the account's own server (Mastodon `feature_approval`) before inserting.
-- Server-only tables: every read and write goes through server functions, so consent can't be skipped.
CREATE TABLE public.atlas_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  description text CHECK (description IS NULL OR char_length(description) <= 100),
  tag_name text CHECK (tag_name IS NULL OR tag_name ~ '^[[:alnum:]_]{1,100}$'),
  language text CHECK (language IS NULL OR language ~ '^[a-z]{2,3}$'),
  sensitive boolean NOT NULL DEFAULT false,
  discoverable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX atlas_collections_owner_idx ON public.atlas_collections (owner_id, created_at DESC);

CREATE TABLE public.atlas_collection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.atlas_collections(id) ON DELETE CASCADE,
  -- The featured account: its ActivityPub actor id is the identity; the rest is a display cache.
  actor_uri text NOT NULL CHECK (actor_uri ~ '^https://'),
  acct text NOT NULL,
  display_name text,
  avatar_url text,
  profile_url text,
  state text NOT NULL DEFAULT 'accepted' CHECK (state IN ('accepted', 'pending')),
  position smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, actor_uri)
);
CREATE INDEX atlas_collection_items_collection_idx ON public.atlas_collection_items (collection_id, position);

-- Limits enforced in the database as well as in the server functions.
CREATE OR REPLACE FUNCTION public.atlas_collections_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize inserts per owner so two at once can't both see 9 and make 11.
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas_collections:' || NEW.owner_id::text, 0));
  IF (SELECT count(*) FROM public.atlas_collections WHERE owner_id = NEW.owner_id) >= 10 THEN
    RAISE EXCEPTION 'collection_limit' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER atlas_collections_limit BEFORE INSERT ON public.atlas_collections
  FOR EACH ROW EXECUTE FUNCTION public.atlas_collections_limit();

CREATE OR REPLACE FUNCTION public.atlas_collection_items_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Lock the parent collection row so concurrent inserts into one collection are counted one at a time.
  PERFORM 1 FROM public.atlas_collections WHERE id = NEW.collection_id FOR UPDATE;
  IF (SELECT count(*) FROM public.atlas_collection_items WHERE collection_id = NEW.collection_id) >= 25 THEN
    RAISE EXCEPTION 'collection_full' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER atlas_collection_items_limit BEFORE INSERT ON public.atlas_collection_items
  FOR EACH ROW EXECUTE FUNCTION public.atlas_collection_items_limit();

GRANT ALL ON public.atlas_collections, public.atlas_collection_items TO service_role;
REVOKE ALL ON public.atlas_collections, public.atlas_collection_items FROM anon, authenticated;
ALTER TABLE public.atlas_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_collection_items ENABLE ROW LEVEL SECURITY;
