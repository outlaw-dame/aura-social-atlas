-- Intelligence: more than one key per AI company, the model each key uses, and which key does which job.
--
-- * A key gets its own id, an optional name ("Work", "Personal") and its own model, so someone can keep two keys from
--   the same company, or keys from several, side by side.
-- * Settings name the main key (the assistant, alt text, translation, writing filters) and, optionally, a separate
--   key and model for background filtering, which runs all the time while feeds are open. `fallback` lets Atlas try
--   the person's other keys when the one in use is refusing or limited (background work never borrows the main key).
--
-- Existing rows keep working: keys get an id, settings are pointed at the key of the company they named, and that
-- key keeps the model chosen before. Ciphertexts are unchanged (they stay bound to their owner and company).
-- Idempotent: safe to run again.

alter table public.atlas_ai_keys add column if not exists id uuid not null default gen_random_uuid();
alter table public.atlas_ai_keys add column if not exists label text;
alter table public.atlas_ai_keys add column if not exists model text;
alter table public.atlas_ai_keys drop constraint if exists atlas_ai_keys_label_check;
alter table public.atlas_ai_keys add constraint atlas_ai_keys_label_check check (label is null or length(label) between 1 and 40);
alter table public.atlas_ai_keys drop constraint if exists atlas_ai_keys_model_check;
alter table public.atlas_ai_keys add constraint atlas_ai_keys_model_check check (model is null or length(model) <= 200);

-- One row per key instead of one per company.
alter table public.atlas_ai_keys drop constraint if exists atlas_ai_keys_pkey;
alter table public.atlas_ai_keys add constraint atlas_ai_keys_pkey primary key (id);
create index if not exists atlas_ai_keys_user on public.atlas_ai_keys (user_id, created_at);
-- DeepL stays a single key per person.
create unique index if not exists atlas_ai_keys_one_deepl on public.atlas_ai_keys (user_id) where provider = 'deepl';

alter table public.atlas_ai_settings add column if not exists main_key uuid;
alter table public.atlas_ai_settings add column if not exists background_key uuid;
alter table public.atlas_ai_settings add column if not exists background_model text;
alter table public.atlas_ai_settings add column if not exists fallback boolean not null default true;
alter table public.atlas_ai_settings drop constraint if exists atlas_ai_settings_background_model_check;
alter table public.atlas_ai_settings add constraint atlas_ai_settings_background_model_check check (background_model is null or length(background_model) <= 200);

update public.atlas_ai_settings s set main_key = k.id
  from public.atlas_ai_keys k
  where s.main_key is null and k.user_id = s.user_id and k.provider = s.provider;
update public.atlas_ai_keys k set model = s.model
  from public.atlas_ai_settings s
  where k.model is null and s.main_key = k.id and s.model is not null;

-- Unchanged: only Atlas's server (service role) reads or writes these tables.
alter table public.atlas_ai_keys enable row level security;
alter table public.atlas_ai_settings enable row level security;
revoke all on public.atlas_ai_keys, public.atlas_ai_settings from anon, authenticated;
