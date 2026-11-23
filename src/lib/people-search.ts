/**
 * Finding someone in a long list of accounts (blocked or muted people): every word typed must appear in the name or
 * the handle, ignoring case, accents and a leading "@". Order is kept (Fedizen sends the most recent first).
 */
export type ListedPerson = { name: string; handle: string };

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function searchPeople<P extends ListedPerson>(people: P[], query: string): P[] {
  const words = fold(query).replace(/^@/, '').split(/\s+/).filter(Boolean);
  if (!words.length) return people;
  return people.filter(p => {
    const hay = `${fold(p.name)} ${fold(p.handle).replace(/^@/, '')}`;
    return words.every(w => hay.includes(w.replace(/^@/, '')));
  });
}

/** The people a list shows before "Show all": enough to recognise it, short enough not to bury what follows. */
export const PEOPLE_PREVIEW = 5;
