# Architecture
- Keep creator catalogue and filtering in browser-safe modules, separate from presentation, so sample discovery can later be replaced by a live source.
- Share session-only follow/save state through a root provider across discovery routes; do not imply account persistence until connected.
- Keep the existing AI assistant transport unchanged during presentation-only product pivots.
- Keep Compose independent of assistant opt-in; use a draft-only composer until social publishing is connected, to avoid implying posts were published.
- Use a settings layout with separate leaf pages for categories so each setting has a navigable URL.
- Accounts: profiles hold display name and avatar_key; avatar_key maps to bundled memoji assets in src/lib/atlas-avatars.ts, never stored as build-hashed URLs; session state comes from AtlasAuthProvider in src/components/social/AuthState.tsx, the single onAuthStateChange subscription.