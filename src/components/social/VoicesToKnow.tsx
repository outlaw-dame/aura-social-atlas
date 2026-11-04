import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NetworkBadge } from '@/lib/networks';
import { avatarPreset, defaultAvatarKey } from '@/lib/atlas-avatars';
import { voices, voicesPage, VOICES_PER_PAGE } from '@/lib/voices';

/** Rotating list of real open-web writers; six at a time, advancing on its own or on request. */
export function VoicesToKnow() {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(voices.length / VOICES_PER_PAGE);
  useEffect(() => {
    const t = setInterval(() => setPage(p => p + 1), 20000);
    return () => clearInterval(t);
  }, [page]);
  return <div>
    <div className="mb-5 flex items-center justify-between gap-2">
      <p className="text-[11px] text-muted-foreground">Writers across Mastodon, Micro.blog and Write.as</p>
      <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 rounded-full px-2 text-[11px]" onClick={() => setPage(p => p + 1)} aria-label="Show more voices"><RefreshCw className="size-3" />{(page % pages) + 1}/{pages}</Button>
    </div>
    <ul className="space-y-5">{voicesPage(page).map(v => <li key={v.id} className="border-b border-border pb-5 animate-in fade-in duration-500">
      <a href={v.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-3" aria-label={`${v.name} on ${v.network}`}>
        <img className="social-avatar size-10 shrink-0" src={avatarPreset(defaultAvatarKey(v.id)).src} alt="" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-xs font-semibold group-hover:underline">{v.name}<ArrowUpRight className="size-3 text-muted-foreground" /></span>
          <span className="block truncate text-[10px] text-muted-foreground">{v.handle}</span>
          <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><NetworkBadge network={v.network} /> · {v.topic}</span>
          <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{v.bio}</span>
        </span>
      </a>
    </li>)}</ul>
  </div>;
}
