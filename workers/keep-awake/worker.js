/**
 * Keeps Atlas's staging server awake during the hours it's used.
 *
 * Railway App Sleeping puts atlas-web-staging to sleep 5–10 min after its last outbound traffic, and each wake took
 * 1–10 s. This Worker asks /api/health (which touches nothing else) every 4 minutes on the cron schedule in
 * wrangler.toml, 8 am–2 am New York time in winter (Cloudflare schedules run in UTC, so it's 9 am–3 am in summer).
 * Answering the ping is outbound traffic, so the server stays up; outside those hours it sleeps as before.
 * Cloudflare's free plan allows 5 cron triggers and 100,000 requests a day; this uses 1 trigger and ~270 requests.
 */
const TARGET = 'https://atlas-staging.damonoutlaw.xyz/api/health';

async function ping() {
  const started = Date.now();
  try {
    const r = await fetch(TARGET, { headers: { 'user-agent': 'atlas-keep-awake (Cloudflare Worker)' }, cf: { cacheTtl: 0 } });
    const body = await r.text();
    console.log('ping', r.status, `${Date.now() - started} ms`, body.slice(0, 80));
  } catch (e) {
    console.log('ping failed', `${Date.now() - started} ms`, String(e));
  }
}

export default {
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(ping());
  },
};
