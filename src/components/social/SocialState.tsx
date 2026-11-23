import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAccent } from '@/lib/accent';
import { useAvatarShape } from '@/lib/avatar-shape';
import { useApplyAppearance, type Appearance } from '@/lib/theme-mode';
type State = { appearance: Appearance; assistantEnabled: boolean; setAssistantEnabled: (v: boolean) => void };
const SocialContext = createContext<State | null>(null);
const KEY = 'atlas-intelligence-enabled';
export function SocialProvider({ children }: { children: ReactNode }) {
  useAccent();
  const appearance = useApplyAppearance();
  useAvatarShape();
  const [assistantEnabled, setEnabled] = useState(false);
  useEffect(() => { setEnabled(localStorage.getItem(KEY) === '1'); }, []);
  const setAssistantEnabled = (v: boolean) => { setEnabled(v); localStorage.setItem(KEY, v ? '1' : '0'); };
  return <SocialContext.Provider value={{ appearance, assistantEnabled, setAssistantEnabled }}>{children}</SocialContext.Provider>;
}
export function useSocial() {
  const state = useContext(SocialContext);
  if (!state) throw new Error('SocialProvider is required');
  return state;
}
