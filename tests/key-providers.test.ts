import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { PROVIDER_IDS } from '../src/lib/intelligence/providers';

// The newest migration that sets atlas_ai_keys_provider_check must allow every key Atlas saves, or saving it fails in
// the database (as DeepL and the embedding providers did on staging).
describe('the key vault accepts every provider Atlas offers', () => {
  test('latest provider check lists PROVIDER_IDS and deepl', () => {
    const dir = 'supabase/migrations';
    const latest = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().reverse()
      .map(f => readFileSync(`${dir}/${f}`, 'utf8')).find(sql => sql.includes('add constraint atlas_ai_keys_provider_check'));
    expect(latest).toBeDefined();
    const allowed = [...latest!.matchAll(/'([a-z]+)'/g)].map(m => m[1]);
    for (const p of [...PROVIDER_IDS, 'deepl']) expect(allowed).toContain(p);
  });
});
