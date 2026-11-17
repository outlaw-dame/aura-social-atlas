import { Block, BlockFooter, BlockTitle, List, ListItem, f7 } from 'framework7-react';
import { PROVIDERS } from '@/lib/intelligence/providers';
import { localSupported, removeLocalModel } from '@/lib/semantic/local-embedder';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useAiRunner } from '@/components/social/useIntelligence';
import { setEngine, useEngine, useLocalModel } from '@/components/social/useSemanticIndex';
import { SEMANTIC_COPY, localStatusText, useIndexCount } from '@/components/social/SemanticSettings';

/** Phone: Settings → Intelligence → Search by meaning (the desktop SemanticSettings, as a list). */
export function MobileSemanticSettings() {
  const { user } = useAtlasAuth();
  const engine = useEngine();
  const local = useLocalModel();
  const runner = useAiRunner();
  const [count, recount] = useIndexCount();
  if (!user) return null;
  const provider = runner.embeddingProvider ? PROVIDERS[runner.embeddingProvider] : null;
  const status = engine === 'device' ? localStatusText(local) : null;
  return <>
    <BlockTitle>{SEMANTIC_COPY.title}</BlockTitle>
    <List strong inset dividers>
      <ListItem radio radioIcon="end" name="semantic" title="Off" checked={!engine} onChange={() => setEngine(user.id, null)} />
      <ListItem radio radioIcon="end" name="semantic" title={SEMANTIC_COPY.device.label} footer={SEMANTIC_COPY.device.note} checked={engine === 'device'} disabled={!localSupported()} onChange={() => setEngine(user.id, 'device')} />
      <ListItem radio radioIcon="end" name="semantic" title={provider ? SEMANTIC_COPY.provider(provider.name).label : 'With your provider’s key'}
        footer={provider ? SEMANTIC_COPY.provider(provider.name).note : SEMANTIC_COPY.noProvider} checked={engine === 'provider'} disabled={!provider} onChange={() => setEngine(user.id, 'provider')} />
    </List>
    {status && <Block><p role="status" style={{ margin: 0, fontSize: 13 }}>{status}</p></Block>}
    <List strong inset dividers>
      {!!count && <ListItem link="#" title="Clear index" footer={count === 1 ? '1 post on this device' : `${count} posts on this device`}
        onClick={() => f7.dialog.confirm('Atlas will index posts again as you’re shown them.', 'Clear the index?', async () => { const m = await import('@/lib/semantic/index-store'); await m.clearIndex(user.id); recount(); })} />}
      {engine !== 'device' && <ListItem link="#" title="Remove downloaded model" onClick={() => void removeLocalModel()} />}
    </List>
    <BlockFooter>{SEMANTIC_COPY.detail}</BlockFooter>
  </>;
}
