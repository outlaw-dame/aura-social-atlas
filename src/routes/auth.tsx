import { useState, type FormEvent } from 'react';
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
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarKey, setAvatarKey] = useState(AVATAR_PRESETS[0].key);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);

  const socialSignIn = async (provider: 'google' | 'lovable') => {
    setError(null);
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin,
    });
    if (result.error) setError(result.error.message);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    if (mode === 'signup') {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { display_name: displayName || null, avatar_key: avatarKey },
        },
      });
      setBusy(false);
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (!data.session) {
        setNeedsConfirmation(true);
        return;
      }
      void navigate({ to: '/' });
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    void navigate({ to: '/' });
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
            <Button type="button" variant="outline" className="w-full rounded-full" onClick={() => void socialSignIn('google')}>
              Continue with Google
            </Button>
            <button
              type="button"
              className="lovable-auth-button"
              style={{ width: '100%' }}
              onClick={() => void socialSignIn('lovable')}
            >
              Continue with Lovable
            </button>
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
