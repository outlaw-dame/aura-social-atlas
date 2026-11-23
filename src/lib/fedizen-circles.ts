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

/**
 * Names of Bonfire's per-account system rules (ACLs with `stereotype: true`, bonfire_boundaries 60fc2e7
 * runtime_config.ex). `boundaries.options` lists them as `custom: true` with the stereotype's name as their label (seen
 * live on Fedizen, 2026-11-22: "I may administer", "People I ghosted cannot see me"...), and nothing else in the answer
 * tells them apart from audiences the person made. They aren't audiences: "I may administer" would make a post only
 * its author can see. "Custom boundary" names the ACL Bonfire makes for a single post.
 */
export const BONFIRE_SYSTEM_RULES: ReadonlySet<string> = new Set([
  'people who i follow may read, interact, and reply',
  'custom boundary',
  'i may administer',
  'people i ghosted cannot see me',
  "people i silenced aren't discoverable by me",
  'people who silenced me cannot discover me',
].map(n => n.normalize('NFKC')));
const isSystemRule = (label: string) => BONFIRE_SYSTEM_RULES.has(label.normalize('NFKC').replace(/[’‘]/g, "'").toLowerCase());

/**
 * Bonfire's audience options, keeping only audiences the person made and named (presets are Atlas's own audiences
 * already; system rules are left out, see BONFIRE_SYSTEM_RULES).
 */
export function savedAudiences(options: unknown): FedizenAudience[] {
  const list = z.array(z.object({ id: z.string(), label: z.string().nullish(), description: z.string().nullish(), custom: z.boolean().nullish() }).passthrough()).catch([]).parse(options);
  const seen = new Set<string>();
  return list.flatMap(o => {
    const label = (o.label ?? '').trim();
    if (o.custom !== true || !/^[A-Za-z0-9_-]{1,64}$/.test(o.id) || !label || isSystemRule(label) || seen.has(o.id)) return [];
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
