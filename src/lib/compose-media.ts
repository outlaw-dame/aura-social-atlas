/**
 * Posting with media: limits, which files Fedizen takes, and the rules Atlas follows. Browser-safe and server-safe.
 *
 * Sources:
 * - Bonfire's Mastodon API: POST /api/v1/media and /api/v2/media (Bonfire.Files.Web.MastoMediaController →
 *   GraphQLMasto.Adapter.upload_media) take a multipart `file` and `description` (alt text), and answer the
 *   MediaAttachment synchronously; PUT /api/v1/media/:id changes the description.
 * - Bonfire.Files.ImageUploader allows image/png, jpeg, gif, svg+xml, tiff by default, 5 MB; VideoUploader video/mp4
 *   and video/webm, 20 MB (bonfire_files lib/definitions). Other types fall to DocumentUploader, which by default
 *   takes only PDFs. /api/v2/instance reports image_size_limit and video_size_limit (bonfire_api_graphql
 *   InstanceAdapter), which Atlas reads, so a server that raised them is honoured.
 * - Mastodon: at most 4 attachments shown on a post, and images or one video, not both
 *   (docs.joinmastodon.org/methods/statuses; app/services/post_status_service.rb). Atlas keeps to that so a post
 *   looks the same on Mastodon as on Fedizen. A content warning marks attached media sensitive
 *   (post_status_service.rb: `sensitive || spoiler_text.present?`).
 */

export const MAX_IMAGES = 4;
export const MAX_ALT = 1500;
export const MAX_CW = 500;
/** What Atlas sends as a post's text at most. Bonfire allows far more; 5000 keeps posts readable on Mastodon too. */
export const MAX_TEXT = 5000;

/** Files Atlas uploads as they are. Other images (HEIC, WebP, AVIF…) are converted to JPEG first. */
export const UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'] as const;
export const UPLOAD_VIDEO_TYPES = ['video/mp4', 'video/webm'] as const;
/** What the file picker offers: any image the browser can decode, and the video formats Fedizen takes. */
export const PICKER_ACCEPT = 'image/*,video/mp4,video/webm';

export type ComposeLimits = { imageBytes: number; videoBytes: number; maxChars: number };
/** Bonfire's defaults, used until the instance answers. */
export const DEFAULT_LIMITS: ComposeLimits = { imageBytes: 5_000_000, videoBytes: 20_000_000, maxChars: MAX_TEXT };
/** Hard ceiling for one upload through Atlas's server, whatever the instance says (a Worker holds it in memory). */
export const UPLOAD_CEILING = 40_000_000;

export const mediaKind = (type: string): 'image' | 'video' | null =>
  type.startsWith('image/') ? 'image' : (UPLOAD_VIDEO_TYPES as readonly string[]).includes(type) ? 'video' : null;

/** Whether one more file of this kind may join the attachments already chosen. Null when it may, else why not. */
export function canAdd(kinds: ('image' | 'video')[], next: 'image' | 'video'): string | null {
  if (next === 'video' && kinds.length) return 'A video goes in a post on its own.';
  if (kinds.includes('video')) return 'A post with a video can’t have other media.';
  if (kinds.length >= MAX_IMAGES) return `Up to ${MAX_IMAGES} images in a post.`;
  return null;
}

/** As Mastodon: a content warning on a post with media marks the media sensitive; otherwise the author's choice. */
export const effectiveSensitive = (cw: string, hasMedia: boolean, chosen: boolean) => hasMedia && (chosen || cw.trim().length > 0);

export const formatBytes = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
