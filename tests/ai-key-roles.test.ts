import { describe, expect, test } from 'bun:test';
import { backgroundPick, embeddingPick, mainPick, plan, type RoleKey, type RoleSettings } from '../src/lib/intelligence/roles';

// Invented keys: two from Anthropic (named Work and Personal), one from OpenAI, one from Moonshot.
const work: RoleKey = { id: 'k-work', provider: 'anthropic', models: ['haiku', 'sonnet'], model: 'haiku' };
const personal: RoleKey = { id: 'k-personal', provider: 'anthropic', models: ['haiku', 'sonnet'], model: null };
const openai: RoleKey = { id: 'k-openai', provider: 'openai', models: ['mini', 'big'], model: 'mini' };
const kimi: RoleKey = { id: 'k-kimi', provider: 'moonshot', models: ['k2'], model: 'gone-model' };
const keys = [work, personal, openai, kimi];
const settings = (o: Partial<RoleSettings> = {}): RoleSettings => ({ mainKey: work.id, mainModel: 'sonnet', backgroundKey: null, backgroundModel: null, fallback: true, ...o });
const ids = (role: 'main' | 'background', s: RoleSettings) => plan(role, s, keys).map(p => `${p.keyId}:${p.model}`);

describe('which key and model does which job', () => {
  test('main: the main key and its chosen model, then the other keys in the order added, each with its own model', () => {
    expect(ids('main', settings())).toEqual(['k-work:sonnet', 'k-personal:haiku', 'k-openai:mini', 'k-kimi:k2']);
  });

  test('two keys from the same company are separate backups', () => {
    const p = plan('main', settings({ mainKey: personal.id, mainModel: null }), keys);
    expect(p.slice(0, 2).map(x => x.keyId)).toEqual(['k-personal', 'k-work']);
  });

  test('backup off: only the chosen key', () => {
    expect(ids('main', settings({ fallback: false }))).toEqual(['k-work:sonnet']);
    expect(ids('background', settings({ fallback: false, backgroundKey: openai.id }))).toEqual(['k-openai:mini']);
  });

  test('background without its own key uses the main key and model; its backups never include the main key', () => {
    expect(ids('background', settings())).toEqual(['k-work:sonnet', 'k-personal:haiku', 'k-openai:mini', 'k-kimi:k2']);
    expect(ids('background', settings({ backgroundKey: openai.id, backgroundModel: 'big' }))).toEqual(['k-openai:big', 'k-personal:haiku', 'k-kimi:k2']);
  });

  test('background on the main key with a smaller model', () => {
    expect(backgroundPick(settings({ backgroundKey: work.id, backgroundModel: 'haiku' }), keys)).toEqual({ keyId: 'k-work', provider: 'anthropic', model: 'haiku' });
  });

  test('a removed key or an unlisted model falls back safely', () => {
    expect(mainPick(settings({ mainKey: 'gone' }), keys)).toBeNull();
    expect(plan('main', settings({ mainKey: 'gone' }), keys)).toEqual([]);
    expect(backgroundPick(settings({ backgroundKey: 'gone' }), keys)?.keyId).toBe('k-work');
    expect(mainPick(settings({ mainModel: 'not-listed' }), keys)?.model).toBe('haiku');
  });

  test('embeddings: one key with an embedding model, background first, and never a mix', () => {
    expect(embeddingPick(settings(), keys)?.keyId).toBe('k-openai');
    expect(embeddingPick(settings(), [work, personal, kimi])).toBeNull();
    expect(embeddingPick(settings({ mainKey: openai.id, backgroundKey: work.id }), keys)?.keyId).toBe('k-openai');
  });
});
