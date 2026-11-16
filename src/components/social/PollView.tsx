import { useState } from 'react';
import { Check } from 'lucide-react';
import type { FediPoll } from '@/lib/fedizen-feed';
import { usePoll } from './useOwnPosts';

const fmt = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n);

/** "Ends in 3 hours", "Closed", as Mastodon words a poll's time. */
export function pollTime(p: FediPoll, now = Date.now()): string {
  if (p.expired) return 'Closed';
  if (!p.expiresAt) return '';
  const left = Date.parse(p.expiresAt) - now;
  if (left <= 0) return 'Closed';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' });
  const [v, unit] = left < 3_600_000 ? [Math.ceil(left / 60_000), 'minute'] : left < 86_400_000 ? [Math.round(left / 3_600_000), 'hour'] : [Math.round(left / 86_400_000), 'day'];
  return `Ends ${rtf.format(v, unit as Intl.RelativeTimeFormatUnit)}`;
}

/** Each option's share, as Mastodon shows it: of voters for a multiple-choice poll, of votes otherwise. */
export function pollShares(p: FediPoll): (number | null)[] {
  const total = p.multiple ? p.voters : p.votes ?? p.options.reduce((a, o) => a + (o.votes ?? 0), 0);
  return p.options.map(o => (o.votes === undefined || !total ? (total === 0 ? 0 : null) : Math.round((o.votes / total) * 100)));
}

/**
 * A poll in a post, as Mastodon and Ivory show one: choices to pick from (one, or several when it allows), Vote, and
 * once you've voted, it has closed, or it's your own, the results as bars with your choices ticked. Desktop and phone
 * share it; `phone` only sizes it for touch.
 */
export function PollView({ poll: initial, mine, phone }: { poll: FediPoll; mine: boolean; phone?: boolean }) {
  const { poll: p, vote, voting, error, signedIn } = usePoll(initial);
  const [picked, setPicked] = useState<number[]>([]);
  const [peek, setPeek] = useState(false);
  const results = p.voted || p.expired || mine || !signedIn || peek;
  const shares = pollShares(p);
  const count = p.multiple ? p.voters : p.votes;
  const toggle = (i: number) => setPicked(c => (p.multiple ? (c.includes(i) ? c.filter(x => x !== i) : [...c, i]) : [i]));
  return <div className={`atlas-poll${phone ? ' atlas-poll-phone' : ''}`}>
    {results
      ? <ul className="atlas-poll-results" aria-label="Poll results">{p.options.map((o, i) => {
          const share = shares[i];
          const own = p.ownVotes.includes(i);
          return <li key={i} className={own ? 'own' : undefined}>
            <span className="atlas-poll-bar" style={{ width: `${share ?? 0}%` }} aria-hidden="true" />
            <span className="atlas-poll-label">{own && <Check className="atlas-poll-check" aria-label="Your choice" />}{o.title}</span>
            <span className="atlas-poll-share">{share === null ? '' : `${share}%`}</span>
          </li>;
        })}</ul>
      : <fieldset className="atlas-poll-choices">
          <legend className="sr-only">{p.multiple ? 'Choose one or more' : 'Choose one'}</legend>
          {p.options.map((o, i) => <label key={i} className={picked.includes(i) ? 'picked' : undefined}>
            <input type={p.multiple ? 'checkbox' : 'radio'} name={`poll-${p.id}`} checked={picked.includes(i)} onChange={() => toggle(i)} />
            <span>{o.title}</span>
          </label>)}
        </fieldset>}
    <p className="atlas-poll-meta">
      {!results && <button type="button" className="atlas-poll-vote" disabled={!picked.length || voting} onClick={() => vote(picked)}>{voting ? 'Voting…' : 'Vote'}</button>}
      <span>{count !== undefined ? `${fmt(count)} ${p.multiple ? (count === 1 ? 'person' : 'people') : count === 1 ? 'vote' : 'votes'}` : ''}{count !== undefined && pollTime(p) ? ' · ' : ''}{pollTime(p)}{p.multiple && !results ? ' · Choose any' : ''}</span>
      {!results && <button type="button" className="atlas-poll-link" onClick={() => setPeek(true)}>See results</button>}
      {peek && !p.voted && !p.expired && !mine && <button type="button" className="atlas-poll-link" onClick={() => setPeek(false)}>Hide results</button>}
    </p>
    {error && <p role="alert" className="atlas-poll-error">{error}</p>}
  </div>;
}
