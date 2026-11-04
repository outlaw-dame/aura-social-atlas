import { buildRelay, log, storesFor } from './app.ts';
import { parseConfig } from './policy.ts';

const cfg = parseConfig(process.env);
const { relay, handle } = buildRelay(cfg, await storesFor(cfg));

Bun.serve({ port: cfg.port, fetch: handle });
log('relay.started', {
  protocol: cfg.protocol, port: cfg.port,
  // Give these to instance admins; they come from the library, not hard-coded paths.
  subscribeWith: cfg.protocol === 'mastodon' ? (await relay.getSharedInboxUri()).href : (await relay.getActorUri()).href,
});
