import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { requestBonfireGraphQL } from '../src/lib/bonfire-graphql.server';
import { resetRateLimitState } from '../src/lib/fedizen-rate-limit';
import { PROFILE_IMAGE_MAX_BYTES, profileImageProblem } from '../src/lib/fedizen-profile';
import { updateMyFedizenProfileImage } from '../src/lib/fedizen-profile.server';
import { UPDATE_MY_PROFILE_IMAGES_DOCUMENT } from '../src/lib/bonfire/graphql/operations';

const png = (bytes = 8) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });
const mutation = (overrides: Record<string, unknown> = {}) => ({
  operation: 'mutation' as const,
  document: UPDATE_MY_PROFILE_IMAGES_DOCUMENT,
  accessToken: 'token-a',
  variables: { images: { icon: 'icon' } },
  files: { icon: { blob: png(), name: 'me.png' } },
  validate: (d: unknown) => d,
  waitImpl: async () => {},
  ...overrides,
});
const answer = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => resetRateLimitState());

describe('profile pictures go to Fedizen as a GraphQL multipart upload', () => {
  test('one form: the query, the variables naming the part, and the file under that name', async () => {
    let seen: FormData | undefined;
    const fetchImpl = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData);
      // The runtime must set the multipart boundary itself.
      expect(new Headers(init?.headers).get('content-type')).toBeNull();
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-a');
      seen = init?.body as FormData;
      return answer({ ok: true });
    });
    await requestBonfireGraphQL(mutation({ fetchImpl }));
    expect(seen?.get('query')).toBe(UPDATE_MY_PROFILE_IMAGES_DOCUMENT);
    expect(JSON.parse(String(seen?.get('variables')))).toEqual({ images: { icon: 'icon' } });
    const file = seen?.get('icon');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('me.png');
  });

  test('files are refused on queries and under names that would clash or inject', async () => {
    const fetchImpl = mock(async () => answer({ ok: true }));
    for (const bad of [
      mutation({ operation: 'query', fetchImpl }),
      mutation({ files: { query: { blob: png(), name: 'x.png' } }, fetchImpl }),
      mutation({ files: { variables: { blob: png(), name: 'x.png' } }, fetchImpl }),
      mutation({ files: { 'Icon"; x': { blob: png(), name: 'x.png' } }, fetchImpl }),
      mutation({ files: { ['a'.repeat(33)]: { blob: png(), name: 'x.png' } }, fetchImpl }),
    ]) await expect(requestBonfireGraphQL(bad)).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('an upload is sent once: a failure is never retried', async () => {
    const fetchImpl = mock(async () => new Response('', { status: 503 }));
    await expect(requestBonfireGraphQL(mutation({ fetchImpl }))).rejects.toMatchObject({ kind: 'http', status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('which pictures Atlas accepts', () => {
  test('JPEG, PNG, WebP and GIF up to 5 MB; nothing else', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
      expect(profileImageProblem(new Blob([new Uint8Array(4)], { type }))).toBeNull();
    for (const type of ['image/svg+xml', 'image/heic', 'text/html', ''])
      expect(profileImageProblem(new Blob([new Uint8Array(4)], { type }))).toBe('unsupported');
    expect(profileImageProblem(png(PROFILE_IMAGE_MAX_BYTES))).toBeNull();
    expect(profileImageProblem(png(PROFILE_IMAGE_MAX_BYTES + 1))).toBe('too-large');
    expect(profileImageProblem(png(0))).toBe('unsupported');
  });
});

describe('updateMyFedizenProfileImage', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('the avatar goes in `icon`, the banner in `image`, and only the new https address comes back', async () => {
    const fields: string[] = [];
    globalThis.fetch = mock(async (_u: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      const images = JSON.parse(String(form.get('variables'))).images as Record<string, string>;
      fields.push(...Object.keys(images));
      for (const [key, part] of Object.entries(images)) expect(form.get(part)).toBeInstanceOf(Blob), expect(key).toBe(part);
      return answer({ updateUser: { user: { id: 'U1', profile: { icon: 'https://fedizen.net/new-icon.png', image: 'https://fedizen.net/new-banner.png' } } } });
    }) as unknown as typeof fetch;
    expect(await updateMyFedizenProfileImage('t', 'U1', 'avatar', png(), 'me.png')).toBe('https://fedizen.net/new-icon.png');
    expect(await updateMyFedizenProfileImage('t', 'U1', 'banner', png(), 'sky.png')).toBe('https://fedizen.net/new-banner.png');
    expect(fields).toEqual(['icon', 'image']);
  });

  test('an answer about a different user is not trusted', async () => {
    globalThis.fetch = mock(async () => answer({ updateUser: { user: { id: 'SOMEONE-ELSE', profile: { icon: 'https://fedizen.net/x.png', image: null } } } })) as unknown as typeof fetch;
    expect(await updateMyFedizenProfileImage('t', 'U1', 'avatar', png(), 'me.png')).toBeNull();
  });

  test('a file Atlas does not accept is never sent', async () => {
    const f = mock(async () => answer({}));
    globalThis.fetch = f as unknown as typeof fetch;
    await expect(updateMyFedizenProfileImage('t', 'U1', 'avatar', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg')).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
