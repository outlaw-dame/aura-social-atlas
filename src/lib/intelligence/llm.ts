/**
 * Talking to the AI provider with someone's own key: on Atlas's server for keys kept there, and in the browser for a
 * key kept on the device only (see device-keys.ts).
 *
 * Every endpoint is fixed here per provider: nothing a request carries becomes part of a URL except a Cloudflare
 * account id, which must be 32 hex characters. So a key only ever goes to its own provider (no SSRF, no key
 * forwarding), and requests carry a timeout and capped sizes. From a browser, Anthropic requires the
 * anthropic-dangerous-direct-browser-access header; Cloudflare's API doesn't allow browser calls at all.
 */
import { CLOUDFLARE_ACCOUNT, type Credential, type ProviderId } from './providers';

export const ANTHROPIC_VERSION = '2026-10-21';

export class ProviderError extends Error {
  constructor(public code: 'bad-key' | 'no-access' | 'rate-limited' | 'unavailable' | 'bad-output' | 'bad-model' | 'browser-blocked', public status?: number) { super(code); }
}

const inBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
/** Providers whose API a web page may call directly (CORS). Cloudflare's REST API doesn't allow it. */
export const BROWSER_CAPABLE: Record<ProviderId, boolean> = { anthropic: true, openai: true, google: true, mistral: true, moonshot: true, cloudflare: false };

/** The OpenAI-compatible base URL for a credential (Anthropic: its OpenAI SDK compatibility layer, used for chat). */
export function openAiBase(c: Credential): string {
  switch (c.provider) {
    case 'openai': return 'https://api.openai.com/v1';
    case 'google': return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'mistral': return 'https://api.mistral.ai/v1';
    case 'moonshot': return 'https://api.moonshot.ai/v1';
    case 'anthropic': return 'https://api.anthropic.com/v1';
    case 'cloudflare': {
      if (!c.account || !CLOUDFLARE_ACCOUNT.test(c.account)) throw new ProviderError('bad-key');
      return `https://api.cloudflare.com/client/v4/accounts/${c.account}/ai/v1`;
    }
  }
}

function headers(c: Credential): Record<string, string> {
  return c.provider === 'anthropic'
    ? { 'x-api-key': c.key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json', ...(inBrowser() ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}) }
    : { authorization: `Bearer ${c.key}`, 'content-type': 'application/json' };
}

function failure(status: number): ProviderError {
  if (status === 401) return new ProviderError('bad-key', status);
  if (status === 403) return new ProviderError('no-access', status);
  if (status === 404) return new ProviderError('bad-model', status);
  if (status === 429) return new ProviderError('rate-limited', status);
  return new ProviderError('unavailable', status);
}

async function call(url: string, c: Credential, init: { method?: string; body?: unknown; timeout?: number } = {}): Promise<unknown> {
  if (inBrowser() && !BROWSER_CAPABLE[c.provider]) throw new ProviderError('browser-blocked');
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: headers(c),
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(init.timeout ?? 30_000),
      redirect: 'error',
      // From a browser: no cookies, and no Referer telling the provider which page called.
      ...(inBrowser() ? { credentials: 'omit' as const, referrerPolicy: 'no-referrer' as const } : {}),
    });
  } catch (e) {
    // In a browser, a request the provider's CORS rules refuse fails as a TypeError before any response arrives.
    throw new ProviderError(inBrowser() && e instanceof TypeError ? 'browser-blocked' : 'unavailable');
  }
  if (!res.ok) {
    // Read (and drop) the body: provider error text can echo request content, so it's never passed on or logged.
    await res.text().catch(() => '');
    throw failure(res.status);
  }
  const text = await res.text();
  if (text.length > 4_000_000) throw new ProviderError('bad-output');
  try { return JSON.parse(text); } catch { throw new ProviderError('bad-output'); }
}

/** The model ids this key can use. Doubles as the key check when it's saved. */
export async function listModels(c: Credential): Promise<string[]> {
  if (c.provider === 'anthropic') {
    const out: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = await call(`https://api.anthropic.com/v1/models?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ''}`, c) as { data?: { id?: string }[]; has_more?: boolean; last_id?: string };
      out.push(...(r.data ?? []).map(m => m.id).filter((id): id is string => typeof id === 'string'));
      if (!r.has_more || !r.last_id) break;
      after = r.last_id;
    }
    return out;
  }
  if (c.provider === 'cloudflare') {
    if (!c.account || !CLOUDFLARE_ACCOUNT.test(c.account)) throw new ProviderError('bad-key');
    const r = await call(`https://api.cloudflare.com/client/v4/accounts/${c.account}/ai/models/search?task=${encodeURIComponent('Text Generation')}&per_page=100`, c) as { result?: { name?: string }[] };
    return (r.result ?? []).map(m => m.name).filter((id): id is string => typeof id === 'string');
  }
  const r = await call(`${openAiBase(c)}/models`, c) as { data?: { id?: string }[] };
  return (r.data ?? []).map(m => (typeof m.id === 'string' ? m.id.replace(/^models\//, '') : null)).filter((id): id is string => !!id);
}

/** Pulls the JSON object out of a model's reply, tolerating code fences or a sentence around it. */
export function parseJsonReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ } }
  throw new ProviderError('bad-output');
}

/** Providers that take a JSON schema for the reply (`response_format` json_schema; Anthropic: output_config.format). */
const SCHEMA_OUTPUT: Record<ProviderId, boolean> = { anthropic: true, openai: true, google: true, mistral: true, moonshot: true, cloudflare: false };
/** OpenAI's newer models and Kimi take max_completion_tokens; the others max_tokens. */
const MAX_PARAM: Record<ProviderId, 'max_tokens' | 'max_completion_tokens'> = { anthropic: 'max_tokens', openai: 'max_completion_tokens', google: 'max_tokens', mistral: 'max_tokens', moonshot: 'max_completion_tokens', cloudflare: 'max_tokens' };

/**
 * One structured answer: a system prompt, the data as JSON, and a JSON Schema for the reply. No temperature is sent:
 * recent Claude and OpenAI reasoning models reject anything but their default.
 */
export async function completeJson(c: Credential, model: string, task: { system: string; input: unknown; schemaName: string; schema: Record<string, unknown>; maxTokens?: number }): Promise<unknown> {
  const user = JSON.stringify(task.input);
  const max = task.maxTokens ?? 4000;
  if (c.provider === 'anthropic') {
    const r = await call('https://api.anthropic.com/v1/messages', c, {
      body: { model, max_tokens: max, system: task.system, messages: [{ role: 'user', content: user }], output_config: { format: { type: 'json_schema', schema: task.schema } } },
      timeout: 60_000,
    }) as { content?: { type?: string; text?: string }[] };
    const text = (r.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
    return parseJsonReply(text);
  }
  const base = {
    model,
    messages: [{ role: 'system', content: `${task.system}\nReply with JSON only.` }, { role: 'user', content: user }],
    [MAX_PARAM[c.provider]]: max,
  };
  const withSchema = { ...base, response_format: { type: 'json_schema', json_schema: { name: task.schemaName, schema: task.schema, strict: true } } };
  let r: { choices?: { message?: { content?: string | null } }[] };
  try {
    r = await call(`${openAiBase(c)}/chat/completions`, c, { body: SCHEMA_OUTPUT[c.provider] ? withSchema : base, timeout: 60_000 }) as typeof r;
  } catch (e) {
    // Some models on a provider don't take a schema; ask once more with the format in the prompt only.
    if (!(e instanceof ProviderError) || e.status !== 400 || !SCHEMA_OUTPUT[c.provider]) throw e;
    r = await call(`${openAiBase(c)}/chat/completions`, c, { body: { ...base, messages: [{ role: 'system', content: `${task.system}\nReply with JSON only, matching this JSON Schema: ${JSON.stringify(task.schema)}` }, base.messages[1]] }, timeout: 60_000 }) as typeof r;
  }
  return parseJsonReply(r.choices?.[0]?.message?.content ?? '');
}
