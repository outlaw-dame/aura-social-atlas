import { useEffect, useState } from 'react';
import { BlockFooter, BlockTitle, List, ListItem, Navbar, Page, Toggle } from 'framework7-react';
import { PUSH_ALERTS, PUSH_POLICY, usePush, type PushAlerts, type PushPolicy } from '@/components/social/usePush';
import { useAtlasAuth } from '@/components/social/AuthState';

/** Phone: Settings → Notifications, a pushed page (desktop NotificationSettings, as lists). */
export function NotificationSettingsPage() {
  const { user } = useAtlasAuth();
  const p = usePush();
  const [alerts, setAlerts] = useState<PushAlerts | undefined>(p.alerts);
  const [policy, setPolicy] = useState<PushPolicy>(p.policy ?? 'all');
  useEffect(() => { if (p.alerts) setAlerts(p.alerts); if (p.policy) setPolicy(p.policy); }, [p.alerts, p.policy]);
  const save = (a: PushAlerts, pol: PushPolicy) => { setAlerts(a); setPolicy(pol); void p.setChoice(a, pol); };
  return <Page>
    <Navbar title="Notifications" backLink backLinkShowText={false} />
    {!user ? <BlockFooter>Sign in to Atlas to get notifications.</BlockFooter> : <>
      <List strong inset dividers>
        <ListItem title="On this device"><Toggle slot="after" checked={p.on} disabled={p.busy || (!p.available && !p.on)} onToggleChange={() => void (p.on ? p.disable() : p.enable())} /></ListItem>
      </List>
      <BlockFooter>{p.problem ?? p.note ?? (!p.configured && p.supported ? 'This Atlas server isn’t set up to send notifications yet.' : 'When something happens on Fedizen: a mention, a reply, a new follower. They come through Atlas, which passes on only what the notification says.')}</BlockFooter>
      {p.on && alerts && <>
        <BlockTitle>Notify me about</BlockTitle>
        <List strong inset dividers>
          {PUSH_ALERTS.map(a => <ListItem key={a.key} title={a.label}><Toggle slot="after" checked={alerts[a.key]} disabled={p.busy} onToggleChange={() => save({ ...alerts, [a.key]: !alerts[a.key] }, policy)} /></ListItem>)}
        </List>
        <BlockTitle>From</BlockTitle>
        <List strong inset dividers>
          {PUSH_POLICY.map(o => <ListItem key={o.id} radio radioIcon="end" name="push-policy" title={o.label} checked={policy === o.id} onChange={() => save(alerts, o.id)} />)}
        </List>
        <BlockFooter>Applies to every device you turned notifications on for.</BlockFooter>
      </>}
    </>}
  </Page>;
}
