import { z } from 'zod';
import { htmlToParagraphs } from './spotlight';

/**
 * The signed-in person's Fedizen profile as Atlas edits it: name, bio, website and location, Bonfire's `profile_input`.
 * Limits are Bonfire's own (bonfire_me Profiles.changeset): a name of 1 to 100 characters is required, a bio up to
 * 10,240. Website and location have no limit there; Atlas keeps them to what a profile line can show.
 */
export type FedizenProfile = { name: string; bio: string; website: string; location: string };

export const NAME_MAX = 100, BIO_MAX = 10_240, WEBSITE_MAX = 2048, LOCATION_MAX = 200;

const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const oneLine = (max: number) => z.string().trim().max(max).refine(v => !control.test(v) && !/[\r\n]/.test(v), 'one line');

export const profileInput = z.object({
  name: oneLine(NAME_MAX).pipe(z.string().min(1)),
  bio: z.string().trim().max(BIO_MAX).refine(v => !control.test(v), 'control characters'),
  website: oneLine(WEBSITE_MAX).refine(v => v === '' || isWebsite(v), 'website'),
  location: oneLine(LOCATION_MAX),
}).strict();

/** An http(s) address, written with or without its scheme ("example.org" counts, as Fedizen's own form takes it). */
export function isWebsite(value: string): boolean {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.') && !url.username && !url.password;
  } catch { return false; }
}

/**
 * A stored bio as text to edit. Bonfire links a saved bio's addresses, mentions and hashtags (as HTML or Markdown,
 * depending on the editor), so editing that as-is would wrap the links again on every save: Atlas shows the text
 * and Bonfire links it again when it's saved.
 */
export function bioAsText(summary: string | null | undefined): string {
  if (!summary) return '';
  // A Markdown autolink <address> first: it would otherwise look like a tag.
  const unwrapped = summary.replace(/<(https?:\/\/[^>\s]+)>/g, '$1');
  const html = /<\/?(?:p|br|a|span|div|strong|em|b|i|u|s|code|ul|ol|li|blockquote|h[1-6])\b[^>]*>/i.test(unwrapped);
  const text = html ? htmlToParagraphs(unwrapped).join('\n\n') : unwrapped;
  // Markdown links: [text](address) → text.
  return text.replace(/\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))+\)/g, '$1').trim();
}

const stored = z.object({
  name: z.string().max(10_000).nullish(),
  summary: z.string().max(200_000).nullish(),
  website: z.string().max(10_000).nullish(),
  location: z.string().max(10_000).nullish(),
});

/** Bonfire's profile as Atlas edits it. */
export function fromBonfireProfile(profile: unknown): FedizenProfile | null {
  const p = stored.safeParse(profile);
  if (!p.success) return null;
  return {
    name: (p.data.name ?? '').trim(),
    bio: bioAsText(p.data.summary),
    website: (p.data.website ?? '').trim(),
    location: (p.data.location ?? '').trim(),
  };
}
