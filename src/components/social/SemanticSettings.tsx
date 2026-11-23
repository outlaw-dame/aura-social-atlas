import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PROVIDERS } from '@/lib/intelligence/providers';
import { localSupported, removeLocalModel, startLocal } from '@/lib/semantic/local-embedder';
import { useAtlasAuth } from './AuthState';
import { setEngine, useEngine, useLocalModel, useSemantic, type Engine } from './useSemanticIndex';
import { useAiRunner } from './useIntelligence';

/** What each engine choice says, shared by desktop and phone Settings. */
export const SEMANTIC_COPY = {
  title: 'Search by meaning',
  detail: 'Finds posts you’ve been shown that mean the same as a search, even with none of its words, and lets keyword filters checked in context catch posts on their topic. Atlas keeps an index of those posts on this device.',
  device: { label: 'On this device', note: 'Google’s EmbeddingGemma model runs in this browser: nothing you read or search leaves the device. It downloads once (about 200 MB) and works offline after that.' },
  provider: (name: string) => ({ label: `With your ${name} key`, note: `Posts are sent to ${name} as they’re added to the index, like checking every post against topic filters. Direct messages never are.` }),
  noProvider: 'None of your keys has an embedding model (Anthropic and Kimi have none). Use the model on this device, or add a key from Voyage AI, Cohere, Jina AI or OpenRouter (for semantic filters only), or from OpenAI, Google, Mistral or Cloudflare.',
} as const;

const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;
export function localStatusText(s: ReturnType<typeof useLocalModel>): string | null {
  if (s.status === 'downloading') return s.total ? `Downloading the model: ${mb(s.loaded)} of ${mb(s.total)}` : 'Starting the model…';
  if (s.status === 'ready') return s.device === 'webgpu' ? 'Ready, using this device’s graphics processor.' : 'Ready.';
  if (s.status === 'failed') return s.reason === 'unsupported' ? 'This browser can’t run the model.' : s.reason === 'blocked' ? 'The model’s code couldn’t be verified, so it wasn’t run. Try again later.' : 'The model couldn’t be downloaded. Check your connection and try again.';
  return null;
}

/** How many posts the index holds for the model in use. */
export function useIndexCount(): [number | null, () => void] {
  const { user } = useAtlasAuth();
  const s = useSemantic();
  const [n, setN] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    if (!user || !s.model) { setN(null); return; }
    void import('@/lib/semantic/index-store').then(m => m.indexSize(user.id, s.model!)).then(v => { if (live) setN(v); }).catch(() => { if (live) setN(null); });
    return () => { live = false; };
  }, [user, s.model, s.ready, tick]);
  return [n, () => setTick(t => t + 1)];
}

/** Settings may be open where no SemanticIndexer is mounted: choosing the device model starts (downloads) it here too. */
export function useStartLocalHere(engine: Engine | null) {
  useEffect(() => { if (engine === 'device' && localSupported()) startLocal(); }, [engine]);
}

/** Desktop: Settings → Intelligence → Search by meaning. */
export function SemanticSettings() {
  const { user } = useAtlasAuth();
  const engine = useEngine();
  const local = useLocalModel();
  const runner = useAiRunner();
  const [count, recount] = useIndexCount();
  useStartLocalHere(engine);
  if (!user) return null;
  const provider = runner.embeddingProvider ? PROVIDERS[runner.embeddingProvider] : null;
  const pick = (e: Engine | null) => setEngine(user.id, e);
  const clear = async () => { const m = await import('@/lib/semantic/index-store'); await m.clearIndex(user.id); recount(); };
  return <section className="border-b border-border py-6" aria-labelledby="semantic-title">
    <h2 id="semantic-title" className="text-base font-semibold">{SEMANTIC_COPY.title}</h2>
    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{SEMANTIC_COPY.detail}</p>
    <fieldset className="mt-4 space-y-3 text-sm">
      <legend className="sr-only">How to search by meaning</legend>
      <label className="flex items-start gap-2"><input type="radio" name="semantic" className="mt-1 accent-[var(--accent)]" checked={!engine} onChange={() => pick(null)} />
        <span className="font-medium">Off</span></label>
      <label className="flex items-start gap-2"><input type="radio" name="semantic" className="mt-1 accent-[var(--accent)]" checked={engine === 'device'} disabled={!localSupported()} onChange={() => pick('device')} />
        <span><span className="font-medium">{SEMANTIC_COPY.device.label}</span><span className="block text-xs text-muted-foreground">{SEMANTIC_COPY.device.note}</span>
          {engine === 'device' && localStatusText(local) && <span role="status" className="mt-1 block text-xs">{localStatusText(local)}</span>}</span></label>
      <label className="flex items-start gap-2"><input type="radio" name="semantic" className="mt-1 accent-[var(--accent)]" checked={engine === 'provider'} disabled={!provider} onChange={() => pick('provider')} />
        <span><span className="font-medium">{provider ? SEMANTIC_COPY.provider(provider.name).label : 'With your provider’s key'}</span>
          <span className="block text-xs text-muted-foreground">{provider ? SEMANTIC_COPY.provider(provider.name).note : SEMANTIC_COPY.noProvider}</span></span></label>
    </fieldset>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {count !== null && <span className="mr-auto text-xs text-muted-foreground">{count === 1 ? '1 post' : `${count} posts`} in this device’s index</span>}
      {!!count && <Button variant="outline" size="sm" className="rounded-full" onClick={() => void clear()}>Clear index</Button>}
      {engine !== 'device' && <Button variant="ghost" size="sm" className="rounded-full" onClick={() => void removeLocalModel()}>Remove downloaded model</Button>}
    </div>
  </section>;
}
