/** Follow wording on profile cards: you subscribe to a podcast, and follow everyone else. */
export function followLabels(kind: string, locked: boolean) {
  return kind === 'podcast'
    ? { on: 'Subscribed', asked: 'Requested', off: locked ? 'Request to subscribe' : 'Subscribe' }
    : { on: 'Following', asked: 'Requested', off: locked ? 'Request to follow' : 'Follow' };
}
