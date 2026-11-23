/** Source-aware moderation boundary for Spotlight. Pure; never uses a public cache
 * for per-account decisions. "Provider" is a publisher, not an account origin.
 */
import type { FilterablePost } from './content-filter';
import { combineSpotlight, type BonfireArticle, type SpotlightItem } from './spotlight';

export type SpotlightModeration = {
  blockedHandles: string[];
  mutedHandles: string[];
  blockedIds: string[];
  mutedIds: string[];
  /** The deployed Bonfire API does not yet expose the user's instance blocks.
   * Without that list, remote actors must not be promoted into Spotlight.
   */
  domainCoverage: 'complete' | 'unavailable';
  blockedDomains: string[];
};

export function normalizedAccount(raw: string): string | null {
  const value = raw.trim().replace(/^@/, '').toLowerCase();
  const parts = value.split('@');
  if (!parts[0] || parts.length > 2 || /[\s/#?]/.test(value)) return null;
  const host = parts[1] ?? 'fedizen.net';
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || host.startsWith('.') || host.endsWith('.')) return null;
  return `${parts[0]}@${host}`;
}
export function accountHost(raw: string): string | null {
  const account = normalizedAccount(raw);
  return account ? account.slice(account.lastIndexOf('@') + 1) : null;
}
export function domainBlocked(host: string, domains: readonly string[]): boolean {
  const lower = host.toLowerCase().replace(/\.$/, '');
  return domains.some(domain => lower === domain || lower.endsWith(`.${domain}`));
}

/** Never mistake publisher attribution for knowledge of who shared the link.
 * A link with no identified source actor is NOT safe to place in a user's Spotlight.
 * Every known contributing actor must pass the same moderation boundary.
 */
/** Apply account blocks, mutes and domain coverage to the raw contributors
 * before any grouped card can inherit blocked text or suppress a safe URL. */
export function allowedSpotlightSources(
  inputSources: SpotlightItem['sourceAccounts'], sourceComplete: SpotlightItem['sourceComplete'],
  moderation: SpotlightModeration,
): boolean {
  const sources = inputSources ?? [];
  if (sourceComplete === false || !sources.length) return false;
  const blocked = new Set([...moderation.blockedHandles, ...moderation.mutedHandles].map(normalizedAccount).filter(Boolean));
  const bannedIds = new Set([...moderation.blockedIds, ...moderation.mutedIds]);
  for (const source of sources) {
    const acct = normalizedAccount(source.handle);
    const host = acct && accountHost(acct);
    // Bonfire's account mapper can fall back to a short username even for a
    // remote actor when its "acct" field is absent. Cross-check the canonical
    // actor URL before ever classifying that user as Fedizen-local.
    let actorHost: string | null = null;
    try {
      const actor = new URL(source.actorUrl ?? '');
      if (actor.protocol === 'https:' && !actor.username && !actor.password && !actor.port) actorHost = actor.hostname.toLowerCase();
    } catch { /* unknown actor origin is not proof of safety */ }
    if (!acct || !host || !actorHost || actorHost !== host ||
      blocked.has(acct) || (source.id && bannedIds.has(source.id))) return false;
    if (moderation.domainCoverage !== 'complete' && host !== 'fedizen.net') return false;
    if (domainBlocked(host, moderation.blockedDomains)) return false;
  }
  return true;
}

export function allowedSpotlightItem(item: SpotlightItem, moderation: SpotlightModeration): boolean {
  if (!allowedSpotlightSources(item.sourceAccounts, item.sourceComplete, moderation)) return false;
  const blocked = new Set([...moderation.blockedHandles, ...moderation.mutedHandles].map(normalizedAccount).filter(Boolean));
  const attributedAuthor = item.authorAccount?.acct;
  if (attributedAuthor) {
    const acct = normalizedAccount(attributedAuthor);
    const host = acct && accountHost(acct);
    if (!acct || !host || blocked.has(acct) ||
        (moderation.domainCoverage !== 'complete' && host !== 'fedizen.net') ||
        domainBlocked(host, moderation.blockedDomains)) return false;
  }
  return true;
}

/** Confirm a native Article's author is a real source actor before owner
 * moderation. GraphQL may provide a *bare* username for a remote author, and
 * Bonfire's public byline helper maps bare names to Fedizen by default.
 * Remote provenance is accepted only with an explicit user@host handle matching
 * the canonical HTTPS actor host; it remains HIDDEN without owner domain-block
 * coverage in allowedSpotlightItem(). */
export function verifiedBonfireArticleSource(
  article: Pick<BonfireArticle, 'handle' | 'authorUrl'>,
  author: SpotlightItem['authorAccount'],
): Pick<SpotlightItem, 'sourceAccounts' | 'sourceComplete'> {
  const missing = { sourceAccounts: [], sourceComplete: false } as const;
  const acct = author?.acct && normalizedAccount(author.acct);
  if (!acct || !article.authorUrl) return missing;
  const host = accountHost(acct);
  const raw = article.handle?.replace(/^@/, '') ?? '';
  // Bare usernames are local only if the independently verified actor host
  // really is Fedizen. Remote actors need an explicit host in their handle.
  if (host !== 'fedizen.net' && !/^[^@]+@[^@]+$/.test(raw)) return missing;
  try {
    const actor = new URL(article.authorUrl);
    if (actor.protocol !== 'https:' || actor.username || actor.password || actor.port ||
        actor.hostname.toLowerCase() !== host) return missing;
    return {
      sourceAccounts: [{ handle: acct, actorUrl: article.authorUrl }],
      sourceComplete: true,
    };
  } catch {
    return missing;
  }
}

/** Existing Atlas keyword/semantic filter engine operates on this exact
 * FilterablePost contract. No second filtering algorithm or AI engine.
 */
export function spotlightFilterPost(item: SpotlightItem): FilterablePost {
  return {
    id: item.id,
    paragraphs: [item.title, item.description, item.filterText ?? '', item.provider].filter(Boolean),
    linkTitle: item.title,
    linkDescription: item.description,
    authorId: item.sourceAccounts?.[0]?.id,
    visibility: 'public',
  };
}

/** Reject blocked/unverifiable source records BEFORE coalescing equal URLs.
 * Public trend metadata alone does not prove a contributor is safe for the
 * viewer. Precedence applies only among records which passed moderation. */
export function selectModeratedSpotlight(
  shared: SpotlightItem[], viewer: SpotlightItem[], moderation: SpotlightModeration,
): SpotlightItem[] {
  const eligible = (items: SpotlightItem[]) => items.filter(item => allowedSpotlightItem(item, moderation));
  return combineSpotlight(
    eligible(shared.filter(item => item.reason === 'trending')),
    eligible(viewer),
    eligible(shared.filter(item => item.reason !== 'trending')),
  );
}
