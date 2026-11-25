import { createContext, useContext, type ReactNode } from 'react';
import { useAccent } from '@/lib/accent';
import { useAvatarShape } from '@/lib/avatar-shape';
import { useApplyAppearance, type Appearance } from '@/lib/theme-mode';
// The assistant's on/off moved to the account (useAssistant in useIntelligence.tsx).
type State = { appearance: Appearance };
const SocialContext = createContext<State | null>(null);
export function SocialProvider({ children }: { children: ReactNode }) {
  useAccent();
  const appearance = useApplyAppearance();
  useAvatarShape();
  return <SocialContext.Provider value={{ appearance }}>{children}</SocialContext.Provider>;
}
export function useSocial() {
  const state = useContext(SocialContext);
  if (!state) throw new Error('SocialProvider is required');
  return state;
}
