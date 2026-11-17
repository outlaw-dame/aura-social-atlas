import { createFileRoute } from '@tanstack/react-router';
import { StandaloneDesktopHosts } from '@/components/social/DesktopHosts';
import { ThreadView } from '@/components/social/ThreadView';
import { isStatusId, seedFor } from '@/lib/open-post';

/** A post's conversation in Atlas, opened from any post card (its time, or the post itself). Private to the reader's
 *  Fedizen connection, so it isn't indexed. */
export const Route = createFileRoute('/post/$id')({
  head: () => ({ meta: [{ title: 'Conversation — Atlas' }, { name: 'robots', content: 'noindex' }] }),
  component: PostPage,
});

function PostPage() {
  const { id } = Route.useParams();
  if (!isStatusId(id)) return <main className="mx-auto max-w-2xl px-4 py-6 text-sm text-muted-foreground">This isn’t a post Atlas can open.</main>;
  // This page renders outside Discovery, so it mounts the profile and collection dialogs, mini player and VideoDock itself.
  return <><ThreadView key={id} statusId={id} seed={seedFor(id)} /><StandaloneDesktopHosts /></>;
}
