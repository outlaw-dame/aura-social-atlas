import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Compass, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { discoveryGatewayOrigin, fetchDiscoveryPage, safeExternalUrl, type DiscoveryItem } from '@/lib/discovery-gateway';

type Mode = 'all' | 'hashtags' | 'instances';
const modes: { value: Mode; label: string }[] = [
  { value: 'all', label: 'All public' }, { value: 'hashtags', label: 'Hashtags' }, { value: 'instances', label: 'Instances' },
];

/** Federated discovery is separate from Fedizen's Home/federated timelines. */
export function GatewayDiscovery() {
  const configured = discoveryGatewayOrigin();
  const [mode, setMode] = useState<Mode>('all');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DiscoveryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    if (!configured) return;
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    setItems([]); setCursor(null); setError(null); setLoading(true);
    void fetchDiscoveryPage({ [mode === 'hashtags' ? 'tag' : mode === 'instances' ? 'domain' : 'q']: query || undefined }, controller.signal)
      .then(page => { if (!controller.signal.aborted && generation.current === currentGeneration) { setItems(page.items); setCursor(page.nextCursor); } })
      .catch(err => { if (!controller.signal.aborted && generation.current === currentGeneration) setError(err instanceof Error ? err.message : 'Discovery unavailable'); })
      .finally(() => { if (!controller.signal.aborted && generation.current === currentGeneration) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [configured, mode, query, revision]);

  async function loadMore() {
    if (!cursor || loading) return;
    const currentGeneration = generation.current;
    setLoading(true); setError(null);
    try {
      const page = await fetchDiscoveryPage({ [mode === 'hashtags' ? 'tag' : mode === 'instances' ? 'domain' : 'q']: query || undefined, cursor }, new AbortController().signal);
      if (generation.current !== currentGeneration) return;
      setItems(current => {
        const seen = new Set(current.map(item => item.id));
        return [...current, ...page.items.filter(item => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch (err) { if (generation.current === currentGeneration) setError(err instanceof Error ? err.message : 'Discovery unavailable'); }
    finally { if (generation.current === currentGeneration) setLoading(false); }
  }

  if (!configured) return (
    <section aria-label="Public relay discovery" className="mb-8 rounded-2xl border border-border bg-card/60 p-5">
      <p className="flex items-center gap-2 text-sm font-medium"><Compass className="size-4" /> Open-web discovery</p>
      <p className="mt-2 text-sm text-muted-foreground">Independent relay discovery isn't connected yet. Existing Fedizen feeds and creator stories are unaffected.</p>
    </section>
  );

  return <section aria-label="Public relay discovery" className="mb-9 rounded-2xl border border-border bg-card/60 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-serif text-2xl italic">Across the open web</h2>
        <p className="mt-1 text-xs text-muted-foreground">Public posts discovered by an independent relay gateway — not your Fedizen timeline.</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => setRevision(v => v + 1)} aria-label="Refresh discovery posts"><RefreshCw className="size-4" />Refresh</Button>
    </div>
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Discovery content sources">
      {modes.map(m => <Button type="button" size="sm" key={m.value} variant={mode === m.value ? 'default' : 'outline'} aria-pressed={mode === m.value} onClick={() => { setMode(m.value); setDraft(''); setQuery(''); }}>{m.label}</Button>)}
    </div>
    <form className="mt-4 flex gap-2" onSubmit={event => { event.preventDefault(); setQuery(draft.trim()); }}>
      <label htmlFor="gateway-discovery-filter" className="sr-only">{mode === 'hashtags' ? 'Hashtag' : mode === 'instances' ? 'Instance domain' : 'Search discovered posts'}</label>
      <input id="gateway-discovery-filter" className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm" value={draft} maxLength={120} onChange={event => setDraft(event.target.value)} placeholder={mode === 'hashtags' ? 'Hashtag (without #)' : mode === 'instances' ? 'Instance domain' : 'Search public posts'} />
      <Button type="submit" size="sm"><Search className="size-4" />Search</Button>
    </form>
    {error && <div role="alert" className="mt-4 rounded-lg border border-border p-3 text-sm">{error} <Button size="sm" variant="link" onClick={() => setRevision(v => v + 1)}>Retry</Button></div>}
    {loading && items.length === 0 && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading public posts…</p>}
    {!loading && !error && items.length === 0 && <p role="status" className="mt-5 text-sm text-muted-foreground">No public posts found yet. Sources must be subscribed and deliver posts before anything appears here.</p>}
    {items.length > 0 && <div className="mt-5 space-y-3">
      {items.map(item => {
        const link = safeExternalUrl(item.url);
        return <article key={item.id} className="rounded-xl border border-border bg-background/60 p-4">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{item.author?.name || item.author?.handle || 'Remote author'}</span>
            <span>{item.origin}</span>
            {item.publishedAt && <time dateTime={item.publishedAt}>{new Date(item.publishedAt).toLocaleDateString()}</time>}
          </div>
          {item.summary && <p className="mt-2 font-semibold">{item.summary}</p>}
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.text}</p>
          <div className="mt-3 flex flex-wrap gap-2">{(item.hashtags ?? []).slice(0, 8).map(tag => <span key={tag} className="text-xs text-muted-foreground">#{tag}</span>)}</div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span title={item.via}>Discovered via external relay</span>
            {link && <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">Open original <ArrowUpRight className="size-3" /></a>}
          </div>
        </article>;
      })}
    </div>}
    {cursor && <div className="mt-4 flex justify-center"><Button type="button" disabled={loading} variant="outline" onClick={() => void loadMore()}>{loading ? 'Loading…' : 'Load more public posts'}</Button></div>}
  </section>;
}
