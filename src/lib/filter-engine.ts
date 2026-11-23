import { applies, compileFilters, filtersVersion, hash, lexicalHits, postTags, postText, strongest, type ContentFilter, type FilterablePost, type FilterPlace, type FilterReason, type LexicalHit, type Verdict } from './content-filter';

/**
 * Applies keyword filters to the posts a feed shows. Browser-side, no React (ContentFilterProvider wires it up).
 *
 * - Keyword-only filters (or Intelligence off): a post is filtered at once when its words match.
 * - Filters checked in context: a post whose words match waits (hidden) until the AI model confirms or clears it,
 *   in batches of up to 16 posts. With deep matching on, every other public post is also checked, but stays visible
 *   meanwhile, so the feed never waits on the AI.
 * - Your own posts are never filtered. Direct messages are never sent to the AI; keywords alone decide for them.
 * - A filter applies only in its places and until it expires. One that skips people you follow waits for Fedizen to
 *   say whether you follow the author.
 * - If the AI can't answer, filters fall back to their words: nothing a keyword catches slips through.
 * - Verdicts are remembered per post text and filter version (memory, plus this tab's sessionStorage).
 * - With the semantic index on (`similar`), filters checked in context also catch posts close in meaning to the filter
 *   and its wordings, using none of its words. With an AI model too, those posts go to it to confirm, like the ones
 *   whose words match (and they stay visible meanwhile); without one, only a close match (`strong`) is filtered, and
 *   the notice says it was by meaning. Embeddings are compared on the device; with the on-device model nothing
 *   leaves it.
 */

export type Judge = (posts: { n: number; text: string; hashtags: string[]; candidates: string[] }[]) => Promise<{ n: number; matches: string[] }[] | null>;
/** Whether the person follows an account: true/false once known, undefined while asking. */
export type FollowLookup = { get(accountId: string): boolean | undefined; request(accountId: string): void };
/** For each post, the filters (checked in context) it's close to in meaning, and whether each is a close match. */
export type Similar = (posts: { n: number; id: string; text: string }[], filters: ContentFilter[]) => Promise<{ n: number; matches: { id: string; strong: boolean }[] }[] | null>;
export type EngineConfig = { filters: ContentFilter[]; ai: boolean; deep: boolean; judge?: Judge; similar?: Similar; following?: FollowLookup; scope?: string };

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
  private similar?: Similar;
  /** Semantic-index verdicts: filter ids each post is close to, and the close ones. */
  private near = new Map<string, { all: string[]; strong: string[] }>();
  private nearQueue = new Map<string, FilterablePost>();
  private nearBusy = false;
  private following?: FollowLookup;
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
    const version = filtersVersion(c.filters, `${c.ai}:${c.deep}:${c.similar ? 'near' : ''}:${c.scope ?? ''}`);
    this.judge = c.judge;
    this.similar = c.filters.some(f => f.semantic) ? c.similar : undefined;
    this.following = c.following;
    if (version === this.version) return;
    this.version = version;
    this.filters = c.filters;
    this.compiled = compileFilters(c.filters);
    this.byId = new Map(c.filters.map(f => [f.id, f]));
    this.ai = c.ai && c.filters.some(f => f.semantic);
    this.deep = c.deep;
    this.queue.clear();
    this.failed.clear();
    this.near.clear();
    this.nearQueue.clear();
    this.results = this.restore();
    this.emit();
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getRevision = () => this.revision;
  /** Something outside changed (who you follow, the time): evaluate again. */
  refresh() { this.emit(); }
  private emit() { this.revision++; for (const fn of this.listeners) fn(); }

  private key(p: FilterablePost) { return `${this.version}|${p.statusId ?? p.id}|${hash(postText(p))}`; }

  /** Filters that apply to this post here and now; undefined while it's unknown whether you follow its author. */
  private live(p: FilterablePost, place: FilterPlace): Set<string> | undefined {
    const now = Date.now(), out = new Set<string>();
    let unknown = false;
    for (const f of this.filters) {
      if (!applies(f, place, now)) continue;
      if (f.exceptFollowing && p.authorId) {
        const follows = this.following?.get(p.authorId);
        if (follows === undefined && this.following) { unknown = true; out.add(f.id); continue; }
        if (follows) continue;
      }
      out.add(f.id);
    }
    return unknown ? undefined : out;
  }

  /** Strict discovery must not flash a card while semantic checks are
   * pending. Unlike normal feeds, Spotlight contains no place to veil a post
   * and no preexisting relationship trust, so unknown means HIDE.
   */
  hasCurrentFilters(filters: ContentFilter[]): boolean { return this.filters === filters; }

  discoveryClear(p: FilterablePost, place: FilterPlace = 'public'): boolean {
    const applicable = this.filters.filter(f => applies(f, place));
    const semantic = applicable.filter(f => f.semantic);
    if (semantic.length) {
      const key = this.key(p);
      // No semantic provider? Do not silently degrade a promised semantic hide
      // into a plain keyword-only check for public recommendations.
      if (!this.similar && !this.ai) return false;
      if (this.similar && !this.near.has(key)) return false;
      const hits = lexicalHits(this.compiled, p);
      const nearMatches = this.near.get(key)?.all ?? [];
      const needsJudgment = this.ai && (this.deep || hits.some(h =>
        semantic.some(f => f.id === h.filterId)) || nearMatches.some(id => semantic.some(f => f.id === id)));
      if (needsJudgment && !this.results.has(key)) return false;
    }
    return this.evaluate(p, place).state === 'clear';
  }

  /** What the feed does with this post right now. Pure: call `request` (in an effect) to have the AI check it. */
  evaluate(p: FilterablePost, place: FilterPlace = 'home'): Verdict {
    if (!this.filters.length || p.mine) return { state: 'clear' };
    const known = this.live(p, place);
    const liveIds = known ?? new Set(this.filters.filter(f => applies(f, place)).map(f => f.id));
    const hits = lexicalHits(this.compiled, p).filter(h => liveIds.has(h.filterId));
    const usesAi = this.ai && p.visibility !== 'direct';
    // Close in meaning, with no AI model to confirm it: only a close match filters, said to be by meaning.
    const nearStrong = !usesAi && p.visibility !== 'direct' ? (this.near.get(this.key(p))?.strong ?? []).filter(id => liveIds.has(id) && !hits.some(h => h.filterId === id))
      .map((id): [ContentFilter, FilterReason] => [this.byId.get(id)!, { by: 'meaning' }]).filter(([f]) => !!f) : [];
    // A match on a filter that skips people you follow waits until Fedizen says whether you follow the author.
    if (!known && hits.some(h => this.byId.get(h.filterId)?.exceptFollowing)) return { state: 'pending' };
    const word = (h: LexicalHit): [ContentFilter, FilterReason] => [this.byId.get(h.filterId)!, { by: 'words', term: h.term }];
    const pick = (found: [ContentFilter, FilterReason][]): Verdict => {
      const f = strongest(found.map(x => x[0]));
      return f ? { state: 'filtered', action: f.action, filter: f, reason: found.find(x => x[0] === f)![1] } : { state: 'clear' };
    };
    if (!usesAi) return pick([...hits.map(word), ...nearStrong]);
    // Keyword-only filters decide at once; filters checked in context wait for the AI.
    const keywordOnly = hits.filter(h => !this.byId.get(h.filterId)!.semantic).map(word);
    const key = this.key(p);
    const judged = this.results.get(key);
    if (judged) {
      const byAi = judged.filter(id => liveIds.has(id)).map(id => this.byId.get(id)).filter((f): f is ContentFilter => !!f)
        .map((f): [ContentFilter, FilterReason] => { const h = hits.find(x => x.filterId === f.id); return [f, h ? { by: 'words', term: h.term } : { by: 'ai' }]; });
      return pick([...keywordOnly, ...byAi]);
    }
    const candidates = hits.filter(h => this.byId.get(h.filterId)!.semantic).map(word);
    if (this.failed.has(key)) return pick([...keywordOnly, ...candidates]);
    if (keywordOnly.some(([f]) => f.action === 'hide')) return pick(keywordOnly);
    return candidates.length ? { state: 'pending' } : pick(keywordOnly);
  }

  /** Queues the post for the AI when it needs checking, and asks whether you follow its author when a filter needs it. */
  request(p: FilterablePost, place: FilterPlace = 'home') {
    if (!this.filters.length || p.mine) return;
    if (this.similar && p.visibility !== 'direct') this.requestNear(p);
    if (p.authorId && this.following && this.filters.some(f => f.exceptFollowing && applies(f, place)) && this.following.get(p.authorId) === undefined) this.following.request(p.authorId);
    if (!this.ai || !this.judge || p.visibility === 'direct') return;
    const key = this.key(p);
    if (this.results.has(key) || this.failed.has(key) || this.queue.has(key) || this.inFlight.has(key)) return;
    const candidates = lexicalHits(this.compiled, p).map(h => h.filterId).filter(id => this.byId.get(id)?.semantic);
    if (!candidates.length && !this.deep) return;
    this.queue.set(key, { key, post: p, candidates });
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, DELAY);
  }

  /** Queues a post for the semantic index; with an AI model, posts it finds close go to the AI like word matches. */
  private requestNear(p: FilterablePost) {
    const key = this.key(p);
    if (this.near.has(key) || this.nearQueue.has(key)) return;
    this.nearQueue.set(key, p);
    if (!this.nearBusy) void this.flushNear();
  }

  private async flushNear() {
    const similar = this.similar, version = this.version;
    if (!similar) return;
    this.nearBusy = true;
    try {
      while (this.nearQueue.size) {
        await new Promise(r => setTimeout(r, DELAY));
        if (version !== this.version) return;
        const batch = [...this.nearQueue].slice(0, BATCH);
        batch.forEach(([k]) => this.nearQueue.delete(k));
        const semantic = this.filters.filter(f => f.semantic);
        let out: Awaited<ReturnType<Similar>> = null;
        try { out = await similar(batch.map(([, p], n) => ({ n, id: p.statusId ?? p.id, text: postText(p) })), semantic); } catch { out = null; }
        if (version !== this.version) return;
        const byN = new Map((out ?? []).map(v => [v.n, v.matches]));
        let changed = false;
        batch.forEach(([key, p], n) => {
          const m = byN.get(n);
          if (!m) return; // the engine failed: words (and the AI, if any) still apply
          this.near.set(key, { all: m.map(x => x.id), strong: m.filter(x => x.strong).map(x => x.id) });
          // A completed negative match must wake strict-discovery viewers too.
          changed = true;
          // With an AI model: posts close in meaning go to it, with those filters as candidates.
          if (this.ai && this.judge && m.length && !this.results.has(key) && !this.failed.has(key) && !this.inFlight.has(key)) {
            const lexical = lexicalHits(this.compiled, p).map(h => h.filterId).filter(id => this.byId.get(id)?.semantic);
            const prior = this.queue.get(key)?.candidates ?? lexical;
            this.queue.set(key, { key, post: p, candidates: [...new Set([...prior, ...m.map(x => x.id)])] });
            if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, DELAY);
          }
        });
        if (changed) this.emit();
      }
    } finally { this.nearBusy = false; }
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
