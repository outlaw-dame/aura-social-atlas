# Spotlight and Link Conversations — source contract and demo gate

**Decision (2026-11-22): two independent features, shared link identity.** Atlas is a Bonfire client, tested against Fedizen. Fedizen is the social authority and determines its own federation horizon. Do **not** use mastodon.social as a global proxy for what the connected Bonfire instance knows. Do **not** modify Fedizen's database or assume remote instances expose their entire histories via ActivityPub.

## A. Spotlight: public content discovery

### What is actually implemented in this PR

- Replace hardcoded `mastodon.social/api/v1/trends/links` with Fedizen's **Mastodon-compatible public trending links** response. Request and response are fixed-origin, timeout-bounded, size-bounded, non-redirecting and never carry OAuth credentials or cookies.
- Fetch a limited sample from Fedizen's **public federated timeline**, explicitly reject all non-public status visibility, and surface attached videos as **recent videos**, not fabricated trends. This endpoint can be unavailable on a particular deployed Bonfire version; empty results are treated as unavailable, not proof there are no videos.
- Keep Bonfire's existing GraphQL **Articles feed** as **recent verified ActivityPub articles**. This is not a popularity signal.
- Use the existing guarded ActivityPub author/PodcastEpisode/PeerTube Video resolver to recognize podcasts/videos among linked public content. A generic audio attachment, a keyword, a video GIF, or a rich link preview is **not** sufficient to label a podcast.
- Keep provenance on each item: whether it is a Bonfire-federated source, **trending vs recent**, and **link vs Article vs PodcastEpisode vs Video**. Do not label the synthetic `history.accounts` from Bonfire's PreviewCard mapper as unique people talking. `uses` is displayed as **references**.
- Deduplicate already encountered equivalent https URLs with only safe removal of known tracker fields; don't merge arbitrary query strings, don't sum overlapping counts across instances, and don't invent worldwide coverage.
- No new crawler, search cluster, database, frontend session authority, server flag, or federation subscription is introduced.

**Provider compatibility:** Bonfire's source code contains `GET /api/v1/trends/links` but its installed implementation on Fedizen must be tested. Bonfire's preview-card mapper currently creates a single synthetic day of `history` and equates `accounts` to reference counts. The current controller slices by `offset` *after* requesting `limit` items; do not depend on offset pagination before checking it live.

**Scope constraint:** Fedizen's public REST trends and federated timeline are not complete copies of every instance with which Fedizen federates. They include content Fedizen has observed and exposes to that requester, subject to native visibility and filters. Remote Mastodon instance trending endpoints represent each remote instance's own observations; scanning arbitrary remote hosts is neither authorized nor a guarantee of Fedizen federation.

**Initial quality:** This PR is a **provider-sourced baseline**, not yet a comprehensive multi-provider recommendation algorithm. New features only display content when its classification is verifiable. No ranking promise beyond provider-selected trending and source-ordered recency is made. Later enhancements can introduce personalized relevance, source diversity, spam-resistant signals, and explicit `why this` explanations.

## B. Link Conversations: separate demo-first feature

**Status:** Concept and demo only; not connected to live GraphQL or an Atlas public post index by this PR. Its implementation must not become a dependency for Spotlight.

### Object model

- A **LinkHub** is a canonical URL key plus its safely verified publisher metadata. It can exist without trending and without having a single centralized social post.
- A **LinkReference** is one *public, discoverable* ActivityPub post that mentions the canonical URL. It has its own actor, canonical AP object ID, source instance, posting time, original root/thread ID when known, language, content warning, and verified visibility.
- A **DiscussionLane** is a separate real thread/reply tree rooted in one post (or a root inferred only if verifiably present). Multiple lanes belong to the LinkHub but are **never stitched together** into a fake single reply tree.
- A **FeaturedLane** is a ranked lane (by independently verifiable popularity/activity signals within the sampled corpus); the rest appear as independent contexts. A popularity tie should be stable. A high-boost post does not override source truth or permissions.
- A **source ledger** records where each post was seen, observations and cache times. Repeated observations of the same AP canonical ID must not count as different people or discussions.

### Wavelength + Phanpy-inspired demo behaviors

1. **Overview:** show article/episode/video preview with two distinct actions, `Open original` and `Read discussions`. A compact conversation inbox lists lanes, not giant flattened posts.
2. **Featured:** highlight the most active independent lane, explaining why it is featured (e.g. verified replies and boosts). It is not the original article's authoritative comment section.
3. **Focus:** select one lane to show its actual parent/reply structure with indents, Phanpy-style branch-collapse/context indicators and return navigation. The lane remains a coherent single thread.
4. **All discussions:** switch between **Featured**, **Recent**, and **Following** (when authenticated); sorting and user-follow relationships are computed only from information the provider actually supplies.
5. **Wavelength-like continuity:** an inbox of conversations around the shared link, quick return to the last focused lane, unread/updated indicators only if locally verified, and compact cross-lane previews. Don't merge isolated posts into a fake chat transcript.
6. **Accessibility:** keyboard selection and focus, labeled controls, screen-reader status for selection, reduced-motion behavior, and touch layout.

### Backend sequencing (after demo acceptance)

- Start with provider link-timeline REST where supported (Mastodon `GET /api/v1/timelines/link?url=`, restricted there to trending links), preserving the issuing host and its privacy policy.
- Fedizen's reviewed Bonfire Mastodon router does **not** expose that dedicated link-timeline endpoint. Do not quietly substitute a `GET /timelines/:feed` catchall or assume search by URL is complete.
- If necessary, extend Atlas's **existing** independent public-only Fedify gateway to index URL references at ingest: normalized_url / AP object_id / public visibility / root or reply relation / first+last seen, with a unique key on canonical AP ID and link key. This is a public index, NOT a shadow private social graph.
- Build a bounded read-only URL discussion API with pagination, filtering, deletion/update/Undo reconciliation, source failure isolation, provider permissions respected, dedup, anti-SSRF URL canonicalization, bounded payloads, and circuit/backoff controls.
- No private/restricted/DM/limited-audience post is admitted to the public index. **Public alone may be insufficient when the author opted out of discovery**; honor discoverability and moderation controls, and treat unknown visibility or discoverability as not indexed.
- Treat counts from different provider snapshots as overlapping estimates unless canonical actor IDs are explicitly deduplicated. If a precise distinct-person count is not provable, display `N posts indexed` or `Some discussions found`, never `N people are talking`.
- Never infer that a server we do not query has no conversations. Say `No indexed public discussions found`, not `Nobody is talking`.

### Acceptance and release gates

- [ ] Demo approved for all three reading modes and multiple independent lanes, including collapse/focus and keyboard/mobile behavior.
- [ ] Provider API contract tested on deployed Fedizen, including 200/401/403/404/429/5xx, unknown fields, missing history, pagination bounds, no private bearer in URL, and abort behavior.
- [ ] Confirm the server's federated public timeline and trending route actually serve public data; don't silently replace federation with a single remote mastodon.social instance.
- [ ] Content classification verified against Article, PodcastEpisode, PeerTube Video and false positives (generic MP3/GIF/thumbnail).
- [ ] Public-link index rejects followers-only, direct, group-limited, sensitive restricted, deleted and non-discoverable posts; tests include account blocks, deletion, edited URLs and federation replay.
- [ ] Same URL across three instances: canonical AP-ID dedup and accurate count labels. Cross-lane thread trees remain distinct.
- [ ] Load/latency/pagination, memory/resource limits, cache stampede, stale results, API errors and duplicate updates tested before production.
- [ ] Accessibility (phone, desktop, voiceover, keyboard, reduced motion) and author/creator attribution verified.
- [ ] No changes to `ATLAS_BONFIRE_NATIVE_GRAPHQL_READS` or current release security gates as part of these features.

## Architecture ownership and stopping point

- **Bonfire/Fedizen:** identity, public posts and their canonical audiences, own trend aggregation, native federation.
- **Atlas TanStack Start:** narrow server fetch/normalization and public UI, account-aware preferences when available, no private public cache.
- **Existing Fedify gateway:** optional public discovery index only after prototype approval and explicit acceptance tests.
- **Supabase:** Atlas session/preferences only; no new private mirrored post repository.

The first code gate should be merged only after targeted Bun tests, Node/Nitro staging build, reviews and source-scoped API checks pass. The first Link Conversations deliverable is an **interactive synthetic demo**, not an untested live data feature.
