import { CollectionDialog, useCollectionOpener } from './CollectionsDesktop';
import { FediProfileDialog } from './FediProfileDialog';
import { MiniPlayer } from './MiniPlayer';
import { VideoDock } from './VideoDock';
import { useFediProfileOpener } from './useFediProfile';
import { LiveUpdates } from './LiveUpdates';
import { SemanticIndexer } from './useSemanticIndex';

type CollectionOpener = ReturnType<typeof useCollectionOpener>;

/**
 * What every desktop page that shows posts needs mounted once, because posts open these through window events: the
 * profile dialog (openFediProfile, from creator and author rows), the collection dialog (openCollection, from a post's
 * collection links), the mini player for the shared episode audio, and the VideoDock that the shared video element
 * floats into when its post scrolls away. Discovery mounts it; so does any page rendered outside Discovery. A page
 * that also opens collections itself passes its own opener so there is only one listener and one dialog.
 */
export function DesktopHosts({ collections }: { collections: CollectionOpener }) {
  const profile = useFediProfileOpener();
  return <>
    <FediProfileDialog target={profile.target} onClose={profile.close} />
    <CollectionDialog target={collections.target} onClose={collections.close} />
    <MiniPlayer />
    <VideoDock />
    <SemanticIndexer />
    <LiveUpdates />
  </>;
}

/** For a page with no collection opener of its own. */
export function StandaloneDesktopHosts() {
  return <DesktopHosts collections={useCollectionOpener()} />;
}
