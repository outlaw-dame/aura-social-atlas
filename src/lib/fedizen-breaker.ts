/**
 * When Fedizen stops answering (server only).
 *
 * On 24 Nov 2026, 16:12–16:17 UTC, every read Atlas sent to fedizen.net ran into fedizenGet's 10 s limit: Home,
 * notifications, conversations, blocks, lists. Each page waited the full 10 s per read, and Atlas kept adding
 * requests to a server that was already struggling. So, as a circuit breaker does:
 * - after BREAKER.timeouts reads time out within BREAKER.windowMs, Atlas stops sending reads for BREAKER.pauseMs and
 *   answers them at once as unreachable, so pages say Fedizen is slow straight away instead of after 10 s;
 * - when the pause ends, one read is let through to see whether Fedizen is back (the others still wait): an answer of
 *   any kind (even an error status) ends the pause, another timeout starts it again;
 * - the timeouts must be on at least two kinds of read (readRoute), so one heavy request that keeps timing out (a
 *   huge conversation, say) doesn't pause everyone's Home;
 * - only timeouts count: a refusal (4xx/5xx) or a rate limit is Fedizen answering, and has its own handling
 *   (fedizen-rate-limit.ts).
 * Atlas's server reaches Fedizen from one place, so this is shared by every account. Writes aren't held back: a
 * person's like or reply is still sent, and says if it failed.
 */

export const BREAKER = { timeouts: 3, routes: 2, windowMs: 20_000, pauseMs: 15_000 } as const;

let recent: { at: number; route: string }[] = [];
let pausedUntil = 0;
let probing = false;

/** Whether a read may be sent now. While paused, no; when the pause ends, one read goes through as a probe. */
export function mayAskFedizen(now = Date.now()): boolean {
  if (!pausedUntil) return true;
  if (now < pausedUntil || probing) return false;
  probing = true;
  return true;
}

/** Fedizen answered (any status): it's reachable again. */
export function noteFedizenAnswered() {
  recent = [];
  pausedUntil = 0;
  probing = false;
}

/** A read ran out of time. Returns true when this starts (or restarts) a pause, so the caller logs it once. */
export function noteFedizenTimeout(route: string, now = Date.now()): boolean {
  if (probing) {
    probing = false;
    pausedUntil = now + BREAKER.pauseMs;
    return true;
  }
  recent = [...recent.filter(t => now - t.at < BREAKER.windowMs), { at: now, route }];
  if (recent.length < BREAKER.timeouts || new Set(recent.map(t => t.route)).size < BREAKER.routes) return false;
  if (pausedUntil && now < pausedUntil) return false;
  recent = [];
  pausedUntil = now + BREAKER.pauseMs;
  return true;
}

/** A read failed some other way before Fedizen answered (DNS, TLS, refused connection): no verdict, but a probe is over. */
export function noteFedizenUnreached() {
  probing = false;
}

/** For tests. */
export function _resetBreaker() {
  recent = [];
  pausedUntil = 0;
  probing = false;
}
