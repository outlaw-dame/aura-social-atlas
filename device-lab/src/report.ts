/**
 * Tells the Lab bench what the app did with the device: the profile Atlas detected (src/lib/device-profile.ts, the
 * app's own code) and what Framework7 drew (theme, navigation, panes), read from the page itself, plus whether any
 * control sits on the fold. The bench compares these with what each device should get (its verification matrix).
 * Safe-area insets can't be simulated in a page (CSS env()), so they are reported as not simulated.
 */
import { describeProfile, detectProfile, readEnv } from '@/lib/device-profile';

type Rect = DOMRect;
const overlaps = (r: Rect, x0: number, y0: number, x1: number, y1: number) => Math.min(r.right, x1) - Math.max(r.left, x0) > 0.5 && Math.min(r.bottom, y1) - Math.max(r.top, y0) > 0.5;

function browserOf(ua: string) {
  if (/EdgA?\/|EdgiOS\//.test(ua)) return 'Edge';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/CriOS\/|Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

/** Controls a person taps, as drawn now (hidden and scrolled-away ones left out). */
function controls() {
  const W = innerWidth, H = innerHeight;
  const out: { r: Rect; label: string }[] = [];
  document.querySelectorAll<HTMLElement>('.navbar a, .navbar button, .atlas-tabbar a, .atlas-panel.panel-in-breakpoint a, .fab a, .fab button').forEach(el => {
    const tb = el.closest('.atlas-tabbar'); if (tb?.classList.contains('toolbar-hidden')) return;
    const page = el.closest('.page'); if (page && !page.classList.contains('page-current')) return;
    if (el.closest('.tab') && !el.closest('.tab-active')) return;
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || st.visibility === 'hidden' || st.display === 'none') return;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) return;
    out.push({ r, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) || 'control' });
  });
  return out;
}

function state(settled: boolean) {
  const env = readEnv(), p = detectProfile(env), html = document.documentElement;
  const panelHeld = !!document.querySelector('.atlas-panel.panel-in-breakpoint');
  const tb = document.querySelector<HTMLElement>('.atlas-tabbar');
  const tabShown = !!tb && !tb.classList.contains('toolbar-hidden');
  const deck = p.layout === 'tabletop' && html.dataset.nav === 'deck' && tabShown;
  const nav = panelHeld ? (html.classList.contains('atlas-rail') ? 'rail' : 'sidebar')
    : deck ? 'deck'
    : tabShown ? (tb!.getBoundingClientRect().height > tb!.getBoundingClientRect().width ? 'tabbar-side' : 'tabbar') : 'drawer';
  const d = document.querySelector<HTMLElement>('.atlas-discover.tab-active');
  const panes = !d ? html.dataset.panes : getComputedStyle(d).display !== 'grid' || !d.querySelector('.atlas-d-rail') ? 'single' : html.dataset.panes === 'fold' ? 'fold' : 'flat';
  const msg: Record<string, unknown> = {
    type: 'atlas-state',
    profile: { os: p.os, form: p.form, fold: p.fold, posture: p.posture, span: p.span, input: p.input, display: p.display, layout: p.layout, nav: p.nav, panes: p.panes, theme: p.theme, browser: browserOf(env.ua), width: p.width, height: p.height, name: describeProfile(p) },
    f7: { theme: html.classList.contains('md') ? 'md' : 'ios', nav, panes, deck, route: location.hash || '/' },
  };
  if (settled) {
    const foldHits: string[] = [];
    let split: number | null = null;
    if (p.segs && p.span !== 'none') {
      const [a, b] = p.segs, z = 12;
      controls().forEach(c => {
        const hit = p.span === 'columns' ? overlaps(c.r, a.x + a.width - z, 0, b.x + z, innerHeight) : overlaps(c.r, 0, a.y + a.height - z, innerWidth, b.y + z);
        if (hit) foldHits.push(c.label);
      });
      const main = d?.querySelector('.atlas-d-main'), rail = d?.querySelector('.atlas-d-rail');
      if (main && rail && p.span === 'columns') {
        const endGap = Math.round(main.getBoundingClientRect().right - (a.x + a.width));
        const railGap = Math.round(rail.getBoundingClientRect().left - b.x);
        split = Math.abs(endGap) > Math.abs(railGap) ? endGap : railGap;
      }
    }
    msg.checks = { insets: { top: 0, right: 0, bottom: 0, left: 0 }, insetsSimulated: false, insetHits: [], foldHits, splitOffset: split };
    msg.settled = true;
  }
  return msg;
}

function send(settled: boolean) { try { if (parent !== window) parent.postMessage(state(settled), '*'); } catch { /* the bench is gone */ } }

let timer = 0;
/** Reports now, and again once layout has settled (Framework7 applies the panel and tab bar a frame later). */
export function report() {
  send(false);
  clearTimeout(timer);
  timer = window.setTimeout(() => send(true), 600);
}

export function startReporting() {
  report();
  addEventListener('resize', report);
  // Navigation inside the app (tabs, pages) changes what's on screen.
  new MutationObserver(() => report()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-layout', 'data-nav', 'data-panes', 'class'] });
  document.addEventListener('click', () => setTimeout(report, 450), true);
}
