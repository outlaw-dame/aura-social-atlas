-- Which registered Fedizen OAuth app issued each connection's grant, so Disconnect can revoke it with that app's
-- credentials (RFC 7009). Nullable: connections made before this column can't say, and Disconnect then tries every
-- registration. Applied by hand, like 0003 and 0004; the code keeps working until it is (Postgres 42703 fallback).
ALTER TABLE public.fedizen_connections ADD COLUMN IF NOT EXISTS client_id text;
