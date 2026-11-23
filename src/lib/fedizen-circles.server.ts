import { z } from 'zod';
import { requestBonfireGraphQL } from './bonfire-graphql.server';
import { CREATE_CIRCLE_DOCUMENT, MY_CIRCLES_DOCUMENT, POST_AUDIENCES_DOCUMENT, UPDATE_CIRCLE_DOCUMENT } from './bonfire/graphql/operations';
import { circleSchema, savedAudiences, type FedizenAudience, type FedizenCircleInfo } from './fedizen-circles';

/** Your circles with descriptions (GraphQL `myCircles`). */
export function readMyCircles(accessToken: string): Promise<FedizenCircleInfo[]> {
  return requestBonfireGraphQL({
    operation: 'query', document: MY_CIRCLES_DOCUMENT, accessToken,
    validate: d => z.object({ myCircles: z.array(z.unknown()).max(500).nullable() }).parse(d).myCircles?.flatMap(c => {
      const r = circleSchema.safeParse(c);
      return r.success ? [r.data] : [];
    }) ?? [],
  });
}

/** Creates a circle, or renames it and sets its description (always both: see UPDATE_CIRCLE_DOCUMENT). Never retried. */
export function saveCircle(accessToken: string, input: { id?: string; title: string; summary: string }): Promise<FedizenCircleInfo> {
  const circle = { name: input.title, summary: input.summary };
  return requestBonfireGraphQL({
    operation: 'mutation', accessToken,
    document: input.id ? UPDATE_CIRCLE_DOCUMENT : CREATE_CIRCLE_DOCUMENT,
    variables: input.id ? { id: input.id, circle } : { circle },
    validate: d => {
      const raw = (d as { createCircle?: unknown; updateCircle?: unknown })?.[input.id ? 'updateCircle' : 'createCircle'];
      const saved = circleSchema.parse(raw);
      if (input.id && saved.id !== input.id) throw new Error('Fedizen answered about another circle.');
      return saved;
    },
  });
}

/** Your saved audiences on Fedizen (`boundaries.options`, custom ones only). */
export function readMyAudiences(accessToken: string): Promise<FedizenAudience[]> {
  return requestBonfireGraphQL({
    operation: 'query', document: POST_AUDIENCES_DOCUMENT, accessToken,
    validate: d => savedAudiences(z.object({ boundaries: z.object({ options: z.unknown() }).nullable() }).parse(d).boundaries?.options),
  });
}
