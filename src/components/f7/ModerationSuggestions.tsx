import { Block, BlockFooter, BlockTitle, Button, Link, List, ListItem, Navbar, Page, f7 } from 'framework7-react';
import { openFediProfile } from '@/lib/fedi-profile';
import { SIGNAL_DAYS } from '@/lib/moderation-signals';
import { itemKey, useModerationSuggestions } from '@/components/social/useModerationSuggestions';
import { pushPage } from './navigation';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Phone: Settings → Moderation → Suggestions, a pushed page with the same answer as desktop's section, kept on this
 * device until each item is acted on or dismissed. Blocking asks once more; nothing happens on its own.
 */
export function MobileModerationSuggestionsPage() {
  const s = useModerationSuggestions();
  const empty = !s.toAdd.length && !s.toChange.length && !s.accounts.length;
  // A row's choices as an action sheet, as iOS lists do for more than one action.
  const choose = (title: string, buttons: { text: string; color?: string; onClick: () => void }[]) =>
    f7.actions.create({ buttons: [[{ text: title, label: true }, ...buttons], [{ text: 'Cancel' }]] }).open();
  return <Page>
    <Navbar title="Suggestions" backLink backLinkShowText={false} />
    {!s.signedIn ? <Block strong inset>Sign in to Atlas to get suggestions.</Block>
      : !s.ai ? <List strong inset><ListItem link="#" title="Turn on Intelligence" footer="Suggestions come from your AI model." onClick={() => pushPage('/intelligence/')} /></List>
      : <>
        <List strong inset>
          <ListItem link="#" title={s.thinking ? 'Thinking…' : s.askedAt ? 'Ask again' : 'Get suggestions'} footer={s.askedAt ? `Last asked ${when(s.askedAt)}` : undefined}
            className={s.thinking || (!s.hasFilters && !s.hasContext) ? 'disabled' : undefined} onClick={() => void s.ask()} />
        </List>
        <BlockFooter>From your keyword filters, who you block and mute, and what Atlas noticed on this device in the last {SIGNAL_DAYS} days: whose posts your filters caught, who boosts or answers people you block, and who you reported. These go to your AI provider only when you ask. Nothing changes until you choose.</BlockFooter>
        {s.note && <BlockFooter><span role="alert">{s.note}</span></BlockFooter>}
        {s.askedAt && empty && <Block strong inset>Nothing to suggest right now.</Block>}

        {s.toAdd.length > 0 && <>
          <BlockTitle>Filters to add</BlockTitle>
          <List strong inset dividers>
            {s.toAdd.map(x => <ListItem key={x.text} link="#" title={x.text} footer={x.reason} className={s.busy ? 'disabled' : undefined}
              onClick={() => choose(x.text, [{ text: 'Add filter', onClick: () => void s.addFilter(x.text) }, { text: 'Dismiss', onClick: () => s.dismiss(itemKey.filter(x.text)) }])} />)}
          </List>
        </>}

        {s.toChange.length > 0 && <>
          <BlockTitle>Filters to change</BlockTitle>
          <List strong inset dividers>
            {s.toChange.map(c => <ListItem key={c.filterId + c.issue} link="#" title={c.asked} footer={c.replacement ? `${c.issue} Suggested: “${c.replacement}”` : c.issue} className={s.busy ? 'disabled' : undefined}
              onClick={() => choose(c.asked, [
                ...(c.replacement ? [{ text: `Change to “${c.replacement}”`, onClick: () => void s.changeFilter(c.filterId, c.issue, c.replacement!) }] : []),
                { text: 'Edit filter', onClick: () => pushPage(`/keyword-filters/${c.filterId}/`) },
                { text: 'Dismiss', onClick: () => s.dismiss(itemKey.caution(c.filterId, c.issue)) },
              ])} />)}
          </List>
        </>}

        {s.accounts.length > 0 && <>
          <BlockTitle>Accounts to review</BlockTitle>
          <List strong inset dividers>
            {s.accounts.map(a => <ListItem key={a.acct} link="#" title={`@${a.acct}`} footer={a.reason} after={a.action === 'block' ? 'Block?' : 'Mute?'} className={s.busy ? 'disabled' : undefined}
              onClick={() => choose(`@${a.acct}`, [
                { text: 'View profile', onClick: () => openFediProfile({ acct: a.acct }) },
                { text: 'Mute', onClick: () => void s.mute(a.acct) },
                ...(s.canBlock ? [{ text: 'Block…', color: 'red', onClick: () => f7.dialog.confirm(`Block @${a.acct}? They won’t be able to follow you or see your posts, and you won’t see theirs.`, 'Block', () => void s.block(a.acct)) }] : []),
                { text: 'Dismiss', onClick: () => s.dismiss(itemKey.account(a.acct)) },
              ])} />)}
          </List>
        </>}

        {s.askedAt && <List strong inset><ListItem link="#" title="Forget suggestions" footer="And what Atlas noticed on this device" onClick={() => f7.dialog.confirm('Forget these suggestions and what Atlas noticed on this device?', 'Forget', s.forget)} /></List>}
        <Block><Button small round tonal onClick={() => pushPage('/keyword-filters/')}>Keyword filters</Button></Block>
      </>}
  </Page>;
}
