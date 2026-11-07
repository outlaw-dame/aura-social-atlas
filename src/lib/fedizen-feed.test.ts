import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { allowedCallback, FEDIZEN_API_SCOPE, hasScope, safeReturnPath } from './fedizen-feed';

describe('Fedizen connection', () => {
  test('asks Fedizen to read and to act for the person', () => strictEqual(FEDIZEN_API_SCOPE, 'read write follow'));
  test('a parent scope covers its children; an older read-only grant does not cover writes', () => {
    strictEqual(hasScope('read write follow', 'write'), true);
    strictEqual(hasScope('read write', 'write:follows'), true);
    strictEqual(hasScope('read', 'write'), false);
    strictEqual(hasScope(null, 'read'), false);
  });
  test('returns only to same-site paths after connecting', () => {
    strictEqual(safeReturnPath('/groups?group=01ABC'), '/groups?group=01ABC');
    strictEqual(safeReturnPath('/app'), '/app');
    strictEqual(safeReturnPath('//evil.example'), '/feeds');
    strictEqual(safeReturnPath('/\\evil.example'), '/feeds');
    strictEqual(safeReturnPath('https://evil.example'), '/feeds');
    strictEqual(safeReturnPath('/fedizen/callback'), '/feeds');
    strictEqual(safeReturnPath(null), '/feeds');
  });
  test('returns codes only to Atlas hosts', () => {
    strictEqual(allowedCallback('https://atlas.lovable.app'), 'https://atlas.lovable.app/fedizen/callback');
    strictEqual(allowedCallback('https://evil.example'), null);
    strictEqual(allowedCallback('http://atlas.lovable.app'), null);
  });
});
