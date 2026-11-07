/**
 * Resolves who wrote an article on the open web — server only. Trust and parsing rules are in article-author.ts.
 *
 * Fetching arbitrary article URLs is guarded: https only, public named hosts only (no IP literals or
 * internal names), every redirect hop re-validated (max 3), short timeouts, a response-size cap, no
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
  normalizeHost,
  parseArticleHead,
  parseHandle,
  type FediAuthor,
} from "./article-author";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const AP_ACCEPT =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';
const PAGE_ACCEPT = `${AP_ACCEPT};q=0.9, text/html;q=0.8`;
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 3500;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Atlas/1.0 (open-web author attribution)";

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
): Promise<Fetched | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicHttpsUrl(current)) return null;
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

async function fetchActor(id: string, fetchImpl: FetchLike) {
  const res = await safeFetch(id, AP_ACCEPT, fetchImpl);
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
): Promise<FediAuthor[]> {
  if (!isArticleObject(obj)) return [];
  const actors = await Promise.all(
    attributedActors(obj).map((a) =>
      typeof a === "string" ? fetchActor(a, fetchImpl) : Promise.resolve(isActor(a) ? a : null),
    ),
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
): Promise<FediAuthor | null> {
  const h = parseHandle(handle);
  if (!h) return null;
  const domain = h.split("@")[1];
  const wf = await safeFetch(
    `https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${h}`)}`,
    "application/jrd+json, application/json",
    fetchImpl,
  );
  const actorId = wf && isJsonType(wf.type) ? actorFromWebfinger(parseJson(wf.text)) : null;
  if (!actorId) return null;
  const actor = await fetchActor(actorId, fetchImpl);
  return actor && actorMayClaim(actor, articleUrl)
    ? actorToAuthor(actor, "fediverse-creator", h)
    : null;
}

/** Who wrote the article at `url`, best evidence first. Empty when nothing verifiable is found. */
export async function resolveArticleAuthors(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<FediAuthor[]> {
  if (!isPublicHttpsUrl(url)) return [];
  const page = await safeFetch(url, PAGE_ACCEPT, fetchImpl);
  if (!page) return [];
  // The article lives where the redirects ended; trust is judged against that host.
  const articleUrl = page.url;
  if (isJsonType(page.type))
    return (await fromActivityPubObject(parseJson(page.text), articleUrl, fetchImpl)).slice(
      0,
      MAX_AUTHORS,
    );
  if (!page.type.includes("html")) return [];
  const head = parseArticleHead(page.text, articleUrl);
  if (head.apAlternate) {
    const ap = await safeFetch(head.apAlternate, AP_ACCEPT, fetchImpl);
    if (ap && isJsonType(ap.type)) {
      const authors = await fromActivityPubObject(parseJson(ap.text), articleUrl, fetchImpl);
      if (authors.length) return authors.slice(0, MAX_AUTHORS);
    }
  }
  const creators = await Promise.all(
    head.creators.map((h) => fromCreatorHandle(h, articleUrl, fetchImpl)),
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
      resolveArticleAuthors(url, fetchImpl)
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
}
