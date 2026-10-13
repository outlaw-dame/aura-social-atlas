# Architecture
- Keep creator catalogue and filtering in browser-safe modules, separate from presentation, so sample discovery can later be replaced by a live source.
- Share session-only follow/save state through a root provider across discovery routes; do not imply account persistence until connected.
- Keep the existing AI assistant transport unchanged during presentation-only product pivots.