import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { RETURN_KEY, safeReturnPath } from '@/lib/fedizen-feed';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { finishFedizenConnect } from '@/lib/fedizen.functions';

export const Route = createFileRoute('/fedizen/callback')({
  head: () => ({ meta: [{ title: 'Connecting Fedizen — Atlas' }, { name: 'description', content: 'Finishing your Fedizen connection on Atlas.' }, { property: 'og:title', content: 'Connecting Fedizen — Atlas' }, { property: 'og:description', content: 'Finishing your Fedizen connection on Atlas.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' }, { name: 'robots', content: 'noindex' }] }),
  component: Callback,
});

function Callback() {
  const { user, loading } = useAtlasAuth();
  const finish = useServerFn(finishFedizenConnect);
  const navigate = useNavigate();
  const ran = useRef(false);
  const [msg, setMsg] = useState('Connecting your Fedizen account…');
  useEffect(() => {
    if (loading || ran.current) return;
    const p = new URLSearchParams(window.location.search);
    const code = p.get('code'), state = p.get('state');
    window.history.replaceState(null, '', '/fedizen/callback');
    if (!user) { setMsg('Please sign in to Atlas first, then connect Fedizen again.'); return; }
    if (!code || !state) { setMsg(p.get('error') ? 'Fedizen access wasn’t allowed.' : 'This connection link is incomplete.'); return; }
    ran.current = true;
    let back = '/feeds';
    try { back = safeReturnPath(sessionStorage.getItem(RETURN_KEY)); sessionStorage.removeItem(RETURN_KEY); } catch { /* storage unavailable */ }
    finish({ data: { code, state } }).then(r => r.ok ? window.location.assign(back) : setMsg(r.error)).catch(() => setMsg('Something went wrong. Please try again.'));
  }, [loading, user, finish, navigate]);
  return <main className="grid min-h-screen place-items-center bg-background p-6 text-center text-foreground"><div><h1 className="font-serif text-3xl">Fedizen</h1><p className="mt-3 text-sm text-muted-foreground">{msg}</p><a href="/feeds" className="mt-5 inline-block text-sm text-accent underline">Back to Feeds</a></div></main>;
}
