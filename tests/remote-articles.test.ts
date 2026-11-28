import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fromStatuses, longformOf } from '../src/lib/fedizen-feed';
import { articleBody } from '../src/lib/spotlight';

// Shaped as Fedizen (Bonfire) sends them: the object's `summary` as spoiler_text, its title as `name`.
// Inkwell's Article content is "a short lead (title, excerpt, link, hashtags), then an <hr>, then the full body".
const inkwell = {
  id: 's1', created_at: '2026-11-27T10:00:00Z', url: 'https://inkwell.social/writer/natural', uri: 'https://inkwell.social/entries/1',
  account: { id: 'a1', acct: 'writer@inkwell.social', display_name: 'Writer' },
  name: 'Natural &amp; Artificial', spoiler_text: 'Some hard ideas from Hannah Arendt.',
  content: '<p><strong>Natural &amp; Artificial</strong></p><p>Some hard ideas from Hannah Arendt.</p><p><a href="https://inkwell.social/writer/natural">Read on Inkwell</a></p><hr><p>First paragraph of the essay.</p><p>Second.</p>',
  sensitive: true, media_attachments: [],
};

describe('long-form articles from other servers', () => {
  test("an Inkwell article: its summary is the standfirst, not a content warning, and the lead isn't repeated", () => {
    const [p] = fromStatuses([inkwell as never]);
    expect(p!.cw).toBeUndefined();
    expect(p!.longform).toEqual({ title: 'Natural & Artificial', lede: 'Some hard ideas from Hannah Arendt.' });
    expect(p!.paragraphs).toEqual(['Natural & Artificial', 'First paragraph of the essay.', 'Second.']);
  });
  test('a note with a content warning keeps it; so do Fedizen’s own titled posts', () => {
    const note = { ...inkwell, name: null, account: { id: 'a2', acct: 'ann@mastodon.example' }, spoiler_text: 'spoilers', content: '<p>The butler did it.</p>' };
    expect(fromStatuses([note as never])[0]!.cw).toBe('spoilers');
    expect(fromStatuses([note as never])[0]!.longform).toBeUndefined();
    const local = { ...inkwell, account: { id: 'a3', acct: 'damon' } };
    expect(fromStatuses([local as never])[0]!.cw).toBe('Some hard ideas from Hannah Arendt.');
    expect(longformOf({ ...local })).toBeUndefined();
    expect(longformOf({ name: 'A Lemmy post', spoiler_text: '', account: { acct: 'x@lemmy.world' } })).toBeUndefined();
  });
  test('only a preview lead (title, excerpt, link) is dropped: an article’s own opening section stays', () => {
    const ex = 'Some hard ideas from Hannah Arendt.';
    const sections = '<p>Phishing is common.</p><table><tr><td>a</td></tr></table><hr><p>Part two.</p>';
    expect(articleBody(sections, 'Phishing: an attack on people', 'Phishing is the most common way in.')).toBe(sections);
    expect(articleBody('<p>Title</p><hr>', 'Title', ex)).toBe('<p>Title</p><hr>');
    // An introduction that starts with the heading is the article's, not a preview (Codex review).
    const intro = '<h1>Title</h1><p>Unique introduction.</p><hr><p>Next section.</p>';
    expect(articleBody(intro, 'Title', 'A different summary of the whole piece.')).toBe(intro);
    expect(articleBody('<h1>Title</h1><p>Some hard ideas from Hannah Arendt.</p><hr><p>Next.</p>', 'Title', ex)).toContain('<h1>Title</h1>');
    expect(articleBody(inkwell.content, 'Natural & Artificial', undefined)).toBe(inkwell.content);
    expect(articleBody(inkwell.content, 'Natural & Artificial', ex)).toBe('<p>First paragraph of the essay.</p><p>Second.</p>');
  });
  test('an article’s title and standfirst are translated with its body', async () => {
    const { translationJob, detectionText } = await import('../src/lib/translation/segments');
    const [p] = fromStatuses([inkwell as never]);
    const job = translationJob(p!, 'plain');
    expect(job.texts).toContain('Natural & Artificial');
    expect(job.texts).toContain('Some hard ideas from Hannah Arendt.');
    const out = job.build(job.texts.map(t => `FR ${t}`));
    expect(out.longform).toEqual({ title: 'FR Natural & Artificial', lede: 'FR Some hard ideas from Hannah Arendt.' });
    expect(detectionText(p!)).toContain('Hannah Arendt');
  });
  test('the standfirst stands before the body on every feed card, and keyword filters read it', () => {
    for (const f of ['src/components/social/FeedPostCard.tsx', 'src/components/f7/MobilePostCard.tsx', 'src/components/social/SavedAndCircles.tsx', 'src/components/f7/SavedAndCircles.tsx', 'src/components/f7/FedizenMobile.tsx']) {
      expect(readFileSync(f, 'utf8')).toMatch(/<AuthorWarning cw=\{p\.cw\} article=\{p\.longform\}/);
    }
    expect(readFileSync('src/lib/content-filter.ts', 'utf8')).toContain("p.longform?.lede ?? ''");
  });
});
