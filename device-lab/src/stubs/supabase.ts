/**
 * The Supabase client in the Lab: a signed-in sample account whose Atlas profile is kept in memory. Signing out
 * signs out for this page load; the Lab's own Sign in button (or a reload) signs back in. Nothing is sent anywhere.
 */
import { LAB_USER, labProfile } from '../data/me';

type Session = { access_token: string; user: { id: string; email: string } };
type Listener = (event: string, s: Session | null) => void;

const session: Session = { access_token: 'device-lab', user: { id: LAB_USER.id, email: LAB_USER.email } };
let current: Session | null = session;
const listeners = new Set<Listener>();
const tell = (event: string) => listeners.forEach(l => l(event, current));

export function labSignIn() { current = session; tell('SIGNED_IN'); }

const profileQuery = (patch?: Record<string, unknown>) => {
  const q = {
    select: () => q, eq: () => q, update: (p: Record<string, unknown>) => profileQuery(p),
    maybeSingle: () => done(), single: () => done(),
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => done().then(ok, bad),
  };
  const done = async () => {
    if (patch) Object.assign(labProfile, patch);
    return { data: current ? { ...labProfile } : null, error: null };
  };
  return q;
};

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: current }, error: null }),
    getClaims: async () => ({ data: current ? { claims: { sub: current.user.id } } : null, error: null }),
    onAuthStateChange: (cb: Listener) => {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    signOut: async () => { current = null; tell('SIGNED_OUT'); return { error: null }; },
  },
  from: (table: string) => {
    if (table !== 'profiles') throw new Error(`Device Lab: no sample table ${table}`);
    return profileQuery();
  },
};
