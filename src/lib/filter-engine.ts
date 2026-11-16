import { compileFilters, filtersVersion, hash, lexicalHits, postTags, postText, strongest, type ContentFilter, type FilterablePost, type LexicalHit, type Verdict } from './content-filter';

/**
 * Applies keyword filters to the posts a feed shows. Browser-side, no React (FilterProvider wires it up).
 *
 * - Keyword-only filters (or Intelligence off): a post is filtered at once when its words match.
 * - Filters checked in context: a post whose words match waits (hidden) until the AI model confirms or clears it,
 *   in batches of up to 16 posts. With deep matching on, every other public post is also checked, but stays visible
 *   meanwhile, so the feed never waits on the AI.
 * - Direct messages are never sent to the AI; keywords alone decide for them.
 * - If the AI can't answer, filters fall back to their words: nothing a keyword catches slips through.
 * - Verdicts are remembered per post text and filter version (memory, plus this tab's sessionStorage).
 */

export type Judge = (posts: { n: number; text: string; hashtags: string[]; candidates: string[] }[]) => Promise<{ n: number; matches: string[] }[] | null>;
export type EngineConfig = { filters: ContentFilter[]; ai: boolean; deep: boolean; judge?: Judge; scope?: string };

type Pending = { key: string; post: FilterablePost; candidates: string[] };

const BATCH = 16, DELAY = 120, CACHE_MAX = 3000;
const STORE = 'atlas-filter-verdicts';

export class FilterEngine {
  private filters: ContentFilter[] = [];
  private compiled: ReturnType<typeof compileFilters> = [];
  private byId = new Map<string, ContentFilter>();
  private ai = false;
  private deep = false;
  private judge?: Judge;
  private version = '';
  /** AI verdicts: filter ids each post matches, by cache key. */
  private results = new Map<string, string[]>();
  private failed = new Set<string>();
  private queue = new Map<string, Pending>();
  private inFlight = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  revision = 0;
  /** The last time the AI couldn't answer, for a quiet note in settings. */
  lastError: string | null = null;

  configure(c: EngineConfig) {
    const version = filtersVersion(c.filters, `${c.ai}:${c.deep}:${c.scope ?? ''}`);
    this.judge = c.judge;
    if (version === this.version) return;
    this.version = version;
    this.filters = c.filters;
    this.compiled = compileFilters(c.filters);
    this.byId = new Map(c.filters.map(f => [f.id, f]));
    this.ai = c.ai && c.filters.some(f => f.semantic);
    this.deep = c.deep;
    this.queue.clear();
    this.failed.clear();
    this.results = this.restore();
    this.emit();
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getRevision = () => this.revision;
  private emit() { this.revision++; for (const fn of this.listeners) fn(); }

  private key(p: FilterablePost) { return `${this.version}|${p.statusId ?? p.id}|${hash(postText(p))}`; }

  /** What the feed does with this post right now. Pure: call `request` (in an effect) to have the AI check it. */
  evaluate(p: FilterablePost): Verdict {
    if (!this.filters.length) return { state: 'clear' };
    const hits = lexicalHits(this.compiled, p);
    const plain = (h: LexicalHit[]) => h.map(x => this.byId.get(x.filterId)!).filter(Boolean);
    const filtered = (fs: ContentFilter[]): Verdict => { const f = strongest(fs); return f ? { state: 'filtered', action: f.action, filter: f } : { state: 'clear' }; };
    const usesAi = this.ai && p.visibility !== 'direct';
    if (!usesAi) return filtered(plain(hits));
    // Keyword-only filters decide at once; filters checked in context wait for the AI.
    const keywordOnly = plain(hits).filter(f => !f.semantic);
    const key = this.key(p);
    const judged = this.results.get(key);
    if (judged) return filtered([...keywordOnly, ...judged.map(id => this.byId.get(id)).filter((f): f is ContentFilter => !!f)]);
    const candidates = plain(hits).filter(f => f.semantic);
    if (this.failed.has(key)) return filtered([...keywordOnly, ...candidates]);
    if (keywordOnly.length && keywordOnly.some(f => f.action === 'hide')) return filtered(keywordOnly);
    return candidates.length ? { state: 'pending' } : filtered(keywordOnly);
  }

  /** Queues the post for the AI when it needs checking (words matched a filter, or deep matching is on). */
  request(p: FilterablePost) {
    if (!this.ai || !this.judge || p.visibility === 'direct') return;
    const key = this.key(p);
    if (this.results.has(key) || this.failed.has(key) || this.queue.has(key) || this.inFlight.has(key)) return;
    const candidates = lexicalHits(this.compiled, p).map(h => h.filterId).filter(id => this.byId.get(id)?.semantic);
    if (!candidates.length && !this.deep) return;
    this.queue.set(key, { key, post: p, candidates });
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, DELAY);
  }

  private async flush() {
    const judge = this.judge, version = this.version;
    if (!judge) return;
    // Posts whose words matched first: they're the ones hidden while waiting.
    const all = [...this.queue.values()].sort((a, b) => b.candidates.length - a.candidates.length);
    this.queue.clear();
    for (let i = 0; i < all.length; i += BATCH) {
      const batch = all.slice(i, i + BATCH);
      batch.forEach(b => this.inFlight.add(b.key));
      let verdicts: { n: number; matches: string[] }[] | null = null;
      try {
        verdicts = await judge(batch.map((b, n) => ({ n, text: postText(b.post), hashtags: postTags(b.post).slice(0, 30), candidates: b.candidates })));
      } catch {
        verdicts = null;
      }
      batch.forEach(b => this.inFlight.delete(b.key));
      if (version !== this.version) return;
      if (!verdicts) {
        this.lastError = 'The AI service didn’t answer; filters are matching words only for now.';
        batch.forEach(b => this.failed.add(b.key));
      } else {
        this.lastError = null;
        const byN = new Map(verdicts.map(v => [v.n, v.matches]));
        batch.forEach((b, n) => this.results.set(b.key, byN.get(n) ?? []));
        this.persist();
      }
      this.emit();
    }
  }

  private restore(): Map<string, string[]> {
    try {
      const raw = sessionStorage.getItem(STORE);
      const entries = raw ? (JSON.parse(raw) as [string, string[]][]) : [];
      return new Map(entries.filter(([k]) => k.startsWith(`${this.version}|`)));
    } catch {
      return new Map();
    }
  }

  private persist() {
    while (this.results.size > CACHE_MAX) this.results.delete(this.results.keys().next().value as string);
    try { sessionStorage.setItem(STORE, JSON.stringify([...this.results])); } catch { /* storage full or blocked: memory still works */ }
  }
}
