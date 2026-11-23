import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { htmlThemeFor, parseThemeMode, resolveAppearance, THEME_BOOT_SCRIPT, type ThemeMode } from '../src/lib/theme-mode';

describe('color theme', () => {
  test('Match device picks Dim, not Dark, on a dark device', () => {
    expect(resolveAppearance('system', true)).toBe('dim');
    expect(resolveAppearance('system', false)).toBe('light');
    for (const m of ['light', 'dim', 'dark'] as const) for (const sys of [true, false]) expect(resolveAppearance(m, sys)).toBe(m);
  });

  test('Dim is dark mode plus data-theme="dim"; Dark carries no data-theme', () => {
    expect(htmlThemeFor('dim')).toEqual({ dark: true, dataTheme: 'dim', colorScheme: 'dark' });
    expect(htmlThemeFor('dark')).toEqual({ dark: true, dataTheme: null, colorScheme: 'dark' });
    expect(htmlThemeFor('light')).toEqual({ dark: false, dataTheme: null, colorScheme: 'light' });
  });

  test('stored and URL values: auto means Match device; anything else is ignored', () => {
    expect(parseThemeMode('auto')).toBe('system');
    expect(parseThemeMode('dim')).toBe('dim');
    for (const bad of [null, undefined, '', 'Dim', 'sepia', 'system ']) expect(parseThemeMode(bad)).toBeNull();
  });

  test('the boot script reaches the same result as the app, before React runs', () => {
    const run = (stored: string | null, url: string, systemDark: boolean) => {
      const classes = new Set<string>(), attrs: Record<string, string> = {}, style: Record<string, string> = {};
      const documentElement = { classList: { add: (c: string) => classes.add(c) }, setAttribute: (k: string, v: string) => { attrs[k] = v; }, style };
      new Function('location', 'localStorage', 'matchMedia', 'document', 'URLSearchParams', THEME_BOOT_SCRIPT)(
        { search: url }, { getItem: () => stored }, () => ({ matches: systemDark }), { documentElement }, URLSearchParams,
      );
      return { dark: classes.has('dark'), dataTheme: attrs['data-theme'] ?? null, colorScheme: style.colorScheme };
    };
    const cases: [string | null, string, boolean][] = [];
    for (const stored of [null, 'light', 'dim', 'dark', 'system', 'junk']) for (const url of ['', '?mode=dark', '?mode=auto', '?mode=nope']) for (const sys of [true, false]) cases.push([stored, url, sys]);
    for (const [stored, url, sys] of cases) {
      const mode: ThemeMode = parseThemeMode(new URLSearchParams(url).get('mode')) ?? parseThemeMode(stored) ?? 'light';
      expect(run(stored, url, sys)).toEqual(htmlThemeFor(resolveAppearance(mode, sys)));
    }
  });

  test('Dim text tokens meet WCAG AA (4.5:1) on every Dim surface', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const block = css.slice(css.indexOf(':root[data-theme="dim"]'));
    const token = (name: string) => block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))![1];
    const lum = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => p - q); return (y + 0.05) / (x + 0.05); };
    for (const fg of [token('--foreground'), token('--muted-foreground')])
      for (const bg of [token('--background'), token('--card'), token('--muted')]) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token('--primary-foreground'), token('--primary'))).toBeGreaterThanOrEqual(4.5);
  });
});
