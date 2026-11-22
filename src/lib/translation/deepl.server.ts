/**
 * DeepL with the person's own key. Server-only: DeepL's API refuses calls from a browser (developers.deepl.com,
 * "CORS requests": browser requests fail with 403 — keep the key on a backend), so the key lives in Atlas's key vault
 * (intelligence/vault.server.ts) and is only ever sent to DeepL.
 *
 * Sources (developers.deepl.com, checked November 2026):
 * - Authentication: `Authorization: DeepL-Auth-Key <key>`; API Free keys end in `:fx` and use api-free.deepl.com,
 *   API Pro keys use api.deepl.com.
 * - POST /v2/translate: `text` is an array translated in order, request up to 128 KiB; `source_lang` optional
 *   (detected otherwise); `tag_handling: html` keeps markup, and elements with `translate="no"` are left untranslated;
 *   answers `translations[].{detected_source_language, text}`. 403 bad key, 413 too large, 429 too many requests,
 *   456 quota used up, 5xx try again later.
 * - GET /v2/usage: `character_count` and `character_limit` for the billing period.
 */
export type DeeplProblem = 'bad-key' | 'quota' | 'rate-limited' | 'too-long' | 'unsupported' | 'unavailable';

export class DeeplError extends Error {
  constructor(public code: DeeplProblem, public status?: number) { super(code); }
}

export const deeplHost = (key: string) => (key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com');
export const deeplPlan = (key: string): 'free' | 'pro' => (key.trim().endsWith(':fx') ? 'free' : 'pro');

function problemFor(status: number): DeeplProblem {
  if (status === 401 || status === 403) return 'bad-key';
  if (status === 456) return 'quota';
  if (status === 429 || status === 529) return 'rate-limited';
  if (status === 413 || status === 414) return 'too-long';
  if (status === 400) return 'unsupported';
  return 'unavailable';
}

async function call(key: string, path: string, init: { method: 'GET' | 'POST'; body?: unknown; timeout?: number }, fetcher: typeof fetch = fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetcher(`${deeplHost(key)}${path}`, {
      method: init.method,
      headers: { Authorization: `DeepL-Auth-Key ${key.trim()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/json' },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      // Workers support "follow" and "manual" only; a redirect is never followed (3xx is not ok below).
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeout ?? 15_000),
    });
  } catch {
    throw new DeeplError('unavailable');
  }
  if (!res.ok) {
    // DeepL's error text can echo what was sent: read and dropped, never passed on or logged.
    await res.text().catch(() => '');
    throw new DeeplError(problemFor(res.status), res.status);
  }
  const text = await res.text();
  if (text.length > 4_000_000) throw new DeeplError('unavailable');
  try { return JSON.parse(text); } catch { throw new DeeplError('unavailable'); }
}

/** The key's use this billing period; also how a key is checked before it's kept. */
export async function deeplUsage(key: string, fetcher?: typeof fetch): Promise<{ used: number; limit: number }> {
  const r = await call(key, '/v2/usage', { method: 'GET', timeout: 10_000 }, fetcher) as { character_count?: unknown; character_limit?: unknown };
  return { used: typeof r.character_count === 'number' ? r.character_count : 0, limit: typeof r.character_limit === 'number' ? r.character_limit : 0 };
}

/** Translates texts (Atlas's `html` form, lib/translation/segments.ts) in one request, in order. */
export async function deeplTranslate(key: string, req: { texts: string[]; target: string; source?: string }, fetcher?: typeof fetch): Promise<{ texts: string[]; detected?: string }> {
  const r = await call(key, '/v2/translate', {
    method: 'POST',
    body: {
      text: req.texts,
      target_lang: req.target,
      ...(req.source ? { source_lang: req.source } : {}),
      tag_handling: 'html',
      preserve_formatting: true,
    },
    timeout: 20_000,
  }, fetcher) as { translations?: { text?: unknown; detected_source_language?: unknown }[] };
  const list = r.translations ?? [];
  if (list.length !== req.texts.length || list.some(t => typeof t.text !== 'string')) throw new DeeplError('unavailable');
  const detected = list.find(t => typeof t.detected_source_language === 'string')?.detected_source_language as string | undefined;
  return { texts: list.map(t => t.text as string), ...(detected ? { detected: detected.toLowerCase() } : {}) };
}
