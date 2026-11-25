-- Whether the assistant is offered in Compose, kept with the account rather than in one browser (it used to be in
-- localStorage, off by default, so people who had added a server key couldn't find it on a new device).
-- null: never chosen; Atlas then offers the assistant whenever a key on Atlas's server can answer.
alter table public.atlas_ai_settings add column if not exists assistant boolean;
