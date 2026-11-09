import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { allowedCallback, FEDIZEN_API_SCOPE } from './fedizen-feed';

describe('Fedizen connection', () => {
  test('asks Fedizen for read-only access', () => strictEqual(FEDIZEN_API_SCOPE, 'read'));
  test('returns codes only to Atlas hosts', () => {
    strictEqual(allowedCallback('https://atlas.lovable.app', 'https://atlas.lovable.app'), 'https://atlas.lovable.app/fedizen/callback');
    strictEqual(allowedCallback('https://evil.example', 'https://evil.example'), null);
    strictEqual(allowedCallback('http://atlas.lovable.app', 'http://atlas.lovable.app'), null);
  });
});
