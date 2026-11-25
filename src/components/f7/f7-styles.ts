// Framework7's core styles and those of the components the app uses (f7-modules.ts), not its whole bundle (570 KB).
import framework7 from 'framework7/css?inline';
import dialogCss from 'framework7/components/dialog/css?inline';
import popupCss from 'framework7/components/popup/css?inline';
import popoverCss from 'framework7/components/popover/css?inline';
import actionsCss from 'framework7/components/actions/css?inline';
import sheetCss from 'framework7/components/sheet/css?inline';
import toastCss from 'framework7/components/toast/css?inline';
import preloaderCss from 'framework7/components/preloader/css?inline';
import progressbarCss from 'framework7/components/progressbar/css?inline';
import tabsCss from 'framework7/components/tabs/css?inline';
import panelCss from 'framework7/components/panel/css?inline';
import cardCss from 'framework7/components/card/css?inline';
import chipCss from 'framework7/components/chip/css?inline';
import formCss from 'framework7/components/form/css?inline';
import inputCss from 'framework7/components/input/css?inline';
import checkboxCss from 'framework7/components/checkbox/css?inline';
import radioCss from 'framework7/components/radio/css?inline';
import toggleCss from 'framework7/components/toggle/css?inline';
import smartselectCss from 'framework7/components/smart-select/css?inline';
import gridCss from 'framework7/components/grid/css?inline';
import pulltorefreshCss from 'framework7/components/pull-to-refresh/css?inline';
import fabCss from 'framework7/components/fab/css?inline';
import searchbarCss from 'framework7/components/searchbar/css?inline';
import messagesCss from 'framework7/components/messages/css?inline';
import messagebarCss from 'framework7/components/messagebar/css?inline';
import typographyCss from 'framework7/components/typography/css?inline';
import f7Icons from 'framework7-icons/css/framework7-icons.css?inline';
import materialIcons from 'material-icons/iconfont/material-icons.css?inline';

/**
 * Framework7's stylesheets, present only while the phone app is on screen. Imported as plain `import '….css'`, they
 * were global: any page that pulled them in — a dev server that collects every route's CSS up front (Lovable's
 * preview does), or the desktop pages after visiting /app — got Framework7's unlayered element rules (`button
 * { width: 100% }` and the rest) over Tailwind's layered utilities, and lost their layout. As text (`?inline`) they
 * load nothing by themselves; the app adds them while it's mounted and takes them away after, appended last as a
 * separately loaded chunk's stylesheet would be.
 */
/** In the same order as F7_COMPONENTS (f7-modules.ts). */
export const F7_COMPONENT_STYLES = [dialogCss, popupCss, popoverCss, actionsCss, sheetCss, toastCss, preloaderCss, progressbarCss, tabsCss, panelCss, cardCss, chipCss, formCss, inputCss, checkboxCss, radioCss, toggleCss, smartselectCss, gridCss, pulltorefreshCss, fabCss, searchbarCss, messagesCss, messagebarCss, typographyCss];

const ID = 'atlas-f7-styles';
let users = 0;

function ensure() {
  if (typeof document === 'undefined' || document.getElementById(ID)) return;
  const el = document.createElement('style');
  el.id = ID;
  el.textContent = [framework7, ...F7_COMPONENT_STYLES, f7Icons, materialIcons].join('\n');
  document.head.appendChild(el);
}

/** Before the app first paints (this module is loaded only on the client, by the lazy /app route). */
ensure();

/** While mounted: Framework7's styles are on the page. Returns the clean-up. */
export function holdF7Styles(): () => void {
  users++;
  ensure();
  return () => {
    users = Math.max(0, users - 1);
    // Leave a frame for a remount (React StrictMode, a quick back-and-forth) before taking them away.
    requestAnimationFrame(() => { if (!users) document.getElementById(ID)?.remove(); });
  };
}
