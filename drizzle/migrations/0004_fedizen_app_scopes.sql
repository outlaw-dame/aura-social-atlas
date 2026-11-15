-- Atlas now asks Fedizen for "read write follow". An OAuth app registered with only "read" can't be granted
-- more, so remember which scopes each registered app has and register a new one when they differ.
ALTER TABLE public.fedizen_oauth_apps ADD COLUMN IF NOT EXISTS scopes text NOT NULL DEFAULT 'read';
