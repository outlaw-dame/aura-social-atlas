import { useEffect, useRef, useState, type FormEvent } from 'react';
import { friendlyBonfireError, isEmbeddedPreview, readOAuthError, standaloneAuthUrl } from '@/lib/bonfire-auth';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import '@lovable.dev/cloud-auth-js/styles.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AVATAR_PRESETS } from '@/lib/atlas-avatars';
import { cn } from '@/lib/utils';
import { Compass } from 'lucide-react';
import { authUiCapabilities } from '@/lib/auth-runtime';
import { runAccountAuth } from '@/lib/account-auth';

export const Route = createFileRoute('/auth')({
  head: () => ({
    meta: [
      { title: 'Sign in · Atlas' },
      { name: 'description', content: 'Sign in to Atlas to follow creators, save stories and use the composer.' },
      { property: 'og:title', content: 'Sign in · Atlas' },
      { property: 'og:description', content: 'Sign in to Atlas to follow creators, save stories and use the composer.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const authUi = authUiCapabilities(
    import.meta.env.VITE_ATLAS_AUTH_RUNTIME,
    import.meta.env.VITE_ATLAS_GOOGLE_OAUTH_ENABLED,
  );
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarKey, setAvatarKey] = useState(AVATAR_PRESETS[0].key);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [embeddedHref, setEmbeddedHref] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const socialSignIn = async (provider: 'google' | 'lovable') => {
    setError(null);
    setBusy(true);
    try {
      if (authUi.runtime === 'supabase') {
        // Independent Atlas deployments must never call Lovable Cloud auth.
        // The UI exposes Google only when that provider was explicitly enabled
        // for the selected Supabase project.
        if (provider !== 'google' || !authUi.google) return;
        const { error: oauthError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin },
        });
        if (oauthError) setError(oauthError.message);
        return;
      }
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (result.error) setError(result.error.message);
    } catch {
      setError('Could not start sign-in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Show an error the auth server sent back after a failed Bonfire round trip.
  useEffect(() => {
    const returned = readOAuthError(window.location.href);
    if (returned) {
      setError(friendlyBonfireError(`${returned.code} ${returned.description}`));
      window.history.replaceState(null, '', '/auth');
    }
  }, []);

  // Fedizen forbids framing, so inside the embedded preview we never start
  // OAuth; we offer a plain link that opens this page as its own tab instead.
  // Detected after mount so server and first client render match.
  useEffect(() => {
    if (isEmbeddedPreview()) setEmbeddedHref(standaloneAuthUrl(window.location.origin));
  }, []);

  // Top-level only: a normal full-page redirect to Fedizen, no popups.
  const bonfireSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      const { beginBonfireSignIn } = await import('@/lib/bonfire-signin');
      const failure = await beginBonfireSignIn(
        window.location.origin,
        options => supabase.auth.signInWithOAuth(options),
      );
      if (failure) setError(failure);
    } catch {
      setError('Couldn’t start Bonfire sign-in. Please try again.');
    } finally {
      // Some providers reject before starting navigation; never strand the UI.
      setBusy(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);

    try {
      if (mode === 'signup') {
        const result = await runAccountAuth(() => supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName || null, avatar_key: avatarKey },
          },
        }));
        if (result.kind === 'error') {
          setError(result.message);
          return;
        }
        if (!result.data.session) {
          setNeedsConfirmation(true);
          return;
        }
      } else {
        const result = await runAccountAuth(() => supabase.auth.signInWithPassword({ email, password }));
        if (result.kind === 'error') {
          setError(result.message);
          return;
        }
      }
      void navigate({ to: '/' });
    } finally {
      // A rejected SDK request must never strand the form in a busy state.
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="relative grid min-h-dvh place-items-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-card-foreground shadow-lg">
        <div className="flex items-center justify-center gap-2 pb-2">
          <Compass className="size-7 text-accent" strokeWidth={1.5} />
          <span className="font-semibold">Atlas</span>
        </div>
        {needsConfirmation ? (
          <div className="space-y-3 text-center">
            <h1 className="text-xl font-semibold">Check your email</h1>
            <p className="text-sm opacity-75">
              We sent a confirmation link to <strong>{email}</strong>. Open it to finish creating your account.
            </p>
            <Button variant="outline" className="w-full rounded-full" onClick={() => setMode('signin')}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <h1 className="text-center text-xl font-semibold">
              {mode === 'signin' ? 'Sign in to Atlas' : 'Create your account'}
            </h1>
            {mode === 'signup' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="display-name">Display name</Label>
                  <Input
                    id="display-name"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="How should we show you?"
                    autoComplete="nickname"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Pick an avatar</Label>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Choose an avatar">
                    {AVATAR_PRESETS.map(preset => (
                      <button
                        key={preset.key}
                        type="button"
                        role="radio"
                        aria-checked={avatarKey === preset.key}
                        onClick={() => setAvatarKey(preset.key)}
                        className={cn(
                          'size-11 rounded-full overflow-hidden transition-transform hover:scale-105',
                          avatarKey === preset.key && 'ring-2 ring-accent ring-offset-2 ring-offset-background'
                        )}
                      >
                        <img src={preset.src} alt={preset.label} className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={mode === 'signup' ? 8 : undefined}
                required
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full rounded-full" disabled={busy}>
              {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
            <div className="flex items-center gap-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
            </div>
            {authUi.google && (
              <Button type="button" variant="outline" className="w-full rounded-full" disabled={busy} onClick={() => void socialSignIn('google')}>
                Continue with Google
              </Button>
            )}
            {authUi.lovable && (
              <button
                type="button"
                className="lovable-auth-button"
                style={{ width: '100%' }}
                disabled={busy}
                onClick={() => void socialSignIn('lovable')}
              >
                Continue with Lovable
              </button>
            )}
            {embeddedHref ? (
              <div className="space-y-2">
                <Button asChild variant="outline" className="w-full rounded-full">
                  <a href={embeddedHref} target="_blank" rel="noopener noreferrer">
                    Open Atlas in new tab to sign in with Fedizen
                  </a>
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Fedizen can’t open inside this preview window. Use the link above, then choose Continue with Bonfire there.
                </p>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-full"
                disabled={busy}
                onClick={() => void bonfireSignIn()}
              >
                Continue with Bonfire (Fedizen.net)
              </Button>
            )}
            <p className="text-center text-sm opacity-75">
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin');
                  setError(null);
                }}
              >
                {mode === 'signin' ? 'Create one' : 'Sign in'}
              </button>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
