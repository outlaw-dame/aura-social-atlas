import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('/api/health', () => {
  test('answers GET and HEAD without touching Fedizen, Supabase or a page render, and is never cached', () => {
    const src = readFileSync('src/routes/api/health.ts', 'utf8');
    expect(src).toMatch(/GET: async \(\) => health\("GET"\)/);
    expect(src).toMatch(/HEAD: async \(\) => health\("HEAD"\)/);
    expect(src).toMatch(/"cache-control": "no-store"/);
    expect(src).not.toMatch(/await import\(|from "@\/lib/);
  });
});
