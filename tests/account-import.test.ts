import { describe, expect, test } from 'bun:test';
import { parseCsv, readImport } from '../src/lib/account-import';

// Invented accounts and servers, in the shapes Mastodon's and Bonfire's exports use.
describe('reading exports from Mastodon and Bonfire', () => {
  test('CSV: quotes, commas and line breaks inside fields, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,"b, c"\r\n"d ""e""",f\n\n')).toEqual([['a', 'b, c'], ['d "e"', 'f']]);
  });

  test("Mastodon's following list: header skipped, handles lower-cased and deduplicated", () => {
    const f = readImport('following_accounts.csv', 'Account address,Show boosts,Notify on new posts,Languages\nAnn@Example.social,true,false,\nann@example.social,true,false,\nben@lemmy.example,false,false,en\nnot-a-handle,true,false,\n');
    expect(f).toEqual({ kind: 'following', accounts: ['ann@example.social', 'ben@lemmy.example'], skipped: 1 });
  });

  test('blocked and muted lists by file name; Bonfire names too', () => {
    expect(readImport('blocked_accounts.csv', 'spam@spam.example\n').kind).toBe('blocks');
    expect(readImport('muted_accounts.csv', 'Account address,Hide notifications\nann@example.social,true\n').kind).toBe('mutes');
    expect(readImport('silenced.csv', 'Account address\nann@example.social\n').kind).toBe('mutes');
    expect(readImport('following.csv', 'Account address\nann@example.social\n').kind).toBe('following');
  });

  test('a list of handles under another name can be told what to do', () => {
    expect(readImport('people.csv', 'ann@example.social\n', 'blocks')).toMatchObject({ kind: 'blocks', accounts: ['ann@example.social'] });
  });

  test('lists (circles): name and handle per row', () => {
    expect(readImport('lists.csv', 'Friends,ann@example.social\n"Art, mostly",ben@lemmy.example\nFriends,ann@example.social\n')).toEqual({
      kind: 'lists', members: [{ list: 'Friends', account: 'ann@example.social' }, { list: 'Art, mostly', account: 'ben@lemmy.example' }], skipped: 0,
    });
  });

  test('blocked servers and bookmarks are recognised, even without their file names', () => {
    expect(readImport('a.csv', 'spam.example\nbad.example\n')).toEqual({ kind: 'domain-blocks', domains: ['spam.example', 'bad.example'] });
    expect(readImport('b.csv', 'https://example.social/@ann/1\n')).toEqual({ kind: 'bookmarks', urls: ['https://example.social/@ann/1'] });
  });

  test("Mastodon's filter export is handed to keyword filters; anything else is unknown", () => {
    expect(readImport('export.json', '{"custom_filters":[]}').kind).toBe('filters');
    expect(readImport('x.json', '{"other":1}').kind).toBe('unknown');
    expect(readImport('x.csv', 'hello world\n').kind).toBe('unknown');
  });
});
