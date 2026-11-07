/**
 * Fediverse author attribution for articles — browser-safe parsing and trust rules.
 *
 * Mastodon credits a link's author only through the page's `fediverse:creator` meta tag, and only when
 * that account lists the page's domain in `attributionDomains`. Articles published natively over
 * ActivityPub (Ghost, WordPress's ActivityPub plugin, WriteFreely, Bonfire…) already name their author in
 * the object's `attributedTo`, but Mastodon's link previews never read it. Atlas does:
 *
 *   1. the article's own ActivityPub object (content negotiation, or <link rel="alternate"
 *      type="application/activity+json">) → `attributedTo` → actor;
 *   2. otherwise `fediverse:creator` → WebFinger → actor;
 *   3. otherwise the plain byline.
 *
 * Trust rule (both paths): an actor is credited only if it lives on the article's own host, or lists the
 * article's domain in `attributionDomains` — so a page can't claim someone else's account.
 *
 * The network side (safe fetching, caching) is in article-author.server.ts.
 */

export type AttributionSource = "mastodon" | "activitypub" | "fediverse-creator" | "fedizen";

export type FediAuthor = {
  name: string;
  /** Full handle, e.g. "@jane@example.social". */
  acct: string;
  /** Profile page to open (the actor's `url`, else its id). */
  url: string;
  avatar?: string;
  /** How the authorship was established — shown to readers. */
  verifiedBy: AttributionSource;
};

export const MAX_AUTHORS = 3;

const BLOCKED_HOST =
  /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|corp|test|invalid|example)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Only public https URLs on a named host: no IP literals, credentials, odd ports or internal names. */
export function isPublicHttpsUrl(raw: string | undefined | null): raw is string {
  if (!raw || raw.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host.startsWith("[") || IPV4.test(host) || BLOCKED_HOST.test(host))
    return false;
  return true;
}

export const normalizeHost = (host: string) =>
  host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");

/** A domain listed in attributionDomains covers itself and its subdomains (as Mastodon does). */
export function domainCovers(domain: string, host: string): boolean {
  const d = normalizeHost(
    String(domain)
      .replace(/^https?:\/\//i, "")
      .split("/")[0],
  );
  const h = normalizeHost(host);
  return !!d && (h === d || h.endsWith(`.${d}`));
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const ARTICLE_TYPES = new Set(["Article", "Note", "Page", "Document", "Video", "Audio", "Event"]);
const ACTOR_TYPES = new Set(["Person", "Organization", "Service", "Group", "Application"]);
const typesOf = (o: Json) => list(o.type).filter((t): t is string => typeof t === "string");

export function isArticleObject(o: unknown): o is Json {
  return isObj(o) && typesOf(o).some((t) => ARTICLE_TYPES.has(t)) && o.attributedTo != null;
}

/** attributedTo may be a URL, an embedded actor, or a list of either. Returns embedded actors or ids. */
export function attributedActors(article: Json): (string | Json)[] {
  return list(article.attributedTo)
    .map((a) =>
      typeof a === "string"
        ? a
        : isObj(a)
          ? typesOf(a).some((t) => ACTOR_TYPES.has(t))
            ? a
            : str(a.id)
          : undefined,
    )
    .filter((a): a is string | Json => !!a)
    .slice(0, MAX_AUTHORS);
}

export function isActor(o: unknown): o is Json {
  return isObj(o) && typesOf(o).some((t) => ACTOR_TYPES.has(t)) && isPublicHttpsUrl(str(o.id));
}

/** Domains the actor lets credit them (Mastodon's toot:attributionDomains; string or array). */
export function attributionDomains(actor: Json): string[] {
  return list(actor.attributionDomains ?? actor["toot:attributionDomains"])
    .filter((d): d is string => typeof d === "string")
    .slice(0, 100);
}

/** The trust rule: same host as the article, or the article's domain is in the actor's attributionDomains. */
export function actorMayClaim(actor: Json, articleUrl: string): boolean {
  const id = str(actor.id);
  if (!id || !isPublicHttpsUrl(id) || !isPublicHttpsUrl(articleUrl)) return false;
  const articleHost = new URL(articleUrl).hostname;
  if (normalizeHost(new URL(id).hostname) === normalizeHost(articleHost)) return true;
  return attributionDomains(actor).some((d) => domainCovers(d, articleHost));
}

/** Control characters, zero-width marks and bidi overrides/isolates (U+200B–200F, 202A–202E, 2066–2069)
 *  can make a remote display name lie about itself; drop them. */
const isUnsafeChar = (c: number) =>
  c <= 0x1f ||
  c === 0x7f ||
  (c >= 0x200b && c <= 0x200f) ||
  (c >= 0x202a && c <= 0x202e) ||
  (c >= 0x2066 && c <= 0x2069);

const clean = (s: string, max: number) =>
  Array.from(s)
    .filter((ch) => !isUnsafeChar(ch.codePointAt(0) ?? 0))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

function linkHref(v: unknown): string | undefined {
  for (const x of list(v)) {
    const href = typeof x === "string" ? x : isObj(x) ? (str(x.href) ?? str(x.url)) : undefined;
    if (isPublicHttpsUrl(href)) return href;
  }
  return undefined;
}

/** Actor → display fields. `handle` (from fediverse:creator/WebFinger) wins over a derived one. */
export function actorToAuthor(
  actor: Json,
  verifiedBy: AttributionSource,
  handle?: string,
): FediAuthor | null {
  const id = str(actor.id);
  if (!id || !isPublicHttpsUrl(id)) return null;
  const user = clean(str(actor.preferredUsername) ?? "", 64).replace(/^@/, "");
  const acct = handle
    ? `@${handle.replace(/^@/, "")}`
    : user
      ? `@${user}@${new URL(id).hostname}`
      : "";
  const name = clean(str(actor.name) ?? "", 80) || user || acct;
  if (!name || !acct) return null;
  const icon = list(actor.icon)
    .map((i) => (isObj(i) ? linkHref(i.url) : linkHref(i)))
    .find(Boolean);
  return { name, acct, url: linkHref(actor.url) ?? id, avatar: icon, verifiedBy };
}

/** fediverse:creator value → "user@domain" (accepts "@user@domain" and "acct:user@domain"). */
export function parseHandle(raw: string | undefined | null): string | null {
  const v = String(raw ?? "")
    .trim()
    .replace(/^acct:/i, "")
    .replace(/^@/, "");
  const m = /^([a-z0-9_.~-]{1,64})@([a-z0-9.-]{1,253}\.[a-z]{2,63})$/i.exec(v);
  return m ? `${m[1]}@${m[2].toLowerCase()}` : null;
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

function tags(html: string, name: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = new RegExp(`<${name}\\b[^>]*>`, "gi");
  for (const m of html.matchAll(re)) {
    const attrs: Record<string, string> = {};
    for (const a of m[0].matchAll(ATTR))
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
    out.push(attrs);
    if (out.length > 200) break;
  }
  return out;
}

/** Reads only the document head: the ActivityPub alternate link and fediverse:creator handles. */
export function parseArticleHead(
  html: string,
  pageUrl: string,
): { apAlternate?: string; creators: string[] } {
  const end = html.search(/<\/head\s*>/i);
  const head = (end > 0 ? html.slice(0, end) : html).slice(0, 262_144);
  let apAlternate: string | undefined;
  for (const l of tags(head, "link")) {
    const rel = (l.rel ?? "").toLowerCase().split(/\s+/);
    const type = (l.type ?? "").toLowerCase();
    if (
      rel.includes("alternate") &&
      (type.startsWith("application/activity+json") ||
        (type.startsWith("application/ld+json") && type.includes("activitystreams"))) &&
      l.href
    ) {
      try {
        const u = new URL(l.href, pageUrl);
        // Only the page's own host may supply its ActivityPub representation.
        if (
          isPublicHttpsUrl(u.href) &&
          normalizeHost(u.hostname) === normalizeHost(new URL(pageUrl).hostname)
        ) {
          apAlternate = u.href;
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }
  const creators = tags(head, "meta")
    .filter((m) => (m.name ?? m.property ?? "").toLowerCase() === "fediverse:creator")
    .map((m) => parseHandle(m.content))
    .filter((h): h is string => !!h);
  return { apAlternate, creators: [...new Set(creators)].slice(0, MAX_AUTHORS) };
}

/** WebFinger JRD → the ActivityPub actor URL. */
export function actorFromWebfinger(jrd: unknown): string | null {
  if (!isObj(jrd)) return null;
  for (const l of list(jrd.links)) {
    if (!isObj(l) || str(l.rel) !== "self") continue;
    const type = (str(l.type) ?? "").toLowerCase();
    if (
      (type.startsWith("application/activity+json") || type.includes("activitystreams")) &&
      isPublicHttpsUrl(str(l.href))
    )
      return str(l.href)!;
  }
  return null;
}
