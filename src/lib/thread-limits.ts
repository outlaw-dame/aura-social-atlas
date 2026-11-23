/**
 * The most replies Fedizen's /statuses/:id/context sends: bonfire_social `SocialMastoAdapter.descendant_reply_ids`
 * (d64795d, the commit v1.1.0-rc.1 pins) takes the oldest 80 under the post, with no paging. GraphQL `threadContext`
 * pages no further either, and in big threads keeps only the first 15 top-level branches, so conversations stay on
 * REST (docs/BONFIRE_GRAPHQL_CAPABILITY_MATRIX.md, roadmap 3).
 */
export const CONTEXT_REPLY_LIMIT = 80;
