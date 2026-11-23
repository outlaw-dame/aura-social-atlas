# Spotlight reliability: empty Bonfire trends and personalization safety

**Checkpoint:** November 22, 2026 (America/New_York). This document distinguishes live observations from hypotheses about Bonfire's internals.

## 1. What is verified

- Read-only GitHub Actions probe against `https://fedizen.net/api/v1/trends/links?limit=12` received **HTTP 200** with **zero preview cards**, while unauthenticated `GET /api/v1/timelines/public?limit=30` received **401**. Endpoint existence is proven; populated trend generation is **not** proven.
- Bonfire `bonfire_api_graphql` Mastodon router maps `GET /api/v1/trends/links` to `Bonfire.Social.Web.MastoTrendsController.links`. Its controller delegates to `Bonfire.Social.Media.trending_links(limit: limit)`, then maps results to preview cards.
- In the inspected `bonfire_social` main source, the named `trending_links` feed preset is **commented out** in `lib/runtime_config.ex`; `Bonfire.Social.Media.list_trending_paginated` still calls `Bonfire.Social.FeedLoader.feed(:trending_links, ...)`. FeedLoader resolves named presets, and not-found names may fall back to custom defaults; therefore the missing preset is a plausible root cause. **Do not call this proven on Fedizen**, which runs a different pinned Bonfire release and may have instance-specific presets.
- The same Media implementation catches exceptions and returns `[]`, so an exception is indistinguishable from no qualifying links at the API boundary.
- The default aggregation window is two days and cache TTL one hour. Sparse recent traffic, missing URL/media associations, an empty cache, or feed source/config problems can all yield `[]`.
- Bonfire's `PreviewCard` mapper emits a synthetic history entry and equates `accounts` and `uses` to reference count, not distinct people. Never label this “N people discussing.”
- The current Bonfire trending-links tests in `bonfire_social/test/media/trending_links_test.exs` carry `@moduletag :todo`, so the test source alone does not prove this path runs on current CI.
- We cannot access Fedizen's Bonfire release container logs or PostgreSQL through the Atlas GitHub/Railway integrations: Fedizen is hosted separately on Co-op Cloud. **Do not create an Atlas workaround that bypasses Bonfire moderation just to fill empty trend cards.**

## 2. Read-only upstream diagnosis, for an authorized Fedizen/Co-op Cloud operator

Within the actual Fedizen release (or a matching disposable clone), confirm:

1. Installed Bonfire version and module configuration (avoid assuming `main` matches). Is the `:trending_links` feed preset registered and permitted, and does its filter have `media_types` and `sort_by` as intended?
2. Is `Bonfire.Social.Media.list_trending_paginated(limit: 12)` returning `{:error, ...}`, a page of activity edges, or a page of actual media edges? Verify shape, **counts only**, not private post content.
3. Use `Bonfire.Social.Media.trending_links(limit: 12, cache: :refresh)` as a cache-refresh diagnostic (not a database mutation). Compare counts with the default cached result. If refresh returns cards and default does not, investigate cache warming/invalidation.
4. Check the difference between two-day and seven-day lookback; if only the latter returns links, low recent volume may be the cause.
5. Confirm the Files/Media association and content-type filters for recent publicly shared HTTP links, whether remote ActivityPub statuses populate the media index, and how `per_media` aggregation is configured; do this with bounded aggregate counts only.
6. Examine application logs for the `Error fetching trending links` rescue. Never copy raw post bodies, bearer secrets, or SQL parameters involving private account identities.
7. Where `[]` follows a rescued error, preserve an internal error diagnostic for admins and distinct monitoring states; the public endpoint may still return `[]` for truly empty results.
8. Run the tagged/disabled unit tests with the deployed version's actual media schema and verify the missing-preset path. Propose an upstream fix in Bonfire before adding duplicate aggregation machinery to Atlas.

If a public endpoint alone is tested, neither successful cache refresh nor audience filtering can be inferred.

## 3. Atlas behavior and privacy gate

Before this security PR, Spotlight bypassed `ContentFilterProvider` and never checked the reader's block/mute lists. A shared public response is **not** a user-personalized recommendation.

This PR:
- Reuses the reader's existing **Atlas** plain-word/phrase/hashtag/topic filters, semantic similarity and contextual Intelligence judgment in the `public` context; pending/failed semantic evidence cannot cause a preview flash.
- Enforces complete, owner-scoped Bonfire **blocks and mutes**; a partial/malformed/refused list fails closed. Reuses the established `fedizenGet` authorization, rate-limit and bounded response transport.
- Retains an authenticated PUBLIC source-post identity ledger; rejects unknown contributors and posts from blocked/muted actors, including within multi-source card groups.
- Maintains publisher byline distinct from actors actually sharing a URL, and suppresses publisher-account attribution when blocked or muted.
- Limits remote actors until native Bonfire **blocked-instance** information can be queried securely. The current reviewed router has no `GET /api/v1/domain_blocks`; pretending its absence means zero blocks is not allowed.
- Maintains separate user query keys for owner-specific reads, short freshness windows and invalidation when Atlas itself blocks/unblocks.

Limitations:
- The Bonfire-native keyword filter list is not exported by the reviewed Mastodon-compatible filter endpoint (it returns an empty stub). Atlas's own keyword/semantic rules apply; users who set a rule only on Fedizen may need an authenticated native API or import/sync route in a later release. Do not claim existing native filters are synchronized.
- There is no authoritative remote domain-block listing. Remote actor discoverability is **intentionally reduced**, not “fully supported.”
- A link's source ledger is bounded by the posts observed on Fedizen; we do not claim all federation-wide sharers are known.
- “Warn” and “Blur” rules are conservatively withheld from Spotlight until a safe explicit reveal UI exists. This is stronger than the feed behavior, and it must not be misrepresented as a precise semantic warning presentation.

## 4. Release checklist

- [ ] PR CI: targeted moderation/semantic/federated regression tests, full Atlas typecheck, Node staging build, gateway no-drift checks.
- [ ] Exact-head review and source provenance audit.
- [ ] Consent-based live Atlas staging: blocked actor, muted actor, blocked+muted, semantic/keyword filter, local and remote actor, updated rules, signout/account change.
- [ ] Verify native Fedizen instance-block read path or keep remote content held. Do not silently bypass.
- [ ] Verify account-scoped caching does not re-show a block after mutation or a session switch.
- [ ] Bonfire upstream diagnosis completed and observed trend count distinguishes zero actual candidates from error/cache/configuration states.
- [ ] Do not promote closed native GraphQL permission/release flags due to this PR.

## Sources (source code first)

- [Bonfire trends REST controller](https://github.com/bonfire-networks/bonfire_social/blob/main/lib/api/masto_trends_controller.ex)
- [Bonfire media/trend aggregation](https://github.com/bonfire-networks/bonfire_social/blob/main/lib/media.ex)
- [Bonfire feed presets](https://github.com/bonfire-networks/bonfire_social/blob/main/lib/runtime_config.ex)
- [Bonfire feed loader](https://github.com/bonfire-networks/bonfire_social/blob/main/lib/feeds/feed_loader.ex)
- [Bonfire preview-card mapper](https://github.com/bonfire-networks/bonfire_api_graphql/blob/main/lib/mastodon_compat/mappers/preview_card.ex)
- [Bonfire Mastodon REST router](https://github.com/bonfire-networks/bonfire_api_graphql/blob/main/lib/web/masto_compatible_router.ex)
- [Mastodon API filtering guidelines](https://github.com/mastodon/documentation/blob/main/content/en/api/guidelines.md)
- [Atlas Spotlight design and privacy contract](./SPOTLIGHT_LINK_CONVERSATIONS.md)
