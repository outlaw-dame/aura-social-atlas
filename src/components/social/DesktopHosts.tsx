import { FediProfileDialog } from './FediProfileDialog';
import { MiniPlayer } from './MiniPlayer';
import { VideoDock } from './VideoDock';
import { useFediProfileOpener } from './useFediProfile';

/**
 * What every desktop page that shows posts needs mounted once: the profile dialog that creator and author rows open
 * (openFediProfile), the mini player for the shared episode audio, and the VideoDock that the shared video element
 * floats into when its post scrolls away. Discovery mounts it; so does any page rendered outside Discovery.
 */
export function DesktopHosts() {
  const profile = useFediProfileOpener();
  return <>
    <FediProfileDialog target={profile.target} onClose={profile.close} />
    <MiniPlayer />
    <VideoDock />
  </>;
}
