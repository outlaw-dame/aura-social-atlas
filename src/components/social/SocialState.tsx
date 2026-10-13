import { createContext, useContext, useState, type ReactNode } from 'react';
type State = { followed: string[]; saved: string[]; toggleFollow: (id: string) => void; toggleSave: (id: string) => void; dark: boolean; toggleDark: () => void };
const SocialContext = createContext<State | null>(null);
export function SocialProvider({ children }: { children: ReactNode }) {
  const [followed, setFollowed] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [dark, setDark] = useState(false);
  const toggleFollow = (id: string) => setFollowed(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);
  const toggleSave = (id: string) => setSaved(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);
  return <SocialContext.Provider value={{ followed, saved, toggleFollow, toggleSave, dark, toggleDark: () => setDark(v => !v) }}>{children}</SocialContext.Provider>;
}
export function useSocial() {
  const state = useContext(SocialContext);
  if (!state) throw new Error('SocialProvider is required');
  return state;
}
