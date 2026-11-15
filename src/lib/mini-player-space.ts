import { useEffect } from 'react';

/** How far floating controls (Compose) move up while the mini player is showing. */
export const MINI_PLAYER_OFFSET = '84px';

/** Keeps --atlas-player-offset and the html class in step with whether something is loaded. */
export function useMiniPlayerSpace(shown: boolean, offset: string) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('atlas-has-player', shown);
    if (shown) root.style.setProperty('--atlas-player-offset', offset); else root.style.removeProperty('--atlas-player-offset');
    return () => { root.classList.remove('atlas-has-player'); root.style.removeProperty('--atlas-player-offset'); };
  }, [shown, offset]);
}
