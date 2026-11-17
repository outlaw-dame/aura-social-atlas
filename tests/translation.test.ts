import { describe, test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { detectionText, parseHtml, parsePlain, translationJob } from '../src/lib/translation/segments';
import { browserLanguages, deeplTarget, readingKey, sameLanguage } from '../src/lib/translation/languages';
import { parseTranslation, readOf, targetOf } from '../src/lib/translation/prefs';
import type { FedizenPost } from '../src/lib/fedizen-feed';

const post = (extra: Partial<FedizenPost>): FedizenPost => ({ id: '1', statusId: '1', author: 'a', handle: '@a@x.example', paragraphs: [], url: 'https://x.example/1', ...extra });

describe('what is translated, and what comes back untouched', () => {
  test('plain: mentions, hashtags, links and emoji become placeholders and come back', () => {
    const job = translationJob(post({ paragraphs: ['Hola @ana@social.example mira https://x.example/a #gatos :blobcat:'] }), 'plain');
    strictEqual(job.texts[0], 'Hola {0} mira {1} {2} {3}');
    const out = job.build(['Hi {0} look {1} {2} {3}']);
    strictEqual(out.paragraphs[0], 'Hi @ana@social.example look https://x.example/a #gatos :blobcat:');
    strictEqual(out.rich, undefined);
  });

  test('plain: a placeholder the engine lost is added back at the end', () => {
    const job = translationJob(post({ paragraphs: ['Hola @ana'] }), 'plain');
    strictEqual(job.build(['Hello'])[('paragraphs')][0], 'Hello @ana');
  });

  test('html: bold stays bold, links keep their address, kept things are untranslatable spans', () => {
    const p = post({ paragraphs: ['Lee esto'], rich: [{ t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: 'Lee' }] }, { t: 'text', v: ' ' }, { t: 'link', href: 'https://x.example/doc', c: [{ t: 'text', v: 'esto' }] }, { t: 'text', v: ' ' }, { t: 'code', v: 'npm i' }] }] });
    const job = translationJob(p, 'html');
    strictEqual(job.texts[0], '<b>Lee</b> <a data-k="0">esto</a> <span translate="no" data-k="1">npm i</span>');
    const out = job.build(['<b>Read</b> <a data-k="0">this</a> <span translate="no" data-k="1">npm i</span>']);
    deepStrictEqual(out.rich, [{ t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: 'Read' }] }, { t: 'text', v: ' ' }, { t: 'link', href: 'https://x.example/doc', c: [{ t: 'text', v: 'this' }] }, { t: 'text', v: ' ' }, { t: 'code', v: 'npm i' }] }]);
    strictEqual(out.paragraphs[0], 'Read this npm i');
  });

  test('html: an engine can never add a link or markup of its own', () => {
    const keep = [{ t: 'text' as const, v: '#tag' }];
    deepStrictEqual(parseHtml('<a href="https://evil.example">click</a> <img src=x onerror=alert(1)> <span translate="no" data-k="0">#tag</span>', keep),
      [{ t: 'text', v: 'click <img src=x onerror=alert(1)> ' }, { t: 'text', v: '#tag' }]);
  });

  test('content warning, quotes, lists and poll options are translated; code blocks are not', () => {
    const p = post({
      cw: 'Spoiler', paragraphs: ['x'],
      rich: [{ t: 'quote', c: [{ t: 'p', c: [{ t: 'text', v: 'Cita' }] }] }, { t: 'pre', v: 'const a = 1' }, { t: 'list', ordered: false, items: [[{ t: 'p', c: [{ t: 'text', v: 'Uno' }] }]] }],
      pollState: { id: 'p', options: [{ title: 'Sí' }, { title: 'No' }], multiple: false, expired: false, voted: false, ownVotes: [] },
      poll: ['Sí', 'No'],
    });
    const job = translationJob(p, 'plain');
    deepStrictEqual(job.texts, ['Spoiler', 'Cita', 'Uno', 'Sí', 'No']);
    const out = job.build(['Spoiler!', 'Quote', 'One', 'Yes', 'No']);
    strictEqual(out.cw, 'Spoiler!');
    deepStrictEqual(out.rich, [{ t: 'quote', c: [{ t: 'p', c: [{ t: 'text', v: 'Quote' }] }] }, { t: 'pre', v: 'const a = 1' }, { t: 'list', ordered: false, items: [[{ t: 'p', c: [{ t: 'text', v: 'One' }] }]] }]);
    deepStrictEqual(out.pollState!.options.map(o => o.title), ['Yes', 'No']);
    deepStrictEqual(out.poll, ['Yes', 'No']);
  });

  test('plain parse turns new lines into breaks', () => {
    deepStrictEqual(parsePlain('a\nb', []), [{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b' }]);
  });

  test('detection reads only words', () => {
    strictEqual(detectionText(post({ cw: 'Ojo', paragraphs: ['Hola @ana https://x.example #tag :blob:'] })), 'Ojo Hola');
  });
});

describe('languages', () => {
  test('same language by primary subtag; Chinese by script', () => {
    ok(sameLanguage('pt-BR', 'pt'));
    ok(!sameLanguage('zh-TW', 'zh-CN'));
    strictEqual(readingKey('zh-HK'), 'zh-Hant');
    strictEqual(readingKey('zh'), 'zh-Hans');
  });
  test('DeepL target codes need a variant for English, Portuguese and Chinese', () => {
    strictEqual(deeplTarget('en', 'en-GB'), 'EN-GB');
    strictEqual(deeplTarget('en', 'en-US'), 'EN-US');
    strictEqual(deeplTarget('pt', 'pt-PT'), 'PT-PT');
    strictEqual(deeplTarget('pt', 'de-DE'), 'PT-BR');
    strictEqual(deeplTarget('zh-Hant'), 'ZH-HANT');
    strictEqual(deeplTarget('ja'), 'JA');
  });
  test("the browser's languages, once each", () => {
    deepStrictEqual(browserLanguages(['en-US', 'en-GB', 'fr-CA', 'zh-TW']), ['en', 'fr', 'zh-Hant']);
  });
});

describe('settings', () => {
  test('defaults: on, automatic on this device only, no cloud service', () => {
    deepStrictEqual(parseTranslation(null), { enabled: true, auto: true, autoCloud: false, useDevice: true, cloud: 'none' });
  });
  test('bad values fall back; the target is always among the languages read', () => {
    const p = parseTranslation(JSON.stringify({ target: 'xx', read: ['fr', 'nope!!', 'fr'], cloud: 'google' }));
    deepStrictEqual(p.read, ['fr']);
    strictEqual(p.target, undefined);
    strictEqual(p.cloud, 'none');
    strictEqual(targetOf(p, ['de', 'fr']), 'de');
    deepStrictEqual(readOf(p, ['de']), ['de', 'fr']);
  });
});

describe('when to offer, and with what', () => {
  const { engines, offer } = require('../src/lib/translation/plan') as typeof import('../src/lib/translation/plan');
  const prefs = parseTranslation(null);
  const p = post({ paragraphs: ['Bonjour tout le monde'], visibility: 'public' });
  test('offered for a language the person does not read; never for one they do', () => {
    ok(offer(p, 'fr', prefs, ['en']));
    ok(!offer(p, 'fr', prefs, ['en', 'fr']));
    ok(!offer(p, 'en-GB', prefs, ['en']));
    ok(!offer(post({ paragraphs: ['🙂 🎉'] }), 'fr', prefs, ['en']));
    ok(!offer(p, 'fr', { ...prefs, enabled: false }, ['en']));
  });
  test('on the device first; the service when tapped, or automatically only when allowed', () => {
    const deepl = { ...prefs, cloud: 'deepl' as const };
    deepStrictEqual(engines(p, deepl, { manual: false, device: true, cloudReady: true }), ['device']);
    deepStrictEqual(engines(p, deepl, { manual: true, device: true, cloudReady: true }), ['device', 'deepl']);
    deepStrictEqual(engines(p, { ...deepl, autoCloud: true }, { manual: false, device: false, cloudReady: true }), ['deepl']);
    deepStrictEqual(engines(p, deepl, { manual: true, device: false, cloudReady: false }), []);
  });
  test('posts that are not public or unlisted never leave the device', () => {
    const deepl = { ...prefs, cloud: 'deepl' as const };
    deepStrictEqual(engines({ ...p, visibility: 'private' }, deepl, { manual: true, device: true, cloudReady: true }), ['device']);
    deepStrictEqual(engines({ ...p, visibility: 'direct' }, deepl, { manual: true, device: false, cloudReady: true }), []);
    deepStrictEqual(engines({ ...p, visibility: undefined }, deepl, { manual: true, device: false, cloudReady: true }), []);
  });
});

describe('DeepL', () => {
  const { deeplHost, deeplPlan, deeplTranslate, deeplUsage, DeeplError } = require('../src/lib/translation/deepl.server') as typeof import('../src/lib/translation/deepl.server');
  test('Free keys (":fx") use api-free.deepl.com, others api.deepl.com', () => {
    strictEqual(deeplHost('abcd-1234:fx'), 'https://api-free.deepl.com');
    strictEqual(deeplHost('abcd-1234'), 'https://api.deepl.com');
    strictEqual(deeplPlan('abcd:fx'), 'free');
  });
  test('translate: one request, the key in the header, html tag handling, answers in order', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ translations: [{ detected_source_language: 'FR', text: 'Hello' }, { detected_source_language: 'FR', text: '<b>world</b>' }] }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await deeplTranslate('k-1234567890:fx', { texts: ['Bonjour', '<b>monde</b>'], target: 'EN-US' }, fake);
    deepStrictEqual(r, { texts: ['Hello', '<b>world</b>'], detected: 'fr' });
    strictEqual(seen!.url, 'https://api-free.deepl.com/v2/translate');
    strictEqual((seen!.init.headers as Record<string, string>).Authorization, 'DeepL-Auth-Key k-1234567890:fx');
    const body = JSON.parse(seen!.init.body as string);
    strictEqual(body.tag_handling, 'html');
    strictEqual(body.source_lang, undefined);
    strictEqual(seen!.init.redirect, 'manual');
  });
  test('errors: bad key, quota, too many requests', async () => {
    for (const [status, code] of [[403, 'bad-key'], [456, 'quota'], [429, 'rate-limited'], [413, 'too-long'], [503, 'unavailable']] as const) {
      const fake = (async () => new Response('{}', { status })) as unknown as typeof fetch;
      await deeplUsage('k-1234567890', fake).then(() => ok(false), (e: unknown) => { ok(e instanceof DeeplError); strictEqual((e as InstanceType<typeof DeeplError>).code, code); });
    }
  });
  test('an answer with the wrong number of texts is refused', async () => {
    const fake = (async () => new Response(JSON.stringify({ translations: [{ text: 'x' }] }), { status: 200 })) as unknown as typeof fetch;
    await deeplTranslate('k-1234567890', { texts: ['a', 'b'], target: 'DE' }, fake).then(() => ok(false), (e: unknown) => strictEqual((e as InstanceType<typeof DeeplError>).code, 'unavailable'));
  });
});
