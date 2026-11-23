-- Keys Atlas can keep: every Intelligence provider (src/lib/intelligence/providers.ts PROVIDER_IDS, including the
-- embeddings-only ones added for semantic filters: Voyage, Cohere, Jina, OpenRouter) and DeepL for translation.
-- 20261118000000_translation_keys.sql added DeepL but wasn't applied everywhere, and the embedding providers were
-- never added, so saving those keys failed with a check violation. tests/key-providers.test.ts keeps this list in
-- step with the code. Idempotent: safe to run again.
alter table public.atlas_ai_keys drop constraint if exists atlas_ai_keys_provider_check;
alter table public.atlas_ai_keys add constraint atlas_ai_keys_provider_check
  check (provider in ('anthropic', 'openai', 'google', 'mistral', 'moonshot', 'cloudflare', 'voyage', 'cohere', 'jina', 'openrouter', 'deepl'));
