import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAtlasAuth } from './AuthState';
/** `canSave`: saving needs an account; signed out, `toggleSave` does nothing and the UI offers sign-in instead. */
type State = { followed: string[]; saved: string[]; canSave: boolean; toggleFollow: (id: string) => void; toggleSave: (id: string) => void; dark: boolean; toggleDark: () => void; assistantEnabled: boolean; setAssistantEnabled: (v: boolean) => void };
const SocialContext = createContext<State | null>(null);
const KEY = 'atlas-intelligence-enabled';
export function SocialProvider({ children }: { children: ReactNode }) {
  const [followed, setFollowed] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [dark, setDark] = useState(false);
  const [assistantEnabled, setEnabled] = useState(false);
  useEffect(() => { setEnabled(localStorage.getItem(KEY) === '1'); }, []);
  const setAssistantEnabled = (v: boolean) => { setEnabled(v); localStorage.setItem(KEY, v ? '1' : '0'); };
  const toggleFollow = (id: string) => setFollowed(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);
  const { user } = useAtlasAuth();
  const canSave = !!user;
  // Saved stories belong to the signed-in person: none while signed out, and cleared on sign-out.
  useEffect(() => { if (!user) setSaved([]); }, [user]);
  const toggleSave = (id: string) => { if (canSave) setSaved(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]); };
  return <SocialContext.Provider value={{ followed, saved, canSave, toggleFollow, toggleSave, dark, toggleDark: () => setDark(v => !v), assistantEnabled, setAssistantEnabled }}>{children}</SocialContext.Provider>;
}
export function useSocial() {
  const state = useContext(SocialContext);
  if (!state) throw new Error('SocialProvider is required');
  return state;
}
