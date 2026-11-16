/**
 * The AI services someone can bring their own key for. Browser-safe: names, what a key looks like and where to get
 * one. Endpoints live server-side only (llm.server.ts), fixed per provider, so a key is only ever sent to its own
 * provider's API.
 *
 * Sources (checked November 2026):
 * - Anthropic Messages API, x-api-key, anthropic-version 2026-10-21, structured outputs via output_config.format
 *   (platform.claude.com/docs/en/build-with-claude/structured-outputs); its OpenAI SDK compatibility layer
 *   (api.anthropic.com/v1/) streams chat with tools for the assistant: platform.claude.com/docs/en/api/openai-sdk
 * - OpenAI Chat Completions, Bearer key, response_format json_schema: developers.openai.com
 * - Gemini's OpenAI-compatible endpoint (generativelanguage.googleapis.com/v1beta/openai), Bearer key: ai.google.dev/gemini-api/docs/openai
 * - Mistral (api.mistral.ai/v1, Bearer key): docs.mistral.ai
 * - Kimi / Moonshot AI (api.moonshot.ai/v1, OpenAI-compatible, Bearer key): platform.kimi.ai/docs/api/overview
 * - Cloudflare Workers AI (api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1, OpenAI-compatible, API token):
 *   developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility
 */

export const PROVIDER_IDS = ['anthropic', 'openai', 'google', 'mistral', 'moonshot', 'cloudflare'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderInfo = {
  id: ProviderId;
  /** The company. */ name: string;
  /** What people call its assistant. */ product: string;
  /** Where to create a key. */ keyUrl: string;
  /** The key field's placeholder. */ keyPlaceholder: string;
  /** Cloudflare needs the account the token belongs to. */ needsAccount?: boolean;
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: { id: 'anthropic', name: 'Anthropic', product: 'Claude', keyUrl: 'https://platform.claude.com/settings/keys', keyPlaceholder: 'sk-ant-…' },
  openai: { id: 'openai', name: 'OpenAI', product: 'ChatGPT', keyUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-…' },
  google: { id: 'google', name: 'Google', product: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey', keyPlaceholder: 'AIza…' },
  mistral: { id: 'mistral', name: 'Mistral AI', product: 'Le Chat', keyUrl: 'https://console.mistral.ai/api-keys', keyPlaceholder: 'Mistral API key' },
  moonshot: { id: 'moonshot', name: 'Moonshot AI', product: 'Kimi', keyUrl: 'https://platform.kimi.ai/docs/get-your-api-key', keyPlaceholder: 'sk-…' },
  cloudflare: { id: 'cloudflare', name: 'Cloudflare', product: 'Workers AI', keyUrl: 'https://dash.cloudflare.com/profile/api-tokens', keyPlaceholder: 'API token with Workers AI access', needsAccount: true },
};

export const isProviderId = (v: unknown): v is ProviderId => typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);

/** A Cloudflare account id: 32 lowercase hex characters. */
export const CLOUDFLARE_ACCOUNT = /^[0-9a-f]{32}$/;

/** What an API key may look like: printable ASCII, no spaces, a sane length. Providers' formats change, so only the
 *  shape is checked here; the provider itself confirms the key when it's saved. */
export const API_KEY = /^[\x21-\x7e]{16,512}$/;

/** The last four characters of a key, the only part Atlas ever shows again. */
export const keyHint = (key: string) => `…${key.slice(-4)}`;

/**
 * Which listed model to start with: a small, fast one, since filters and suggestions are short structured tasks.
 * Model names change every few months, so these are preferences matched against what the provider lists for this key,
 * never assumed to exist.
 */
export const PREFERRED_MODELS: Record<ProviderId, RegExp[]> = {
  anthropic: [/^claude-haiku-\d/, /^claude-sonnet-\d/],
  openai: [/^gpt-[\d.]+-terra$/, /^gpt-[\d.]+-mini$/, /^gpt-[\d.]+$/],
  google: [/^(models\/)?gemini-[\d.]+-flash$/, /^(models\/)?gemini-[\d.]+-flash-lite$/, /^(models\/)?gemini-[\d.]+-pro$/],
  mistral: [/^mistral-small-latest$/, /^mistral-small-\d+$/, /^mistral-large-latest$/, /^mistral-large-\d+$/],
  moonshot: [/^kimi-k\d+(\.\d+)?$/, /^kimi-k[\d.]+-pro$/],
  cloudflare: [/^@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast$/, /^@cf\/openai\/gpt-oss-120b$/, /^@cf\/qwen\//, /^@cf\/meta\//],
};

/** Models that aren't for chat (embeddings, images, speech, moderation…), left out of the model picker. */
const NOT_CHAT = /(embed|image|imagen|tts|audio|speech|whisper|transcribe|realtime|moderation|dall-e|veo|lyria|vision-preview|ocr|search)/i;

/** The provider's models worth offering for text, newest-looking first, the preferred one first of all. */
export function chatModels(provider: ProviderId, ids: string[]): string[] {
  const usable = [...new Set(ids)].filter(id => !NOT_CHAT.test(id)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const pick = defaultModel(provider, usable);
  return pick ? [pick, ...usable.filter(id => id !== pick)] : usable;
}

export function defaultModel(provider: ProviderId, ids: string[]): string | undefined {
  const sorted = [...ids].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const re of PREFERRED_MODELS[provider]) { const hit = sorted.find(id => re.test(id)); if (hit) return hit; }
  return sorted[0];
}
