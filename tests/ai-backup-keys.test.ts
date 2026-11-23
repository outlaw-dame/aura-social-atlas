import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Invented keys and settings, served by stand-ins for the database and the vault.
const keys = [
  { id: 'k-main', provider: 'anthropic', label: null, hint: '…0001', models: ['haiku'], model: 'haiku' },
  { id: 'k-second', provider: 'anthropic', label: 'Personal', hint: '…0002', models: ['haiku'], model: 'haiku' },
  { id: 'k-bg', provider: 'openai', label: null, hint: '…0003', models: ['mini'], model: 'mini' },
];
let settings: Record<string, unknown> = {};
mock.module('@/integrations/supabase/client.server', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: settings, error: null }) }) }) }) },
}));
mock.module('../src/lib/intelligence/vault.server', () => {
  class VaultError extends Error { constructor(public code: string) { super(code); } }
  return {
    VaultError, vaultReady: async () => true, savedKeys: async () => keys,
    credentialById: async (_u: string, id: string) => ({ provider: keys.find(k => k.id === id)!.provider, key: `secret-${id}` }),
  };
});
const { withAi, _resetResting } = await import('../src/lib/intelligence/store.server');
const { ProviderError } = await import('../src/lib/intelligence/llm');

beforeEach(() => {
  _resetResting();
  settings = { enabled: true, provider: 'anthropic', model: 'haiku', deep_matching: false, main_key: 'k-main', background_key: 'k-bg', background_model: 'mini', fallback: true };
});

/** A job that fails on the keys given, and records which keys it was tried with. */
const job = (failing: Record<string, string>) => {
  const tried: string[] = [];
  return { tried, run: async (c: { key: string }) => { const id = c.key.replace('secret-', ''); tried.push(id); if (failing[id]) throw new ProviderError(failing[id] as never); return id; } };
};

describe('backup keys', () => {
  test('the person’s own request moves to the next key when one is limited', async () => {
    const j = job({ 'k-main': 'rate-limited' });
    expect(await withAi('u', 'main', j.run)).toEqual({ value: 'k-second' });
    expect(j.tried).toEqual(['k-main', 'k-second']);
  });

  test('a limited key rests: background work leaves it alone, the person’s requests try it last', async () => {
    await withAi('u', 'background', job({ 'k-bg': 'rate-limited', 'k-second': 'unavailable' }).run);
    const bg = job({});
    expect(await withAi('u', 'background', bg.run)).toEqual({ value: 'k-second' });
    expect(bg.tried).toEqual(['k-second']);
    const fg = job({ 'k-main': 'unavailable', 'k-second': 'unavailable' });
    await withAi('u', 'main', fg.run);
    expect(fg.tried).toEqual(['k-main', 'k-second', 'k-bg']);
  });

  test('background work never borrows the main key', async () => {
    const j = job({ 'k-bg': 'unavailable', 'k-second': 'unavailable' });
    expect(await withAi('u', 'background', j.run)).toEqual({ problem: 'unavailable' });
    expect(j.tried).toEqual(['k-bg', 'k-second']);
  });

  test('an unusable answer is not retried on other keys; backup off tries one key', async () => {
    const bad = job({ 'k-main': 'bad-output' });
    expect(await withAi('u', 'main', bad.run)).toEqual({ problem: 'bad-output' });
    expect(bad.tried).toEqual(['k-main']);
    settings.fallback = false;
    const one = job({ 'k-main': 'rate-limited' });
    expect(await withAi('u', 'main', one.run)).toEqual({ problem: 'rate-limited' });
    expect(one.tried).toEqual(['k-main']);
  });

  test('Intelligence off: nothing is sent', async () => {
    settings.enabled = false;
    const j = job({});
    expect(await withAi('u', 'main', j.run)).toEqual({ problem: 'not-ready' });
    expect(j.tried).toEqual([]);
  });
});
