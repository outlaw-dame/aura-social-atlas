# Device Lab

The Device Lab runs Atlas's real phone app (`src/components/f7/AtlasMobileApp.tsx`, the `/app` route) as a
static page on sample data. A bench around it simulates devices (iPhone, iPhone Duo folded and open, iPad, Android
phones, foldables and tablets, desktop). It is published as the "Atlas Device Lab" artifact. Nothing in `src/` changes
for it, so the Lab can't drift from the app: rebuild it from `main` and it is the app as it stands.

```sh
bun run lab:dev     # the app on sample data at http://localhost:5173/app.html?p=iphone&o=portrait
bun run lab:build   # device-lab/dist: index.html (the bench), app.html + app-assets/ (the app), presets.js, build.json
bun run lab:check   # type-checks the sample data against the app's real server functions (CI runs it)
```

## How it works

Only these are swapped, at build time and only here (`vite.config.ts`):

- **Server functions.** Every `src/lib/*.functions.ts` module becomes a module with the same exports, answered by
  `src/server/handlers.ts` from sample data. Each handler is typed against the real function's result, so
  `lab:check` fails when the app changes a shape and the sample data hasn't followed. Writes (like, boost, save, join,
  follow, post, reply, circles, collections, filters) change the sample data until the page reloads.
- **Supabase and TanStack Start.** A signed-in sample account (`src/stubs/supabase.ts`); `useServerFn` hands the
  function back as is (`src/stubs/start.ts`).
- **Device.** `src/sim.ts` makes the page report the device the bench picked (`public/presets.js`): user agent,
  client hints, touch points, screen size, pointer and display-mode queries, device posture and viewport segments.
  The app's own `src/lib/device-profile.ts` then decides the layout as it does on a real device. Safe-area insets
  come from CSS `env()`, which a page can't set, so the bench marks them "real device only".
- **Live updates.** The bench's Live updates buttons play what Fedizen's stream would send while the sample
  conversation is open (`src/live.ts`): the app reads the conversation again and shows the change in place.

`src/report.ts` tells the bench what the app made of the device (profile, theme, navigation, panes, controls clear of
the fold). The bench's verification matrix compares this with expected values written out by hand.

## Sample data

`src/data/`: invented people, posts, messages and notifications written for the Lab; the groups directory is
fedizen.net's public list captured on 7 November 2026 (`fedizen-groups.json`). Images are Atlas's own assets or drawn
initials, because an artifact page can't load images from other sites. The bench says all this on the page. Never put
anyone's private data here.

## Adding to the app

A new server function in `src/lib/*.functions.ts` works in the Lab once `src/server/handlers.ts` answers it; until
then the Lab logs `no sample answer for …` and the call fails as a network error would.
