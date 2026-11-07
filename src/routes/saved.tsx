import { createFileRoute, redirect } from '@tanstack/react-router';
/** Old address: Saved is now a private tab on your profile. */
export const Route = createFileRoute('/saved')({ beforeLoad: () => { throw redirect({ to: '/profile', search: { tab: 'saved' }, replace: true }); } });
