import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { disablePush, enablePush, getPushConfig, getPushState, setPushChoice } from '@/lib/push.functions';
import { unb64u } from '@/lib/push/webpush';
import { useAtlasAuth } from './AuthState';

export type PushAlerts = { mention: boolean; status: boolean; reblog: boolean; follow: boolean; follow_request: boolean; favourite: boolean; poll: boolean; update: boolean; quote: boolean };
export type PushPolicy = 'all' | 'followed' | 'follower' | 'none';

/** What each alert is called in Settings, in Mastodon's order. */
export const PUSH_ALERTS: { key: keyof PushAlerts; label: string }[] = [
  { key: 'mention', label: 'Mentions and replies' }, { key: 'quote', label: 'Quotes of your posts' }, { key: 'favourite', label: 'Likes' },
  { key: 'reblog', label: 'Boosts' }, { key: 'follow', label: 'New followers' }, { key: 'follow_request', label: 'Follow requests' },
  { key: 'poll', label: 'Polls you voted in ending' }, { key: 'status', label: 'Posts from people you get alerts for' }, { key: 'update', label: 'Edits to posts you boosted' },
];
/** Bluesky's "From everyone / people you follow", in Mastodon's policy terms. */
export const PUSH_POLICY: { id: PushPolicy; label: string }[] = [
  { id: 'all', label: 'Everyone' }, { id: 'followed', label: 'People you follow' }, { id: 'follower', label: 'People who follow you' },
];

export type PushProblem = 'unsupported' | 'ios-home-screen' | 'denied' | 'not-configured' | 'not-connected' | 'needs-permission' | 'failed';
export const PUSH_PROBLEM: Record<PushProblem, string> = {
  unsupported: 'This browser can’t receive notifications from websites.',
  'ios-home-screen': 'On iPhone and iPad, add Atlas to your Home Screen first (Share → Add to Home Screen), then turn notifications on there.',
  denied: 'Notifications are blocked for Atlas in this browser’s settings.',
  'not-configured': 'This Atlas server isn’t set up to send notifications yet.',
  'not-connected': 'Connect your Fedizen account first.',
  'needs-permission': 'Reconnect Fedizen so Atlas can set up notifications.',
  failed: 'Couldn’t turn notifications on. Try again.',
};

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
const iosNotInstalled = () => typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent) && !(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone);

/** The /app service worker's registration (registering it from any page; it's the one that shows notifications). */
async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = (await navigator.serviceWorker.getRegistration('/app')) ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/app' }));
  if (reg.active) return reg;
  const sw = reg.installing ?? reg.waiting;
  await new Promise<void>(resolve => { if (!sw) return resolve(); sw.addEventListener('statechange', () => { if (sw.state === 'activated') resolve(); }); setTimeout(resolve, 10_000); });
  return reg;
}

/** Push notifications on this device (through Atlas's relay): state, on/off, and what pushes from whom. */
export function usePush() {
  const { user } = useAtlasAuth();
  const configFn = useServerFn(getPushConfig), stateFn = useServerFn(getPushState), on = useServerFn(enablePush), off = useServerFn(disablePush), choose = useServerFn(setPushChoice);
  const config = useQuery({ queryKey: ['push-config'], queryFn: () => configFn(), staleTime: Infinity });
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PushProblem | null>(null);
  useEffect(() => {
    if (!supported()) { setEndpoint(null); return; }
    void navigator.serviceWorker.getRegistration('/app').then(r => r?.pushManager.getSubscription()).then(s => setEndpoint(s?.endpoint ?? null)).catch(() => setEndpoint(null));
  }, []);
  const state = useQuery({
    queryKey: ['push-state', user?.id, endpoint],
    queryFn: () => stateFn({ data: { expectedAtlasUserId: user!.id, endpoint: endpoint ?? null } }),
    enabled: !!user && endpoint !== undefined && !!config.data?.configured,
  });

  const enable = useCallback(async () => {
    if (!user) return;
    if (!supported()) { setProblem(iosNotInstalled() ? 'ios-home-screen' : 'unsupported'); return; }
    if (!config.data?.configured || !config.data.publicKey) { setProblem('not-configured'); return; }
    setBusy(true); setProblem(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setProblem(permission === 'denied' ? 'denied' : 'failed'); return; }
      const reg = await registration();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(config.data.publicKey) }));
      const j = sub.toJSON();
      const r = await on({ data: { expectedAtlasUserId: user.id, device: { endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' } } });
      if (!r.ok) { setProblem((['not-configured', 'not-connected', 'needs-permission'] as const).find(p => p === r.error) ?? 'failed'); return; }
      setEndpoint(sub.endpoint);
      void state.refetch();
    } catch { setProblem('failed'); } finally { setBusy(false); }
  }, [user, config.data, on, state]);

  const disable = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.getRegistration('/app'))?.pushManager.getSubscription();
      await sub?.unsubscribe().catch(() => false);
      await off({ data: { expectedAtlasUserId: user.id, endpoint: sub?.endpoint ?? endpoint ?? null } });
      setEndpoint(null);
      void state.refetch();
    } finally { setBusy(false); }
  }, [user, off, endpoint, state]);

  const setChoice = useCallback(async (alerts: PushAlerts, policy: PushPolicy) => {
    if (!user) return false;
    setBusy(true);
    try { const r = await choose({ data: { expectedAtlasUserId: user.id, alerts, policy } }); void state.refetch(); return r.ok; } finally { setBusy(false); }
  }, [user, choose, state]);

  // The browser renewed this subscription: register the new one if notifications were on here.
  useEffect(() => {
    if (!supported()) return;
    const msg = (e: MessageEvent) => { if (e.data?.type === 'atlas-push-renew' && endpoint) void enable(); };
    navigator.serviceWorker.addEventListener('message', msg);
    return () => navigator.serviceWorker.removeEventListener('message', msg);
  }, [endpoint, enable]);

  return {
    available: supported() && !!config.data?.configured, configured: !!config.data?.configured, supported: supported(),
    on: !!endpoint && !!state.data?.thisDevice, alerts: state.data?.alerts, policy: state.data?.policy,
    enable, disable, setChoice, busy, problem: problem ? PUSH_PROBLEM[problem] : null,
    note: !supported() && iosNotInstalled() ? PUSH_PROBLEM['ios-home-screen'] : null,
  };
}

/** Tapping a notification opens Activity: the page that was focused gets this message from the service worker. */
export function useOpenActivityFromPush(open: () => void) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const msg = (e: MessageEvent) => { if (e.data?.type === 'atlas-open-activity') open(); };
    navigator.serviceWorker.addEventListener('message', msg);
    return () => navigator.serviceWorker.removeEventListener('message', msg);
  }, [open]);
}
