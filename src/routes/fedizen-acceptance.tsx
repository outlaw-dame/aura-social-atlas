import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { Button } from '@/components/ui/button';
import { getFedizenCircles, getFedizenHome, getFedizenHomeLatest, getFedizenMessages, getFedizenSaved, getFedizenStatus, getGroupedNotifications, getNotificationMarker, startFedizenConnect } from '@/lib/fedizen.functions';
import { getFedizenNativeAcceptance } from '@/lib/bonfire-acceptance.functions';
import { isEmbeddedPreview } from '@/lib/bonfire-auth';
import { supabase } from '@/integrations/supabase/client';
import { runSessionReplay, type SessionReplayResult } from '@/lib/session-revocation-check';
import { auditPrivateReads, type PrivateReadEvidence } from '@/lib/staging-private-read-audit';
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
  const { user, loading, session, signOut } = useAtlasAuth();
  const userId = user?.id ?? null;
  const start = useServerFn(startFedizenConnect);
  const probe = useServerFn(getFedizenNativeAcceptance);
  const readStatus = useServerFn(getFedizenStatus);
  const readHome = useServerFn(getFedizenHome);
  const readHomeLatest = useServerFn(getFedizenHomeLatest);
  const readMessages = useServerFn(getFedizenMessages);
  const readGrouped = useServerFn(getGroupedNotifications);
  const readMarker = useServerFn(getNotificationMarker);
  const readSaved = useServerFn(getFedizenSaved);
  const readCircles = useServerFn(getFedizenCircles);
  const pending = useRef(false);
  const [busy, setBusy] = useState<'connect' | 'run' | 'reads' | 'revocation' | null>(null);
  const [readAudit, setReadAudit] = useState<Owned<PrivateReadEvidence> | null>(null);
  const [revocation, setRevocation] = useState<SessionReplayResult | null>(null);
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
  const ownerReads = readAudit && readAudit.userId === userId ? readAudit.value : null;
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

  const runPrivateReadAudit = async () => {
    if (!userId || pending.current) return;
    pending.current = true;
    setBusy('reads'); setReadAudit(null); setError(null);
    const data = { expectedAtlasUserId: userId };
    try {
      const evidence = await auditPrivateReads([
        { label: 'Fedizen connection', run: () => readStatus() },
        { label: 'Following / Home', run: () => readHome({ data }) },
        { label: 'Home refresh', run: () => readHomeLatest({ data }) },
        { label: 'Direct conversations', run: () => readMessages({ data }) },
        { label: 'Activity / notifications', run: () => readGrouped({ data: { ...data, filter: 'all' } }) },
        { label: 'Notification marker', run: () => readMarker({ data }) },
        { label: 'Saved posts', run: () => readSaved({ data }) },
        { label: 'Circles', run: () => readCircles({ data }) },
      ]);
      setReadAudit({ userId, value: evidence });
    } catch {
      setError({ userId, value: 'The protected-read audit could not complete. No privacy conclusion was recorded.' });
    } finally { pending.current = false; setBusy(null); }
  };

  const runRevocation = async () => {
    // Explicit operator action only. The old token stays in this callback's
    // memory; it is never put in component state, browser storage, logs, or URLs.
    const jwt = session?.access_token;
    if (!userId || !jwt || pending.current) return;
    pending.current = true;
    setBusy('revocation');
    setRevocation(null);
    setError(null);
    const headers = { Authorization: 'Bearer ' + jwt };
    const data = { expectedAtlasUserId: userId };

    try {
      // Prove this *specific token* is authorized before signing it out.
      const baseline = await readStatus({ headers });
      if (!baseline.connected) {
        setError({ userId, value: 'Connect a Fedizen test account before checking sign-out revocation.' });
        return;
      }

      const results = await runSessionReplay({
        signOut,
        wait: milliseconds => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds)),
        authRefused: async () => {
          try {
            const { data: auth, error } = await supabase.auth.getUser(jwt);
            if (error && (error.status === 403 || error.status === 401)) return true;
            if (auth?.user && !error) return false;
            return null;
          } catch {
            return null;
          }
        },
        // These are eight distinct, existing private reads. A returned result
        // counts as a failure; its contents are immediately discarded.
        checks: [
          { label: 'Connection status', run: () => readStatus({ headers }) },
          { label: 'Following and activity', run: () => readHome({ data, headers }) },
          { label: 'Home refresh', run: () => readHomeLatest({ data, headers }) },
          { label: 'Messages', run: () => readMessages({ data, headers }) },
          { label: 'Grouped activity', run: () => readGrouped({ data: { ...data, filter: 'all' }, headers }) },
          { label: 'Notification marker', run: () => readMarker({ data, headers }) },
          { label: 'Saved posts', run: () => readSaved({ data, headers }) },
          { label: 'Circles', run: () => readCircles({ data, headers }) },
        ],
      });
      setRevocation(results);
    } catch {
      // Network errors and incomplete sign-outs must never count as PASS.
      setRevocation({ verdict: 'inconclusive', authRefused: null, checks: [] });
    } finally {
      pending.current = false;
      setBusy(null);
    }
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
            <Button asChild className="mt-4" disabled={busy === 'revocation'}><Link to="/auth">Sign in</Link></Button>
          </section>
        ) : (
          <>
            <section className="mt-8 rounded-lg border border-border p-5" aria-labelledby="connect-heading">
              <h2 id="connect-heading" className="font-medium">1. Connect Fedizen</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Opens Fedizen to approve the permissions Atlas currently requests (read, write, and follow). These diagnostics only read data and never post. After approving you’ll land on Following; return here to run the checks.
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

            <section className="mt-4 rounded-lg border border-border p-5" aria-labelledby="private-reads-heading">
              <h2 id="private-reads-heading" className="font-medium">2. Test eight authenticated private reads</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Explicitly call the eight protected Atlas endpoints using your current session and connected Fedizen grant.
                This reads your authorized data but only displays endpoint outcomes and a count of private/direct posts
                in the sampled Home page. It never prints messages, posts, identities or tokens.
              </p>
              <Button className="mt-4" variant="outline" onClick={runPrivateReadAudit}
                disabled={busy !== null} aria-busy={busy === 'reads'}>
                {busy === 'reads' ? 'Checking eight private endpoints…' : 'Test my eight protected reads'}
              </Button>
              {ownerReads && (
                <div className="mt-4" aria-live="polite">
                  <p className="text-sm font-medium" role="status">
                    {ownerReads.outcome === 'complete'
                      ? 'All eight owner-authenticated routes responded.'
                      : 'Some routes were unavailable or did not confirm authenticated data access.'}
                  </p>
                  {ownerReads.checks.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm">
                      {ownerReads.checks.map(check => (
                        <li key={check.label} className="flex items-center justify-between gap-4 border-b border-border py-1.5 last:border-0">
                          <span>{check.label}</span>
                          <span>{check.result === 'readable' ? 'Readable' : 'Inconclusive'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    Home page sampled: {ownerReads.homeSampleCount ?? 'not available'} posts.
                    Private/direct visibility markers found: {ownerReads.nonPublicHomeCount ?? 'not available'}.
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {ownerReads.nonPublicHomeCount === 0
                      ? 'No private/direct posts were present in this sampled Home page. Private-content isolation cannot be proven from it.'
                      : ownerReads.nonPublicHomeCount !== null
                        ? 'Non-public visibility markers were found, but a second independently authorized account is still required to prove cross-account denial.'
                        : 'The Home visibility sample was not available, so no private-content conclusion can be drawn.'}
                    {' '}A successful owner read is not evidence that anonymous users or a different Fedizen account can read the same private content.
                  </p>
                </div>
              )}
            </section>

            <section className="mt-4 rounded-lg border border-border p-5" aria-labelledby="run-heading">
              <h2 id="run-heading" className="font-medium">3. Verify owner identity via REST and GraphQL</h2>
              <p className="mt-1 text-xs text-muted-foreground">Checks the connected account's REST identity and authorized GraphQL Me, profile, Home, notifications and anonymous Me refusal. It does not prove another user cannot access a private post.</p>
              <Button className="mt-4" onClick={run} disabled={busy !== null || cooldown > 0} aria-busy={busy === 'run'} aria-describedby={cooldown > 0 && busy === null ? 'run-cooldown' : undefined}>
                {busy === 'run' ? 'Checking REST and GraphQL…' : 'Test six REST / GraphQL owner and anonymous checks'}
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

            <section className="mt-4 rounded-lg border border-border p-5" aria-labelledby="revocation-heading">
              <h2 id="revocation-heading" className="font-medium">4. Verify sign-out revocation</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This staging-only check signs you out of Atlas, waits beyond the 15-second server cache window,
                and retries eight private reads using the former session. It does not disconnect or revoke the
                separate Fedizen API grant. Your access token and private responses are never displayed or saved.
                Keep this tab open until the result appears.
              </p>
              <Button className="mt-4" variant="outline" onClick={runRevocation}
                disabled={busy !== null} aria-busy={busy === 'revocation'}>
                {busy === 'revocation' ? 'Checking session revocation…' : 'Sign out and test eight private reads'}
              </Button>
            </section>

            {message && (
              <p role="alert" className="mt-4 rounded-md border border-destructive/40 p-3 text-sm text-destructive">{message}</p>
            )}
          </>
        )}
        {busy === 'revocation' && (
          <p className="mt-6 text-sm text-muted-foreground" role="status">
            Checking the old session after sign-out. Keep this page open.
          </p>
        )}
        {revocation && busy !== 'revocation' && (
          <section className="mt-6 rounded-lg border border-border p-5" aria-live="polite">
            <h2 className="font-medium">Sign-out replay result</h2>
            <p className="mt-2 text-sm" role="status">
              {revocation.verdict === 'passed'
                ? 'PASS: Supabase rejected the old session and all eight private reads returned the expected session-ended refusal.'
                : revocation.verdict === 'failed'
                  ? 'FAIL: The old session or at least one private read was still accepted.'
                  : 'INCONCLUSIVE: A network error, unexpected response or incomplete check prevented confirmation.'}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Supabase Auth refusal: {revocation.authRefused === true ? 'Confirmed'
                : revocation.authRefused === false ? 'Not observed' : 'Not confirmed'}
            </p>
            {revocation.checks.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {revocation.checks.map(check => (
                  <li key={check.label} className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
                    <span>{check.label}</span>
                    <span>{check.outcome === 'denied' ? 'Denied' : check.outcome === 'accepted' ? 'Accepted — failure' : 'Inconclusive'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}