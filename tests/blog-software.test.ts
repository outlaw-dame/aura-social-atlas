import { describe, expect, test } from 'bun:test';
import { fromStatuses } from '../src/lib/fedizen-feed';
import { fromBonfireArticles, standfirstText } from '../src/lib/spotlight';

/**
 * Posts from blogging software as Fedizen (Bonfire) passes them to apps: the object's `name` as `name`, its `summary`
 * as `spoiler_text` whatever the object is. Shapes from each project's own code (cited per case); servers are
 * invented under .example except where the software's own domain is the point.
 */
const status = (acct: string, o: { name?: string | null; summary?: string; content: string }) => ({
  id: 's', created_at: '2026-11-27T10:00:00Z', url: `https://${acct.split('@')[1]}/p/1`, uri: `https://${acct.split('@')[1]}/p/1`,
  account: { id: 'a', acct, display_name: 'Someone' }, name: o.name ?? null, spoiler_text: o.summary ?? '', content: o.content,
  sensitive: !!o.summary, media_attachments: [],
});
const one = (s: ReturnType<typeof status>) => fromStatuses([s as never])[0]!;

describe('blogging software, as each sends articles and notes', () => {
  test('WriteFreely Article: summary is the preview with " [...]" (posts.go PreviewObject), shown without the mark', () => {
    const p = one(status('blog@write.example', { name: 'On gardens', summary: '<p>Gardens are slow.</p> [...]', content: '<p>Gardens are slow.</p><p>And patient.</p>' }));
    expect(p.longform).toEqual({ title: 'On gardens', lede: 'Gardens are slow.' });
    expect(p.cw).toBeUndefined();
    expect(p.paragraphs).toEqual(['On gardens', 'Gardens are slow.', 'And patient.']);
  });
  test('WriteFreely titled Note (one paragraph): an <h1> title in the content, no summary, shown once', () => {
    const p = one(status('blog@write.example', { name: 'Short one', content: '<h1>Short one</h1>\n\n<p>Just a line.</p>' }));
    expect(p.longform).toBeUndefined();
    expect(p.paragraphs).toEqual(['Short one', 'Just a line.']);
  });
  test('WordPress Article: a generated excerpt ends "[…]" (generate_post_summary)', () => {
    const p = one(status('site@wp.example', { name: 'Release notes', summary: 'What changed this month, and why it matters for […]', content: '<p>Body.</p>' }));
    expect(p.longform?.lede).toBe('What changed this month, and why it matters for');
  });
  test('WordPress Article with a content warning: summary is the warning; it still stands before the body', () => {
    const p = one(status('site@wp.example', { name: 'Hard week', summary: 'Grief', content: '<p>Body.</p>' }));
    expect(p.longform).toEqual({ title: 'Hard week', lede: 'Grief' });
  });
  test('WordPress Note (post formats, or "Note" mode): no name; summary, if any, is a warning', () => {
    const p = one(status('site@wp.example', { summary: 'spoilers', content: '<p><strong>Title</strong></p><p>Status.</p>' }));
    expect(p.cw).toBe('spoilers');
    expect(p.longform).toBeUndefined();
  });
  test('Plume Article: summary is the subtitle (posts.rs to_activity); without one it is title and body', () => {
    expect(one(status('blog@plume.example', { name: 'Rust and me', summary: 'A subtitle', content: '<p>Body.</p>' })).longform).toEqual({ title: 'Rust and me', lede: 'A subtitle' });
    const bare = one(status('blog@plume.example', { name: 'Rust and me', summary: '', content: '<p>Body.</p>' }));
    expect(bare.longform).toBeUndefined();
    expect(bare.cw).toBeUndefined();
    expect(bare.paragraphs).toEqual(['Rust and me', 'Body.']);
  });
  test('Ghost: Article with the custom excerpt as summary and the full post; Notes without a title', () => {
    expect(one(status('index@ghost.example', { name: 'Issue 12', summary: 'This week in open social.', content: '<p>Full text.</p>' })).longform?.lede).toBe('This week in open social.');
    expect(one(status('index@ghost.example', { content: '<p>A short update.</p>' })).longform).toBeUndefined();
  });
  test('Micro.blog and Inkwell stickies: Notes, shown as posts', () => {
    expect(one(status('manton@micro.example', { content: '<p>Coffee and code.</p>' })).paragraphs).toEqual(['Coffee and code.']);
    expect(one(status('writer@inkwell.social', { content: '<p>A sticky note.</p>' })).longform).toBeUndefined();
  });
  test('Lemmy/PieFed posts: titled, no summary: title and body, no fold', () => {
    const p = one(status('news@lemmy.example', { name: 'A link post', content: '<p>Discuss.</p>' }));
    expect(p.longform).toBeUndefined();
    expect(p.paragraphs).toEqual(['A link post', 'Discuss.']);
  });
  test('Misskey-family Note: summary is the content warning; MFM arrives as FEP-c16b spans and is kept', () => {
    const p = one(status('ai@misskey.example', { summary: 'loud', content: '<p><span class="mfm-x2">big</span> words</p>' }));
    expect(p.cw).toBe('loud');
    expect(p.longform).toBeUndefined();
    expect(JSON.stringify(p.rich)).toContain('"name":"x2"');
  });
  test('the Articles reader cleans summaries the same way', () => {
    expect(standfirstText('<p>One.</p><p>Two.</p> [...]')).toBe('One. Two.');
    expect(standfirstText('Ends with an ellipsis…')).toBe('Ends with an ellipsis…');
    const [a] = fromBonfireArticles([{ id: '1', objectPostContent: { name: 'T', summary: 'Excerpt […]', htmlBody: '<p>Body.</p>' } } as never]);
    expect(a!.summary).toBe('Excerpt');
  });
});
