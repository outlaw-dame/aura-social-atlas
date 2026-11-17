import framework7 from 'framework7/css/bundle?inline';
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
const ID = 'atlas-f7-styles';
let users = 0;

function ensure() {
  if (typeof document === 'undefined' || document.getElementById(ID)) return;
  const el = document.createElement('style');
  el.id = ID;
  el.textContent = `${framework7}\n${f7Icons}\n${materialIcons}`;
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
