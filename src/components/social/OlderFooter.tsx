import type { Ref } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { autoLoads } from './useOlderPages';

/**
 * Desktop: the end of a feed that has older posts. They load on their own as the reader nears it (useLoadMoreSentinel),
 * so there's nothing to press: a spinner while a page is on its way, and a button only when a page failed (or where
 * the browser can't tell Atlas the end is near).
 */
export function OlderFooter({ sentinel, loading, failed, retry }: { sentinel: Ref<HTMLDivElement>; loading: boolean; failed: boolean; retry: () => void }) {
  return <div ref={sentinel} className="flex min-h-10 justify-center py-2" aria-live="polite">
    {failed ? <p role="status" className="text-xs text-muted-foreground">Couldn’t load older posts. <Button variant="link" size="sm" className="px-1" onClick={retry}>Try again</Button></p>
      : loading || autoLoads() ? <span className={`flex items-center gap-2 text-xs text-muted-foreground${loading ? '' : ' invisible'}`}><Loader2 className="size-3.5 animate-spin" />Loading older posts…</span>
      : <Button type="button" variant="ghost" size="sm" onClick={retry}>Load older posts</Button>}
  </div>;
}
