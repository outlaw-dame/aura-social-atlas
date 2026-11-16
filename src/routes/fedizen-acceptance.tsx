import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { Button } from '@/components/ui/button';
import { startFedizenConnect } from '@/lib/fedizen.functions';
import { getFedizenNativeAcceptance } from '@/lib/bonfire-acceptance.functions';
import { isEmbeddedPreview } from '@/lib/bonfire-auth';
import { acceptanceCooldownRemaining, sanitizeAcceptanceResult, type AcceptanceView } from '@/lib/fedizen-acceptance-view';

const TITLE = 'Fedizen acceptance (staging) — Atlas';
const DESCRIPTION = 'Staging-only, read-only diagnostics for the Atlas Fedizen connection.';

export const Route = createFileRoute('/fedizen-acceptance')({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: FedizenAcceptancePage,
});

const STATUS_TEXT: Record<AcceptanceView['status'], string> = {
  passed: 'All checks passed.',
  failed: 'Diagnostics did not pass.',
  disconnected: 'No Fedizen connection for this Atlas account. Connect Fedizen first.',
  disabled: 'Diagnostics are switched off on this server.',
};

type Owned<T> = { userId: string; value: T };

function FedizenAcceptancePage() {
  const { user, loading } = useAtlasAuth();
  const userId = user?.id ?? null;
  const start = useServerFn(startFedizenConnect);
  const probe = useServerFn(getFedizenNativeAcceptance);
  const pending = useRef(false);
  const [busy, setBusy] = useState<'connect' | 'run' | null>(null);
  const [result, setResult] = useState<Owned<AcceptanceView> | null>(null);
  const [error, setError] = useState<Owned<string> | null>(null);
  const [lastRun, setLastRun] = useState<Owned<number> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => { setEmbedded(isEmbeddedPreview()); }, []);

  const lastRunAt = lastRun && lastRun.userId === userId ? lastRun.value : null;
  const cooldown = acceptanceCooldownRemaining(lastRunAt, now);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only show output to the Atlas account that produced it.
  const view = result && result.userId === userId ? result.value : null;
  const message = error && error.userId === userId ? error.value : null;

  const connect = async () => {
    if (!userId || pending.current) return;
    pending.current = true; setBusy('connect'); setError(null);
    try {
      const r = await start({ data: { origin: window.location.origin, expectedAtlasUserId: userId } });
      if (!r.url) { setError({ userId, value: r.error || 'Fedizen connection was not started.' }); return; }
      window.location.assign(r.url);
    } catch {
      setError({ userId, value: 'Could not start the Fedizen connection. Sign in again and retry.' });
    } finally { pending.current = false; setBusy(null); }
  };

  const run = async () => {
    if (!userId || pending.current || acceptanceCooldownRemaining(lastRunAt, Date.now()) > 0) return;
    pending.current = true; setBusy('run'); setError(null); setResult(null);
    const startedAt = Date.now();
    setLastRun({ userId, value: startedAt }); setNow(startedAt);
    try {
      const raw = await probe({ data: { expectedAtlasUserId: userId } });
      setResult({ userId, value: sanitizeAcceptanceResult(raw) });
    } catch {
      setError({ userId, value: 'Diagnostics could not run. Your session may have changed — sign in again and retry.' });
    } finally { pending.current = false; setBusy(null); }
  };

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <div className="mx-auto max-w-xl">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Staging only</p>
        <h1 className="mt-2 font-serif text-3xl">Fedizen acceptance</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Read-only checks of this Atlas account’s Fedizen connection. Nothing is posted or changed on Fedizen, and nothing runs until you press the button.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-muted-foreground" role="status">Checking your Atlas session…</p>
        ) : !user ? (
          <section className="mt-8 rounded-lg border border-border p-5">
            <p className="text-sm">Sign in to Atlas to use this page.</p>
            <Button asChild className="mt-4"><Link to="/auth">Sign in</Link></Button>
          </section>
        ) : (
          <>
            <section className="mt-8 rounded-lg border border-border p-5" aria-labelledby="connect-heading">
              <h2 id="connect-heading" className="font-medium">1. Connect Fedizen</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Opens Fedizen to approve read-only access. After approving you’ll land on Following; come back here to run the checks.
              </p>
              {embedded ? (
                <p className="mt-4 text-sm">
                  Fedizen can’t open inside the editor preview.{' '}
                  <a href="/fedizen-acceptance" target="_blank" rel="noopener noreferrer" className="text-accent underline">Open this page in a new tab</a> to connect.
                </p>
              ) : (
                <Button className="mt-4" variant="outline" onClick={connect} disabled={busy !== null} aria-busy={busy === 'connect'}>
                  {busy === 'connect' ? 'Opening Fedizen…' : 'Connect Fedizen'}
                </Button>
              )}
            </section>

            <section className="mt-4 rounded-lg border border-border p-5" aria-labelledby="run-heading">
              <h2 id="run-heading" className="font-medium">2. Run diagnostics</h2>
              <Button className="mt-4" onClick={run} disabled={busy !== null || cooldown > 0} aria-busy={busy === 'run'} aria-describedby={cooldown > 0 && busy === null ? 'run-cooldown' : undefined}>
                {busy === 'run' ? 'Running…' : 'Run read-only API diagnostics'}
              </Button>
              {cooldown > 0 && busy === null && (
                <p id="run-cooldown" className="mt-2 text-xs text-muted-foreground">You can run again in {Math.ceil(cooldown / 1000)}s.</p>
              )}

              <div aria-live="polite" className="mt-4">
                {view && (
                  <div>
                    <p className="text-sm font-medium" role="status">{STATUS_TEXT[view.status]}</p>
                    {view.checks.length > 0 && (
                      <ul className="mt-3 space-y-1 text-sm">
                        {view.checks.map(c => (
                          <li key={c.check} className="flex items-center justify-between gap-4 border-b border-border py-1.5 last:border-0">
                            <span>{c.label} <span className="text-xs text-muted-foreground">({c.check})</span></span>
                            <span className={c.passed ? 'text-primary' : 'text-destructive'}>{c.passed ? 'Pass' : 'Fail'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </section>

            {message && (
              <p role="alert" className="mt-4 rounded-md border border-destructive/40 p-3 text-sm text-destructive">{message}</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}