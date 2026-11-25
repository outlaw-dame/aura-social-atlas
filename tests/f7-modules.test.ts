import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';

// Which framework7-react components and f7.* calls need which Framework7 component (beyond framework7/lite's core).
const NEEDS: Record<string, string | null> = {
  App: null, View: null, Views: null, Page: null, PageContent: null, Navbar: null, NavLeft: null, NavRight: null, NavTitle: null,
  Toolbar: null, Subnavbar: null, Link: null, Block: null, BlockTitle: null, BlockFooter: null, BlockHeader: null,
  List: null, ListItem: null, ListGroup: null, Button: null, Segmented: null, Icon: null, Badge: null, f7: null, f7ready: null,
  Panel: 'panel', Popup: 'popup', Sheet: 'sheet', Popover: 'popover', Actions: 'actions', ActionsGroup: 'actions', ActionsButton: 'actions', ActionsLabel: 'actions',
  Searchbar: 'searchbar', Toggle: 'toggle', ListInput: 'input', Card: 'card', CardContent: 'card', CardFooter: 'card', CardHeader: 'card',
  Fab: 'fab', FabButtons: 'fab', FabButton: 'fab', Preloader: 'preloader', Progressbar: 'progressbar', Tabs: 'tabs', Tab: 'tabs', Chip: 'chip', Messages: 'messages', Message: 'messages', Messagebar: 'messagebar',
};
const F7_CALLS: Record<string, string | null> = { toolbar: null, navbar: null, views: null, statusbar: null, dialog: 'dialog', toast: 'toast', actions: 'actions', panel: 'panel', popup: 'popup', sheet: 'sheet', popover: 'popover', tab: 'tabs', searchbar: 'searchbar' };

const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
const src = files('src').map(f => readFileSync(f, 'utf8')).join('\n');

describe('the phone app loads only the Framework7 components it uses', () => {
  const modules = readFileSync('src/components/f7/f7-modules.ts', 'utf8');
  const styles = readFileSync('src/components/f7/f7-styles.ts', 'utf8');
  const registered = [...modules.matchAll(/from 'framework7\/components\/([a-z-]+)'/g)].map(m => m[1]);
  const styled = [...styles.matchAll(/from 'framework7\/components\/([a-z-]+)\/css\?inline'/g)].map(m => m[1]);

  test('core + the listed components, never the whole bundle', () => {
    expect(modules).toMatch(/import Framework7 from 'framework7\/lite';/);
    expect(src).not.toMatch(/framework7\/lite-bundle'|framework7\/bundle'|framework7\/css\/bundle/);
    expect(readFileSync('src/components/f7/AtlasMobileApp.tsx', 'utf8')).toMatch(/framework7WithComponents\(\)\.use\(Framework7React\);/);
  });

  test('every component has its styles, in the same order', () => {
    expect(styled).toEqual(registered);
  });

  test('every framework7-react component and f7.* call the app uses is covered', () => {
    const used = new Set([...src.matchAll(/import \{([^}]+)\} from 'framework7-react'/g)].flatMap(m => m[1].split(',').map(s => s.replace(/\btype\b/, '').trim()).filter(Boolean)));
    for (const name of used) {
      expect(name in NEEDS ? true : `unknown framework7-react component ${name}: add it to NEEDS and, if it needs one, to f7-modules.ts`).toBe(true);
      const need = NEEDS[name];
      if (need) expect(registered).toContain(need);
    }
    for (const [, call] of src.matchAll(/\bf7\.([a-zA-Z]+)\.(?:create|open|close|get|show|alert|confirm|prompt)\(/g)) {
      expect(call in F7_CALLS ? true : `f7.${call} isn't mapped: add it to F7_CALLS and f7-modules.ts`).toBe(true);
      if (F7_CALLS[call]) expect(registered).toContain(F7_CALLS[call]);
    }
    if (/\bptr\b/.test(src)) expect(registered).toContain('pull-to-refresh');
    if (/\bsmartSelect\b/.test(src)) { expect(registered).toContain('smart-select'); expect(registered).toContain('popover'); }
    if (/className="[^"]*\bgrid-cols-/.test(src)) expect(registered).toContain('grid');
  });
});
