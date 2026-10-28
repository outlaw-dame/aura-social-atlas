import { test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { observeSession } from './auth-session';

test('a newer sign-in event survives a delayed signed-out initial read', async () => {
  let notify: (session: string | null) => void = () => {};
  let finish: (session: string | null) => void = () => {};
  const values: (string | null)[] = [];
  observeSession<string>(fn => { notify = fn; return () => {}; },
    () => new Promise(resolve => { finish = resolve; }), value => values.push(value), () => {});
  notify('new-session');
  finish(null);
  await new Promise(resolve => setTimeout(resolve, 0));
  deepStrictEqual(values, ['new-session']);
});

test('a newer sign-out event survives a delayed signed-in initial read', async () => {
  let notify: (session: string | null) => void = () => {};
  let finish: (session: string | null) => void = () => {};
  const values: (string | null)[] = [];
  observeSession<string>(fn => { notify = fn; return () => {}; },
    () => new Promise(resolve => { finish = resolve; }), value => values.push(value), () => {});
  notify(null);
  finish('old-session');
  await new Promise(resolve => setTimeout(resolve, 0));
  deepStrictEqual(values, [null]);
});

test('initial session read failures settle loading without unhandled rejection', async () => {
  let settled = false;
  const values: (string | null)[] = [];
  observeSession<string>(() => () => {}, () => Promise.reject(new Error('storage unavailable')),
    value => values.push(value), () => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  strictEqual(settled, true);
  deepStrictEqual(values, [null]);
});

test('unmounted observers ignore the pending read and unsubscribe', async () => {
  let finish: (session: string | null) => void = () => {};
  let unsubscribed = false;
  let calls = 0;
  const stop = observeSession<string>(() => () => { unsubscribed = true; },
    () => new Promise(resolve => { finish = resolve; }), () => { calls++; }, () => { calls++; });
  stop();
  finish('session');
  await new Promise(resolve => setTimeout(resolve, 0));
  strictEqual(unsubscribed, true);
  strictEqual(calls, 0);
});