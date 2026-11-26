import { Switch } from '@/components/ui/switch';
import { tagRelay } from '@/lib/fedibuzz';
import { useFediFollow } from './useFediProfile';

/**
 * "Across the fediverse" on a hashtag's page (desktop): follows FediBuzz's relay for the tag from the person's Fedizen
 * account, so public posts with it from servers Fedizen doesn't follow arrive in Following as boosts by the relay
 * (src/lib/fedibuzz.ts). Shown only once Fedizen has said whether it's followed, and only for tags the relay names
 * exactly.
 */
export function TagRelayFollow({ tag }: { tag: string }) {
  const relay = tagRelay(tag);
  const f = useFediFollow(relay?.acct, relay?.actor);
  if (!relay || !f.signedIn || !f.canFollow) return f.error ? <p role="alert" className="mb-5 text-xs text-muted-foreground">{f.error}</p> : null;
  const on = f.state === 'following' || f.state === 'requested';
  return <div className="mb-5 flex items-start justify-between gap-4 rounded-lg border border-border px-4 py-3">
    <div className="min-w-0">
      <p id="tag-relay-label" className="text-sm font-medium">Across the fediverse</p>
      <p id="tag-relay-note" className="text-xs text-muted-foreground">
        {f.state === 'requested' ? 'Waiting for FediBuzz to accept. ' : ''}
        Public posts with this tag from servers Fedizen doesn’t follow come into Following, boosted by the FediBuzz relay.
      </p>
      {f.error && <p role="alert" className="mt-1 text-xs text-muted-foreground">{f.error}</p>}
    </div>
    <Switch checked={on} disabled={f.busy} onCheckedChange={() => f.toggle()} aria-labelledby="tag-relay-label" aria-describedby="tag-relay-note" />
  </div>;
}
