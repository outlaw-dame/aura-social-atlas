-- Translation: a DeepL key can be kept in Atlas's key vault beside AI provider keys (same encryption, same
-- server-only access). DeepL keys carry no model list.
alter table public.atlas_ai_keys drop constraint if exists atlas_ai_keys_provider_check;
alter table public.atlas_ai_keys add constraint atlas_ai_keys_provider_check
  check (provider in ('anthropic', 'openai', 'google', 'mistral', 'moonshot', 'cloudflare', 'deepl'));
