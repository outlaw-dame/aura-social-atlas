import { afterEach, describe, expect, test } from 'bun:test';
import { describeImageText, ProviderError } from '../src/lib/intelligence/llm';
import { writeAltText } from '../src/lib/intelligence/tasks';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const image = { data: 'iVBORw0KGgoAAAANSUhEUg==', mediaType: 'image/jpeg' as const };

describe('alt text from the person’s AI model (vision)', () => {
  test('Anthropic gets the image as a base64 block', async () => {
    let body: any, url = '';
    globalThis.fetch = (async (u: string, init: RequestInit) => { url = u; body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'A cat on a wall.' }] })); }) as typeof fetch;
    expect(await describeImageText({ provider: 'anthropic', key: 'k'.repeat(20) }, 'claude-haiku-5-5', { system: 's', prompt: 'p', image })).toBe('A cat on a wall.');
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.data } });
  });
  test('OpenAI-compatible providers get a data URL', async () => {
    let body: any;
    globalThis.fetch = (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: ' A dog. ' } }] })); }) as typeof fetch;
    expect(await describeImageText({ provider: 'mistral', key: 'k'.repeat(20) }, 'mistral-small-latest', { system: 's', prompt: 'p', image })).toBe('A dog.');
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.data}` } });
  });
  test('a model that can’t read images is reported as such', async () => {
    globalThis.fetch = (async () => new Response('{"error":"image input not supported"}', { status: 400 })) as unknown as typeof fetch;
    const e = await describeImageText({ provider: 'openai', key: 'k'.repeat(20) }, 'gpt-x', { system: 's', prompt: 'p', image }).catch(x => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect((e as ProviderError).code).toBe('no-vision');
  });
  test('the reply is cleaned and capped', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: `Alt text: "${'x'.repeat(2000)}"` } }] }))) as unknown as typeof fetch;
    const alt = await writeAltText({ provider: 'openai', key: 'k'.repeat(20) }, 'gpt-x', image, 'my post');
    expect(alt.startsWith('x')).toBe(true);
    expect(alt.length).toBe(1500);
  });
});
