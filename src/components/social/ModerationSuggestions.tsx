import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openFediProfile } from '@/lib/fedi-profile';
import { SIGNAL_DAYS } from '@/lib/moderation-signals';
import { itemKey, useModerationSuggestions } from './useModerationSuggestions';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Desktop: Settings → Moderation → Suggestions. Intelligence's answer, kept on this device until each item is acted on
 * or dismissed: filters to add, filters to change, accounts to review. Blocking asks once more; nothing happens on
 * its own.
 */
export function ModerationSuggestions() {
  const s = useModerationSuggestions();
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!s.signedIn) return <p className="text-sm text-muted-foreground">Sign in to Atlas to get suggestions.</p>;
  if (!s.ai) return <p className="text-sm text-muted-foreground">Suggestions come from your AI model. <Link to="/settings/intelligence" className="text-accent underline">Turn on Intelligence</Link></p>;
  const empty = !s.toAdd.length && !s.toChange.length && !s.accounts.length;
  return <div>
    <p className="text-sm text-muted-foreground">
      From your keyword filters, who you block and mute, and what Atlas noticed on this device in the last {SIGNAL_DAYS} days: whose posts your filters caught, who boosts or answers people you block, and who you reported. These go to your AI provider only when you ask. Nothing changes until you choose.
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button variant="outline" className="rounded-full" disabled={s.thinking || (!s.hasFilters && !s.hasContext)} onClick={() => void s.ask()}>
        <Sparkles />{s.thinking ? 'Thinking…' : s.askedAt ? 'Ask again' : 'Get suggestions'}
      </Button>
      {s.askedAt && <span className="text-xs text-muted-foreground">Last asked {when(s.askedAt)}</span>}
    </div>
    {s.note && <p role="alert" className="mt-2 text-sm text-destructive">{s.note}</p>}

    {s.askedAt && empty && <p className="mt-4 text-sm text-muted-foreground">Nothing to suggest right now.</p>}

    {s.toAdd.length > 0 && <Group title="Filters to add">
      {s.toAdd.map(x => <Item key={x.text} title={x.text} detail={x.reason}>
        <Button size="sm" variant="outline" className="rounded-full" disabled={!!s.busy} onClick={() => void s.addFilter(x.text)}>Add</Button>
        <Dismiss onClick={() => s.dismiss(itemKey.filter(x.text))} />
      </Item>)}
    </Group>}

    {s.toChange.length > 0 && <Group title="Filters to change">
      {s.toChange.map(c => <Item key={c.filterId + c.issue} title={c.asked} detail={c.issue}>
        {c.replacement && <Button size="sm" variant="outline" className="rounded-full" disabled={!!s.busy} onClick={() => void s.changeFilter(c.filterId, c.issue, c.replacement!)}>Change to “{c.replacement}”</Button>}
        <Dismiss onClick={() => s.dismiss(itemKey.caution(c.filterId, c.issue))} />
      </Item>)}
    </Group>}

    {s.accounts.length > 0 && <Group title="Accounts to review">
      {s.accounts.map(a => <Item key={a.acct} title={<button type="button" className="text-left hover:underline" onClick={() => openFediProfile({ acct: a.acct })}>@{a.acct}</button>} detail={a.reason}>
        {confirming === a.acct
          ? <><Button size="sm" variant="destructive" className="rounded-full" disabled={!!s.busy} onClick={async () => { await s.block(a.acct); setConfirming(null); }}>Block @{a.acct.split('@')[0]}</Button>
              <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setConfirming(null)}>Cancel</Button></>
          : <>
            <Button size="sm" variant={a.action === 'mute' ? 'outline' : 'ghost'} className="rounded-full" disabled={!!s.busy} onClick={() => void s.mute(a.acct)}>Mute</Button>
            {s.canBlock && <Button size="sm" variant={a.action === 'block' ? 'outline' : 'ghost'} className="rounded-full" disabled={!!s.busy} onClick={() => setConfirming(a.acct)}>Block…</Button>}
            <Dismiss onClick={() => s.dismiss(itemKey.account(a.acct))} />
          </>}
      </Item>)}
    </Group>}

    {s.askedAt && <button type="button" className="mt-4 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={s.forget}>Forget these suggestions and what Atlas noticed on this device</button>}
  </div>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-5" aria-label={title}>
    <h3 className="text-[10px] font-semibold uppercase text-muted-foreground">{title}</h3>
    <ul className="mt-2 divide-y divide-border rounded-2xl border border-border">{children}</ul>
  </section>;
}

function Item({ title, detail, children }: { title: React.ReactNode; detail: string; children: React.ReactNode }) {
  return <li className="flex flex-wrap items-start gap-3 p-4">
    <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{title}</span><span className="mt-0.5 block text-sm text-muted-foreground">{detail}</span></span>
    <span className="flex flex-wrap items-center gap-1">{children}</span>
  </li>;
}

const Dismiss = ({ onClick }: { onClick: () => void }) =>
  <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground" onClick={onClick}>Dismiss</Button>;
