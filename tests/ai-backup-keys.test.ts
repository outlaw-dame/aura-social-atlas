import { beforeEach, describe, expect, test } from 'bun:test';

// Invented keys and settings.
const keys = [
  { id: 'k-main', provider: 'anthropic', label: null, hint: '…0001', models: ['haiku'], model: 'haiku' },
  { id: 'k-second', provider: 'anthropic', label: 'Personal', hint: '…0002', models: ['haiku'], model: 'haiku' },
  { id: 'k-bg', provider: 'openai', label: null, hint: '…0003', models: ['mini'], model: 'mini' },
];
let settings: SettingsRow;
// The store module imports the database client; this test passes its own settings and keys instead, so nothing is
// mocked (a module mock would leak into other test files).
const { runWithKeys, _resetResting, noteFailure } = await import('../src/lib/intelligence/store.server');
const { ProviderError } = await import('../src/lib/intelligence/llm');
type SettingsRow = import('../src/lib/intelligence/store.server').SettingsRow;
const open = async (id: string) => ({ provider: keys.find(k => k.id === id)!.provider as 'anthropic', key: `secret-${id}` });
const withAi = <T,>(_u: string, role: 'main' | 'background', job: (c: { key: string }) => Promise<T>) => runWithKeys(settings, keys as never, open, role, job);

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

  test('a key out of credit (HTTP 402) rests: background work answers no-credit without asking again', async () => {
    settings.fallback = false;
    const first = job({ 'k-bg': 'no-credit' });
    expect(await withAi('u', 'background', first.run)).toEqual({ problem: 'no-credit' });
    const again = job({});
    expect(await withAi('u', 'background', again.run)).toEqual({ problem: 'no-credit' });
    expect(again.tried).toEqual([]);
    // The person's own request still tries it, so adding credit shows at once.
    settings.main_key = 'k-bg';
    const mine = job({});
    expect(await withAi('u', 'main', mine.run)).toEqual({ value: 'k-bg' });
    // The verified recovery must also clear the cooldown, rather than starving future background checks.
    const recovered = job({});
    expect(await withAi('u', 'background', recovered.run)).toEqual({ value: 'k-bg' });
    expect(recovered.tried).toEqual(['k-bg']);
  });

  test('streamed HTTP 402 also marks the key out of credit for background work', async () => {
    settings.fallback = false;
    noteFailure('k-bg', { statusCode: 402 });
    const j = job({});
    expect(await withAi('u', 'background', j.run)).toEqual({ problem: 'no-credit' });
    expect(j.tried).toEqual([]);
  });

  test('Intelligence off: nothing is sent', async () => {
    settings.enabled = false;
    const j = job({});
    expect(await withAi('u', 'main', j.run)).toEqual({ problem: 'not-ready' });
    expect(j.tried).toEqual([]);
  });
});
