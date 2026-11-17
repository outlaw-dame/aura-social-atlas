import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { PUSH_ALERTS, PUSH_POLICY, usePush, type PushAlerts, type PushPolicy } from './usePush';
import { useAtlasAuth } from './AuthState';

/**
 * Desktop: Settings → Notifications. Push on this device (through Atlas's relay, so Fedizen's token stays on the
 * server), which kinds push, and from whom — Bluesky's per-kind choices and "From everyone / people you follow", in
 * Mastodon's alerts and policy, which Fedizen applies.
 */
export function NotificationSettings() {
  const { user } = useAtlasAuth();
  const p = usePush();
  const [alerts, setAlerts] = useState<PushAlerts | undefined>(p.alerts);
  const [policy, setPolicy] = useState<PushPolicy>(p.policy ?? 'all');
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { if (p.alerts) setAlerts(p.alerts); if (p.policy) setPolicy(p.policy); }, [p.alerts, p.policy]);
  if (!user) return <p className="mt-6 text-sm text-muted-foreground">Sign in to Atlas to get notifications.</p>;
  const save = async (a: PushAlerts, pol: PushPolicy) => { setAlerts(a); setPolicy(pol); setSaved((await p.setChoice(a, pol)) ? null : 'Couldn’t save that. Try again.'); };
  return <div className="mt-3">
    <div className="flex items-start justify-between gap-6 border-b border-border py-6">
      <div><h2 className="text-base font-semibold">Notifications on this device</h2>
        <p id="push-detail" className="mt-1 text-sm leading-relaxed text-muted-foreground">When something happens on Fedizen: a mention, a reply, a new follower. They come through Atlas, which passes on only what the notification says.</p></div>
      <Switch aria-label="Notifications on this device" aria-describedby="push-detail" checked={p.on} disabled={p.busy || (!p.available && !p.on)} onCheckedChange={v => void (v ? p.enable() : p.disable())} />
    </div>
    {(p.problem || p.note || (!p.configured && p.supported)) && <p role="alert" className="mt-4 text-sm text-muted-foreground">{p.problem ?? p.note ?? 'This Atlas server isn’t set up to send notifications yet.'}</p>}
    {p.on && alerts && <>
      <section className="border-b border-border py-6">
        <h2 className="text-base font-semibold">Notify me about</h2>
        <ul className="mt-3 divide-y divide-border">{PUSH_ALERTS.map(a => <li key={a.key} className="flex items-center justify-between py-3 text-sm">
          <span>{a.label}</span>
          <Switch aria-label={a.label} checked={alerts[a.key]} disabled={p.busy} onCheckedChange={v => void save({ ...alerts, [a.key]: v }, policy)} />
        </li>)}</ul>
      </section>
      <section className="py-6">
        <h2 className="text-base font-semibold">From</h2>
        <div role="radiogroup" aria-label="Notifications from" className="mt-3 flex flex-wrap gap-2">
          {PUSH_POLICY.map(o => <Button key={o.id} role="radio" aria-checked={policy === o.id} variant={policy === o.id ? 'secondary' : 'outline'} className="rounded-full" disabled={p.busy} onClick={() => void save(alerts, o.id)}>{o.label}</Button>)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Applies to every device you turned notifications on for.</p>
        {saved && <p role="alert" className="mt-2 text-sm text-destructive">{saved}</p>}
      </section>
    </>}
  </div>;
}
