// Subscribe first; a delayed initial read must never replace a newer auth event.
export function observeSession<T>(
  subscribe: (notify: (session: T | null) => void) => () => void,
  read: () => Promise<T | null>,
  apply: (session: T | null) => void,
  ready: () => void,
): () => void {
  let active = true;
  let receivedEvent = false;
  const unsubscribe = subscribe(session => {
    if (!active) return;
    receivedEvent = true;
    apply(session);
    ready();
  });
  void read().then(session => {
    if (active && !receivedEvent) apply(session);
  }).catch(() => {
    if (active && !receivedEvent) apply(null);
  }).finally(() => {
    if (active) ready();
  });
  return () => {
    active = false;
    unsubscribe();
  };
}