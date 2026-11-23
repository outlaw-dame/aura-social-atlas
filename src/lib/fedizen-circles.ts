import { z } from 'zod';

/** Circle names: Atlas's own limit, as for REST lists. Descriptions: Atlas's limit (Bonfire stores them as extra_info). */
export const CIRCLE_NAME_MAX = 100;
export const CIRCLE_SUMMARY_MAX = 500;

export type FedizenCircleInfo = { id: string; title: string; summary?: string };
/** One of the person's saved audiences on Fedizen (a named custom boundary). */
export type FedizenAudience = { id: string; label: string; description?: string };

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const text = (max: number) => z.string().max(max).nullish().transform(v => (v ?? '').trim());

export const circleSchema = z.object({ id, name: text(CIRCLE_NAME_MAX * 4), summary: text(CIRCLE_SUMMARY_MAX * 8) })
  .transform(c => ({ id: c.id, title: c.name.slice(0, CIRCLE_NAME_MAX) || 'Untitled circle', ...(c.summary ? { summary: c.summary.slice(0, CIRCLE_SUMMARY_MAX) } : {}) }));

/** Bonfire's audience options, keeping only the person's own named ones (presets are Atlas's own audiences already). */
export function savedAudiences(options: unknown): FedizenAudience[] {
  const list = z.array(z.object({ id: z.string(), label: z.string().nullish(), description: z.string().nullish(), custom: z.boolean().nullish() }).passthrough()).catch([]).parse(options);
  const seen = new Set<string>();
  return list.flatMap(o => {
    const label = (o.label ?? '').trim();
    if (o.custom !== true || !/^[A-Za-z0-9_-]{1,64}$/.test(o.id) || !label || seen.has(o.id)) return [];
    seen.add(o.id);
    const description = (o.description ?? '').trim();
    return [{ id: o.id, label: label.slice(0, 100), ...(description ? { description: description.slice(0, 280) } : {}) }];
  });
}

/** Ids of the people among `ids` who follow you, from Fedizen's relationships (`followed_by`). */
export function followersAmong(relationships: unknown, ids: string[]): string[] {
  const rows = z.array(z.object({ id: z.string(), followed_by: z.boolean().nullish() }).passthrough()).catch([]).parse(relationships);
  const wanted = new Set(ids);
  return rows.filter(r => r.followed_by === true && wanted.has(r.id)).map(r => r.id);
}

/**
 * What a circle post reaches, said on the circle's page. On Fedizen only members who follow you get circle posts
 * (bonfire_federate_activitypub e5489e3 `external_recipients_for_object`; locally, Home shows the people you follow).
 * `followers` is null when it couldn't be read.
 */
export function circleReach(members: number, followers: number | null): string | null {
  if (members <= 0) return null;
  if (followers === null) return 'Fedizen sends circle posts only to members who follow you.';
  if (followers >= members) return members === 1 ? 'They follow you, so your circle posts reach them.' : `All ${members} follow you, so your circle posts reach everyone here.`;
  if (followers === 0) return members === 1 ? 'They don’t follow you, so your circle posts won’t reach them. Fedizen sends circle posts only to members who follow you.' : `None of them follow you, so your circle posts won’t reach anyone here. Fedizen sends circle posts only to members who follow you.`;
  return `${followers} of ${members} follow you. Fedizen sends circle posts only to members who follow you.`;
}
