import { f7 } from 'framework7-react';
import { REPORT_CATEGORIES, useMutes, useReport, type ReportCategory } from '@/components/social/useOwnPosts';
import { blockServerText, serverOf, useServerBlock } from '@/components/social/useServerBlock';

export type Subject = { name: string; acct?: string; accountId?: string; statusId?: string };

/**
 * Phone: Mute / Unmute, Report, and Block / Unblock their server, for an account (and the post it was reached from), as action-sheet buttons.
 * Reporting follows Mastodon's steps as phone dialogs: why, a note, then — for another server's account — whether
 * to send a copy to that server's moderators. `enabled` is false when there's nobody to act on (signed out, yourself).
 */
export function useModerationActions(s: Subject, enabled: boolean) {
  const mutes = useMutes(enabled);
  const reporter = useReport();
  const servers = useServerBlock();
  const muted = mutes.isMuted(s);
  const toggleMute = async () => {
    const ok = await mutes.mute({ accountId: s.accountId, acct: s.acct, on: !muted });
    f7.toast.create({ text: ok ? (muted ? `${s.name} unmuted` : `${s.name} muted. Their posts leave your feeds.`) : mutes.error ?? 'Couldn’t do that. Try again.', closeTimeout: 2000 }).open();
  };
  const remote = !!s.acct && s.acct.includes('@') && !/@fedizen\.net$/i.test(s.acct);
  const note = (category: ReportCategory) => f7.dialog.prompt(
    category === 'other' ? 'What’s wrong? Fedizen’s moderators read this.' : 'Anything the moderators should know (optional). They won’t see who reported it.', 'Report',
    comment => {
      if (category === 'other' && !comment.trim()) { f7.toast.create({ text: 'Say what’s wrong so the moderators can act on it.', closeTimeout: 2200 }).open(); return; }
      const send = async (forward: boolean) => {
        const ok = await reporter.report({ accountId: s.accountId, acct: s.acct, statusIds: s.statusId ? [s.statusId] : [], comment: comment.slice(0, 1000), category, forward });
        f7.toast.create({ text: ok ? 'Reported. Fedizen’s moderators will review it.' : reporter.error ?? 'Couldn’t send the report. Try again.', closeTimeout: 2200 }).open();
      };
      if (remote) f7.dialog.create({ title: `Also send a copy to ${s.acct!.split('@')[1]}?`, text: 'Their moderators get the report too, without your name.',
        buttons: [{ text: 'No', onClick: () => void send(false) }, { text: 'Send copy', strong: true, onClick: () => void send(true) }] }).open();
      else void send(false);
    });
  const report = () => f7.actions.create({ buttons: [
    [{ text: s.statusId ? `Why are you reporting this post by ${s.name}?` : `Why are you reporting ${s.name}?`, label: true }, ...REPORT_CATEGORIES.map(c => ({ text: c.label, onClick: () => note(c.id) }))],
    [{ text: 'Cancel', strong: true }],
  ] }).open();
  // Mastodon's "Block domain": the whole server, for you (useServerBlock). Unblocking is on Fedizen's Blocked page:
  // Bonfire's API can block a server but not unblock one.
  const host = serverOf(s.acct);
  const toast = (text: string) => f7.toast.create({ text, closeTimeout: 3000 }).open();
  const blockServer = () => host && s.acct && f7.dialog.create({ title: `Block ${host}?`, text: blockServerText(host), buttons: [
    { text: 'Cancel' }, { text: 'Block', color: 'red', strong: true, onClick: async () => toast(await servers.block(s.acct!)) },
  ] }).open();
  const serverButtons = host && s.acct ? [
    { text: `Block ${host}…`, color: 'red', onClick: blockServer },
    { text: 'Unblock on Fedizen…', onClick: () => window.open(servers.blockedPage, '_blank', 'noopener') },
  ] : [];
  return {
    buttons: enabled ? [{ text: muted ? `Unmute ${s.name}` : `Mute ${s.name}`, onClick: () => void toggleMute() }, { text: 'Report…', color: 'red', onClick: report }, ...serverButtons] : [],
  };
}
