/**
 * The Framework7 components the phone app uses, on top of Framework7's core (framework7/lite: app, statusbar, view,
 * navbar, toolbar, subnavbar, touch ripple and highlight, modal). The app used to load framework7/lite-bundle, which
 * registers about 50 components (photo browser, calendar, colour picker, text editor, swiper with its 183 KB library,
 * data tables…) Atlas never shows. Messages and Messagebar are here for the Assistant popup (F7Extras.tsx). Their styles come with them (f7-styles.ts imports the same list, in the bundle's order).
 *
 * Adding a Framework7 component to the app (a framework7-react component, an f7.<component> call, or its CSS classes):
 * add it to F7_COMPONENTS here and to F7_COMPONENT_STYLES in f7-styles.ts; tests/f7-modules.test.ts checks they agree
 * and that every framework7-react component the app imports is covered.
 */
import Framework7 from 'framework7/lite';
import Dialog from 'framework7/components/dialog';
import Popup from 'framework7/components/popup';
import Popover from 'framework7/components/popover';
import Actions from 'framework7/components/actions';
import Sheet from 'framework7/components/sheet';
import Toast from 'framework7/components/toast';
import Preloader from 'framework7/components/preloader';
import Progressbar from 'framework7/components/progressbar';
import Tabs from 'framework7/components/tabs';
import Panel from 'framework7/components/panel';
import Card from 'framework7/components/card';
import Chip from 'framework7/components/chip';
import Form from 'framework7/components/form';
import Input from 'framework7/components/input';
import Checkbox from 'framework7/components/checkbox';
import Radio from 'framework7/components/radio';
import Toggle from 'framework7/components/toggle';
import SmartSelect from 'framework7/components/smart-select';
import Grid from 'framework7/components/grid';
import PullToRefresh from 'framework7/components/pull-to-refresh';
import Fab from 'framework7/components/fab';
import Searchbar from 'framework7/components/searchbar';
import Messages from 'framework7/components/messages';
import Messagebar from 'framework7/components/messagebar';
import Typography from 'framework7/components/typography';

export const F7_COMPONENTS = { 'dialog': Dialog, 'popup': Popup, 'popover': Popover, 'actions': Actions, 'sheet': Sheet, 'toast': Toast, 'preloader': Preloader, 'progressbar': Progressbar, 'tabs': Tabs, 'panel': Panel, 'card': Card, 'chip': Chip, 'form': Form, 'input': Input, 'checkbox': Checkbox, 'radio': Radio, 'toggle': Toggle, 'smart-select': SmartSelect, 'grid': Grid, 'pull-to-refresh': PullToRefresh, 'fab': Fab, 'searchbar': Searchbar, 'messages': Messages, 'messagebar': Messagebar, 'typography': Typography } as const;

let registered = false;
/** Framework7 with the app's components registered. A call, not an import side effect, so the bundler can't drop it. */
export function framework7WithComponents(): typeof Framework7 {
  if (!registered) {
    // Framework7's plugin installer, not a React hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    Framework7.use(Object.values(F7_COMPONENTS));
    registered = true;
  }
  return Framework7;
}
