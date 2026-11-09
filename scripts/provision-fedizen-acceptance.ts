/**
 * Local-only, operator-initiated disposable test-account OAuth provisioning.
 *
 * Run: bun scripts/provision-fedizen-acceptance.ts --account A
 *      bun scripts/provision-fedizen-acceptance.ts --account B
 *
 * Requires gh CLI authenticated with rights to manage repository environment
 * secrets. Tokens never enter command arguments, output, files, or GitHub logs.
 * No production Atlas database credentials are accessed.
 *
 * This is independent of Atlas's deployed OAuth callback. It does not prove
 * that Atlas OIDC login or native private GraphQL works.
 */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';

const HOST = '127.0.0.1';
const FEDIZEN = 'https://fedizen.net';
const REPO = 'outlaw-dame/aura-social-atlas';
const ENVIRONMENT = 'fedizen-integration';
const DEADLINE_MS = 180_000;
const b64url = (v: Buffer) => v.toString('base64url');
const fail = (message: string): never => { throw new Error(message); };

export function normalizeFedizenHandle(input: string): string | null {
  const handle = input.toLowerCase().replace(/^@/, '');
  const name = handle.endsWith('@fedizen.net') ? handle.slice(0, -'@fedizen.net'.length) : handle;
  if (!/^[a-z0-9_][a-z0-9_.-]{0,318}$/.test(name)) return null;
  return name;
}

export function sameFedizenHandle(expected: string, remote: string): boolean {
  const a = normalizeFedizenHandle(expected);
  const b = normalizeFedizenHandle(remote);
  // Only local Fedizen identities: never silently treat a remote @domain
  // as equivalent to a username on the local instance.
  return a !== null && b !== null && a === b;
}

async function boundedJson(response: Response, maxBytes = 32_768): Promise<Record<string, unknown>> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) fail('Unexpected upstream response size.');
  if (!response.body) fail('Missing upstream response.');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) fail('Unexpected upstream response size.');
      parts.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let i = 0;
  for (const part of parts) { data.set(part, i); i += part.length; }
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Unexpected upstream response schema.');
  return value as Record<string, unknown>;
}

async function fedizenFetch(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    fail('Fedizen declined the OAuth operation.');
  }
  return boundedJson(response);
}

async function gh(args: string[], value?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'ignore', 'ignore'], env: process.env });
    child.on('error', () => reject(new Error('GitHub CLI is unavailable.')));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('GitHub CLI authorization or secret update failed.')));
    child.stdin.on('error', () => {}); // child may exit before consuming input
    child.stdin.end(value ?? '');
  });
}

async function prompt(question: string): Promise<string> {
  const rl = await import('node:readline/promises');
  const input = rl.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); }
  finally { input.close(); }
}

async function oauthForExpectedHandle(expectedHandle: string): Promise<string> {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(32));
  let acceptCode!: (code: string) => void;
  let denyCode!: (error: Error) => void;
  let callbackConsumed = false;
  const callback = new Promise<string>((resolve, reject) => {
    acceptCode = resolve;
    denyCode = reject;
  });
  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', `http://${HOST}`);
    if (req.method !== 'GET' || requestUrl.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    if (callbackConsumed) { res.writeHead(409).end(); return; }
    const providedState = requestUrl.searchParams.get('state');
    // Unrecognized callbacks must not abort the legitimate OAuth authorization.
    if (providedState !== state) { res.writeHead(400).end(); return; }
    callbackConsumed = true;
    const code = requestUrl.searchParams.get('code');
    if (!code || code.length > 8192 || requestUrl.searchParams.has('error')) {
      res.writeHead(400, { 'cache-control': 'no-store' }).end('Authorization rejected.');
      denyCode(new Error('Authorization callback rejected.'));
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/plain', 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    }).end('Authorization received. Return to your terminal.');
    acceptCode(code);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') fail('Local callback listener unavailable.');
    const redirectUri = `http://${HOST}:${address.port}/callback`;
    const app = await fedizenFetch(`${FEDIZEN}/api/v1/apps`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_name: 'Atlas local acceptance (disposable)', redirect_uris: redirectUri, scopes: 'read', website: FEDIZEN }),
    });
    if (typeof app.client_id !== 'string' || typeof app.client_secret !== 'string' ||
        !app.client_id || !app.client_secret) fail('Fedizen OAuth registration invalid.');
    const authorization = new URL(`${FEDIZEN}/oauth/authorize`);
    authorization.search = new URLSearchParams({
      response_type: 'code', client_id: app.client_id, redirect_uri: redirectUri,
      scope: 'read', code_challenge: challenge, code_challenge_method: 'S256', state,
    }).toString();
    console.log('Open the Fedizen authorization URL and approve only the disposable account:');
    console.log(authorization.toString()); // PKCE challenge and random state, no credential
    const code = await Promise.race([
      callback,
      delay(DEADLINE_MS, undefined, { ref: false }).then(() => fail('OAuth callback timed out.')),
    ]);
    const grant = await fedizenFetch(`${FEDIZEN}/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: app.client_id, client_secret: app.client_secret, code_verifier: verifier }),
    });
    if (typeof grant.access_token !== 'string' || !grant.access_token ||
        grant.access_token.length > 8192 || /[\r\n]/.test(grant.access_token) ||
        (grant.scope !== undefined && (typeof grant.scope !== 'string' || !grant.scope.split(/\s+/).includes('read')))) {
      fail('Fedizen delegated read grant invalid.');
    }
    const identity = await fedizenFetch(`${FEDIZEN}/api/v1/accounts/verify_credentials`, {
      method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${grant.access_token}` },
    });
    if (typeof identity.acct !== 'string' || !sameFedizenHandle(expectedHandle, identity.acct)) {
      fail('Consented OAuth bearer identity does not match the expected disposable account.');
    }
    return grant.access_token;
  } finally {
    server.close();
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    assert.equal(sameFedizenHandle('Test@fedizen.net', 'test'), true);
    assert.equal(sameFedizenHandle('@Test@fedizen.net', 'TEST'), true);
    assert.equal(sameFedizenHandle('Test@other.invalid', 'test'), false);
    assert.equal(sameFedizenHandle('test@fedizen.net', 'other'), false);
    assert.equal(sameFedizenHandle('test', 'test@evil.invalid'), false);
    assert.equal(sameFedizenHandle('test', 'test@fedizen.net.evil.invalid'), false);
    assert.equal(sameFedizenHandle('test', ''), false);
    assert.equal(sameFedizenHandle('test', 'test\\n'), false);
    assert.equal(normalizeFedizenHandle('test@other.invalid'), null);
    assert.equal(normalizeFedizenHandle('bad user'), null);
    console.log('PASS: local Fedizen account identity validation');
    return;
  }
  const label = process.argv[process.argv.indexOf('--account') + 1];
  if ((label !== 'A' && label !== 'B') || process.argv.filter(x => x === '--account').length !== 1) {
    fail('Specify --account A or --account B.');
  }
  await gh(['auth', 'status', '--hostname', 'github.com']);
  const expected = await prompt(`Disposable account ${label} Fedizen handle: `);
  if (!normalizeFedizenHandle(expected)) fail('Invalid disposable-account handle.');
  const name = label === 'A' ? 'FEDIZEN_TEST_READ_TOKEN' : 'FEDIZEN_TEST_SECOND_READ_TOKEN';
  const handleName = label === 'A' ? 'FEDIZEN_TEST_EXPECTED_HANDLE' : 'FEDIZEN_TEST_SECOND_EXPECTED_HANDLE';
  const token = await oauthForExpectedHandle(expected);
  // gh secret set reads the secret from stdin; never use command arguments.
  await gh(['secret', 'set', name, '--repo', REPO, '--env', ENVIRONMENT], token);
  await gh(['secret', 'set', handleName, '--repo', REPO, '--env', ENVIRONMENT], expected);
  console.log(`Configured protected environment read grant and expected handle for disposable account ${label}.`);
  console.log('No private post fixture was created or provisioned.');
}

try { await main(); }
catch { console.error('FAIL: local Fedizen acceptance provisioning (no credentials disclosed).'); process.exitCode = 1; }
