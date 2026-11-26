/**
 * FediBuzz's topic relays (https://relay.fedi.buzz, source: https://github.com/astro/buzzrelay). Each hashtag has a
 * relay actor anyone can follow, like an account: buzzrelay accepts the Follow from any actor and then sends it an
 * `Announce` (a boost) of every public post with that tag it sees across the fediverse. Followed from the person's own
 * Fedizen account, those posts arrive on Fedizen itself, as boosts by the relay, where they can be liked, replied to
 * and boosted like any other.
 *
 * buzzrelay names a tag's relay by the tag transliterated to ASCII (deunicode), lowercased, without spaces or hyphens
 * (ActorKind::from_tag). Atlas only offers tags whose name that leaves unchanged apart from case, so the handle it
 * follows is exactly the relay for the tag on screen.
 */
export const FEDIBUZZ_HOST = 'relay.fedi.buzz';

export type TagRelay = { key: string; acct: string; actor: string };

export function tagRelay(tag: string): TagRelay | null {
  const key = tag.trim().replace(/^#/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,100}$/.test(key)) return null;
  return { key, acct: `tag-${key}@${FEDIBUZZ_HOST}`, actor: `https://${FEDIBUZZ_HOST}/tag/${key}` };
}
