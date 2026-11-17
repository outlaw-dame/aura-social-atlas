import { useEffect, useState } from 'react';
import { Block, BlockTitle } from 'framework7-react';
import { MobilePostCard, useMobilePostActions } from './MobilePostCard';
import { useSearchPosts } from '@/components/social/useOwnPosts';

/** Phone: posts on Fedizen matching what's typed in Discover's search (after a short pause, from two characters). */
export function MobilePostSearch({ q }: { q: string }) {
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 450); return () => clearTimeout(t); }, [q]);
  const s = useSearchPosts(term);
  const actions = useMobilePostActions();
  if (!s.available || term.length < 2) return null;
  return <>
    <BlockTitle>Posts on Fedizen</BlockTitle>
    {s.related.length > 0 && <Block style={{ marginTop: 0, fontSize: 13, opacity: 0.7 }}>Also searched, as suggested by your AI model: {s.related.map(t => `“${t}”`).join(', ')}</Block>}
    {s.loading && !s.posts.length && <Block>Searching posts…</Block>}
    {s.error && <Block><p role="alert" style={{ margin: 0 }}>{s.error}</p></Block>}
    {!s.loading && !s.error && !s.posts.length && <Block>No posts on Fedizen match “{term}”.</Block>}
    {s.posts.map(p => <MobilePostCard key={p.id} post={p} actions={actions} />)}
    {actions.sheet}
  </>;
}
