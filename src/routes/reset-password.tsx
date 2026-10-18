import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const Route = createFileRoute('/reset-password')({
  head: () => ({
    meta: [
      { title: 'Reset password · Atlas' },
      { name: 'description', content: 'Choose a new password for your Atlas account.' },
      { property: 'og:title', content: 'Reset password · Atlas' },
      { property: 'og:description', content: 'Choose a new password for your Atlas account.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [isRecovery, setIsRecovery] = useState(false);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.hash.includes('type=recovery')) setIsRecovery(true);
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus('saving');
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setStatus('error');
      return;
    }
    setStatus('done');
  };

  return (
    <main className="relative grid min-h-dvh place-items-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-card-foreground shadow-lg">
        {!isRecovery ? (
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold">Reset password</h1>
            <p className="text-sm opacity-75">
              Open the password reset link from your email to choose a new password.
            </p>
          </div>
        ) : status === 'done' ? (
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold">Password updated</h1>
            <p className="text-sm opacity-75">Your new password is set. You can head back and sign in with it.</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <h1 className="text-center text-xl font-semibold">Choose a new password</h1>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full rounded-full" disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Update password'}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
