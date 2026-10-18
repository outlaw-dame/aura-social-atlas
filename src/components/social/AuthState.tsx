// Session state for Atlas accounts. One subscription, shared through context.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Session, User } from '@supabase/supabase-js';

export type AtlasProfile = { display_name: string | null; avatar_key: string | null };

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: AtlasProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AtlasAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AtlasProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setProfile(null);
      return;
    }
    supabase
      .from('profiles')
      .select('display_name, avatar_key')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile((data as AtlasProfile | null) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAtlasAuth() {
  const state = useContext(AuthContext);
  if (!state) throw new Error('AtlasAuthProvider is required');
  return state;
}
