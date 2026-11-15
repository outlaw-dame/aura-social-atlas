import { createFileRoute, redirect } from '@tanstack/react-router';
/** Old address: the followed-voices feed is now Feeds. */
export const Route = createFileRoute('/following')({ beforeLoad: () => { throw redirect({ to: '/feeds', replace: true }); } });
