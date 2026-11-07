/**
 * Resolves who wrote an article on the open web — server only. Trust and parsing rules are in article-author.ts.
 *
 * Fetching arbitrary article URLs is guarded: https only, public named hosts only (no IP literals or
 * internal names) that resolve only to public addresses (checked over DNS-over-HTTPS on every hop), every redirect hop re-validated (max 3), short timeouts, a response-size cap, no
 * credentials or cookies, and only the expected content types are parsed. Results are cached per isolate.
 */
import {
  MAX_AUTHORS,
  actorFromWebfinger,
  actorMayClaim,
  actorToAuthor,
  attributedActors,
  isActor,
  isArticleObject,
  isPublicHttpsUrl,
  isPublicIp,
  normalizeHost,
  parseArticleHead,
  parseHandle,
  type FediAuthor,
} from "./article-author";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
/** Host → its A/AAAA addresses, or null if it can't be resolved. */
export type Lookup = (host: string) => Promise<string[] | null>;

const AP_ACCEPT =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';
const PAGE_ACCEPT = `${AP_ACCEPT};q=0.9, text/html;q=0.8`;
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 3500;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Atlas/1.0 (open-web author attribution)";

/* ── DNS check: a public-looking name must also resolve only to public addresses ──────────────── */

const DOH = "https://cloudflare-dns.com/dns-query";
const dnsCache = new Map<string, { until: number; ips: string[] | null }>();

/** Resolves A and AAAA over DNS-over-HTTPS (Workers has no DNS API). Cached per isolate for the
 *  record TTL, between 30 s and 5 min. */
export const dohLookup: Lookup = async (host) => {
  const hit = dnsCache.get(host);
  if (hit && hit.until > Date.now()) return hit.ips;
  const ask = async (type: "A" | "AAAA") => {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error("doh");
    const j = (await res.json()) as {
      Status?: number;
      Answer?: { type: number; data: string; TTL: number }[];
    };
    if (j.Status !== 0 && j.Status !== 3) throw new Error("doh");
    return (j.Answer ?? []).filter((a) => a.type === 1 || a.type === 28);
  };
  try {
    const answers = (await Promise.all([ask("A"), ask("AAAA")])).flat();
    const ips = answers.length ? answers.map((a) => a.data) : null;
    const ttl = Math.min(300, Math.max(30, ...answers.map((a) => a.TTL || 0)));
    if (dnsCache.size >= 500) dnsCache.delete(dnsCache.keys().next().value as string);
    dnsCache.set(host, { until: Date.now() + ttl * 1000, ips });
    return ips;
  } catch {
    return null; // fail closed
  }
};

/** Every address the host resolves to must be public (blocks names like 127.0.0.1.nip.io). */
async function resolvesPublic(host: string, lookup: Lookup): Promise<boolean> {
  const ips = await lookup(host.toLowerCase().replace(/\.$/, ""));
  return !!ips && ips.length > 0 && ips.every(isPublicIp);
}

type Fetched = { url: string; type: string; text: string };

async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > max) return null;
  if (!res.body) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      break;
    } // keep what we have: a page head is near the top
    chunks.push(value);
  }
  const all = new Uint8Array(Math.min(size, max));
  let off = 0;
  for (const c of chunks) {
    all.set(c.subarray(0, all.length - off), off);
    off += c.byteLength;
    if (off >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

/** GET with manual, re-validated redirects, a timeout and a size cap. Null on any failure. */
export async function safeFetch(
  url: string,
  accept: string,
  fetchImpl: FetchLike = fetch,
  lookup: Lookup = dohLookup,
): Promise<Fetched | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicHttpsUrl(current)) return null;
    if (!(await resolvesPublic(new URL(current).hostname, lookup))) return null;
    let res: Response;
    try {
      res = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: { accept, "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      try {
        current = new URL(loc, current).href;
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").toLowerCase();
    const text = await readCapped(res, MAX_BYTES).catch(() => null);
    return text == null ? null : { url: current, type, text };
  }
  return null;
}

const isJsonType = (t: string) => t.includes("json");
const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

async function fetchActor(id: string, fetchImpl: FetchLike, lookup: Lookup) {
  const res = await safeFetch(id, AP_ACCEPT, fetchImpl, lookup);
  if (!res || !isJsonType(res.type)) return null;
  const actor = parseJson(res.text);
  // The actor document must really be the actor it claims to be (no cross-host substitution).
  return isActor(actor) &&
    normalizeHost(new URL(String(actor.id)).hostname) === normalizeHost(new URL(res.url).hostname)
    ? actor
    : null;
}

/** Path 1: the article's ActivityPub object names its author(s) in attributedTo. */
async function fromActivityPubObject(
  obj: unknown,
  articleUrl: string,
  fetchImpl: FetchLike,
  lookup: Lookup,
): Promise<FediAuthor[]> {
  if (!isArticleObject(obj)) return [];
  // Always the actor's own document, never the publisher's embedded copy (which could forge consent).
  const actors = await Promise.all(
    attributedActors(obj).map((id) => fetchActor(id, fetchImpl, lookup)),
  );
  return actors
    .filter((a): a is NonNullable<typeof a> => !!a && actorMayClaim(a, articleUrl))
    .map((a) => actorToAuthor(a, "activitypub"))
    .filter((a): a is FediAuthor => !!a);
}

/** Path 2: fediverse:creator → WebFinger → actor, credited only if the actor allows the article's domain. */
async function fromCreatorHandle(
  handle: string,
  articleUrl: string,
  fetchImpl: FetchLike,
  lookup: Lookup,
): Promise<FediAuthor | null> {
  const h = parseHandle(handle);
  if (!h) return null;
  const domain = h.split("@")[1];
  const wf = await safeFetch(
    `https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${h}`)}`,
    "application/jrd+json, application/json",
    fetchImpl,
    lookup,
  );
  const actorId = wf && isJsonType(wf.type) ? actorFromWebfinger(parseJson(wf.text)) : null;
  if (!actorId) return null;
  const actor = await fetchActor(actorId, fetchImpl, lookup);
  return actor && actorMayClaim(actor, articleUrl)
    ? actorToAuthor(actor, "fediverse-creator", h)
    : null;
}

/** Who wrote the article at `url`, best evidence first. Empty when nothing verifiable is found. */
export async function resolveArticleAuthors(
  url: string,
  fetchImpl: FetchLike = fetch,
  lookup: Lookup = dohLookup,
): Promise<FediAuthor[]> {
  if (!isPublicHttpsUrl(url)) return [];
  const page = await safeFetch(url, PAGE_ACCEPT, fetchImpl, lookup);
  if (!page) return [];
  // The article lives where the redirects ended; trust is judged against that host.
  const articleUrl = page.url;
  if (isJsonType(page.type))
    return (await fromActivityPubObject(parseJson(page.text), articleUrl, fetchImpl, lookup)).slice(
      0,
      MAX_AUTHORS,
    );
  if (!page.type.includes("html")) return [];
  const head = parseArticleHead(page.text, articleUrl);
  if (head.apAlternate) {
    const ap = await safeFetch(head.apAlternate, AP_ACCEPT, fetchImpl, lookup);
    if (ap && isJsonType(ap.type)) {
      const authors = await fromActivityPubObject(
        parseJson(ap.text),
        articleUrl,
        fetchImpl,
        lookup,
      );
      if (authors.length) return authors.slice(0, MAX_AUTHORS);
    }
  }
  const creators = await Promise.all(
    head.creators.map((h) => fromCreatorHandle(h, articleUrl, fetchImpl, lookup)),
  );
  return creators.filter((a): a is FediAuthor => !!a).slice(0, MAX_AUTHORS);
}

/* ── Cache (per isolate) and batch resolution with a shared deadline ─────────────────────────── */

const POSITIVE_TTL = 6 * 60 * 60_000;
const NEGATIVE_TTL = 60 * 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; authors: FediAuthor[] }>();

function cached(url: string): FediAuthor[] | undefined {
  const hit = cache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > (hit.authors.length ? POSITIVE_TTL : NEGATIVE_TTL)) {
    cache.delete(url);
    return undefined;
  }
  return hit.authors;
}
function remember(url: string, authors: FediAuthor[]) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(url, { at: Date.now(), authors });
}

/** Resolves many article URLs in parallel. Whatever isn't done by `budgetMs` comes back empty for this
 *  response; if the runtime lets it finish, it lands in the cache for the next one. */
export async function resolveAuthorsFor(
  urls: string[],
  budgetMs = 3000,
  fetchImpl: FetchLike = fetch,
  lookup: Lookup = dohLookup,
): Promise<Map<string, FediAuthor[]>> {
  const out = new Map<string, FediAuthor[]>();
  const pending: Promise<void>[] = [];
  for (const url of [...new Set(urls)].slice(0, 16)) {
    const hit = cached(url);
    if (hit) {
      out.set(url, hit);
      continue;
    }
    pending.push(
      resolveArticleAuthors(url, fetchImpl, lookup)
        .catch(() => [])
        .then((a) => {
          remember(url, a);
          out.set(url, a);
        }),
    );
  }
  await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, budgetMs))]);
  return out;
}

/** For tests. */
export function clearAuthorCache() {
  cache.clear();
  dnsCache.clear();
}
