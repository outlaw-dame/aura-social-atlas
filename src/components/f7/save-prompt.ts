import { f7 } from 'framework7-react';

/** Saving needs an account: a toast that explains and offers sign-in. */
export function promptSignInToSave() {
  f7.toast.create({
    text: 'Sign in to save stories', closeButton: true, closeButtonText: 'Sign in', closeTimeout: 4000,
    on: { closeButtonClick: () => { window.location.assign('/auth'); } },
  }).open();
}
