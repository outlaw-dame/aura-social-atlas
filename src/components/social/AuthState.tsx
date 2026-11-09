// Session state for Atlas accounts. One subscription, shared through context.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { readOAuthError } from '@/lib/bonfire-auth';
import { observeSession } from '@/lib/auth-session';
import type { Session, User } from '@supabase/supabase-js';

export type AtlasProfile = {
  display_name: string | null;
  avatar_key: string | null;
  bio: string | null;
  featured_hashtags: string[];
  created_at: string;
};

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: AtlasProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<AtlasProfile, 'display_name' | 'avatar_key' | 'bio' | 'featured_hashtags'>>) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AtlasAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const previousUser = useRef<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profileRecord, setProfileRecord] = useState<{ userId: string; profile: AtlasProfile } | null>(null);
  const profile = profileRecord?.userId === session?.user.id ? profileRecord?.profile ?? null : null;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A failed OAuth round trip returns to the app origin with error params; show it on /auth.
    if (window.location.pathname !== '/auth' && readOAuthError(window.location.href)) {
      window.location.replace(`/auth${window.location.search}${window.location.hash}`);
      return;
    }
    return observeSession<Session>(
      notify => {
        const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => notify(nextSession));
        return () => sub.subscription.unsubscribe();
      },
      async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session;
      },
      setSession,
      () => setLoading(false),
    );
  }, []);

  const userId = session?.user?.id;

  useEffect(() => {
    const priorId = previousUser.current;
    previousUser.current = userId ?? null;
    if (priorId && priorId !== userId) {
      const oldKey = ['fedizen-home', priorId];
      // This cache is private. A signed-out or switched account must never
      // leave its Home or notifications available to a later browser session.
      void queryClient.cancelQueries({ queryKey: oldKey, exact: true }).then(() => {
        queryClient.removeQueries({ queryKey: oldKey, exact: true });
      });
    }
  }, [userId, queryClient]);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setProfileRecord(null);
      return;
    }
    supabase
      .from('profiles')
      .select('display_name, avatar_key, bio, featured_hashtags, created_at')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfileRecord(data ? { userId, profile: data as AtlasProfile } : null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfileRecord(null);
  };

  const updateProfile: AuthState['updateProfile'] = async (patch) => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select('display_name, avatar_key, bio, featured_hashtags, created_at')
      .single();
    if (error) throw error;
    setProfileRecord({ userId, profile: data as AtlasProfile });
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, signOut, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAtlasAuth() {
  const state = useContext(AuthContext);
  if (!state) throw new Error('AtlasAuthProvider is required');
  return state;
}
