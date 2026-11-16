import { BlockFooter, BlockTitle, List, ListItem, Toggle } from 'framework7-react';
import { MEDIA_DISPLAY, setReading, useReading } from '@/lib/reading-prefs';

/** Phone: Settings → Content warnings and Sensitive media (lib/reading-prefs). */
export function MobileReadingSettings() {
  const r = useReading();
  return <>
    <BlockTitle>Content warnings</BlockTitle>
    <List strong inset dividers>
      <ListItem title="Always expand">
        <Toggle slot="after" checked={r.expandWarnings} onToggleChange={() => setReading({ expandWarnings: !r.expandWarnings })} />
      </ListItem>
    </List>
    <BlockTitle>Sensitive media</BlockTitle>
    <List strong inset dividers>
      {MEDIA_DISPLAY.map(m => <ListItem key={m.id} title={m.name} radio radioIcon="end" name="atlas-media-display" checked={r.media === m.id} onChange={() => setReading({ media: m.id })} />)}
    </List>
    <List strong inset dividers>
      <ListItem title="Blur media from people you don’t follow">
        <Toggle slot="after" checked={r.blurStrangers} onToggleChange={() => setReading({ blurStrangers: !r.blurStrangers })} />
      </ListItem>
    </List>
    <BlockFooter>{MEDIA_DISPLAY.find(m => m.id === r.media)?.note} Media your keyword filters hide stays hidden either way.</BlockFooter>
    <BlockTitle>Posting</BlockTitle>
    <List strong inset dividers>
      <ListItem title="Alt text reminder">
        <Toggle slot="after" checked={r.altReminder} onToggleChange={() => setReading({ altReminder: !r.altReminder })} />
      </ListItem>
    </List>
    <BlockFooter>Before posting images or a video without alt text, ask whether to add it. Alt text is what screen readers say in place of the picture.</BlockFooter>
  </>;
}
