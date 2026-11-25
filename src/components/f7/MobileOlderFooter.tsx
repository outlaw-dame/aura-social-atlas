import type { Ref } from 'react';
import { Link } from 'framework7-react';
import { autoLoads } from '@/components/social/useOlderPages';

/** Phone: the end of a feed that has older posts; as desktop's OlderFooter: they load on their own, a spinner while a
 *  page is on its way, and a link only when a page failed (or where the browser can't tell Atlas the end is near). */
export function MobileOlderFooter({ sentinel, loading, failed, retry }: { sentinel: Ref<HTMLDivElement>; loading: boolean; failed: boolean; retry: () => void }) {
  return <div ref={sentinel} className="atlas-older" aria-live="polite">
    {failed ? <span>Couldn’t load older posts. <Link onClick={retry}>Try again</Link></span>
      : loading || autoLoads() ? <span style={loading ? undefined : { visibility: 'hidden' }}><span className="preloader preloader-small" /> Loading older posts…</span>
      : <Link onClick={retry}>Load older posts</Link>}
  </div>;
}
