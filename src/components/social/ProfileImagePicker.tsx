import { useRef, useState } from 'react';
import { PROFILE_IMAGE_TYPES, type ProfileImageKind } from '@/lib/fedizen-profile';

/**
 * Choose a new profile picture or banner: the image goes to Fedizen as soon as it's chosen (Bonfire's updateUser),
 * so Save in the same form only covers the text fields. Shared by desktop and phone; `button` draws the control.
 */
export function ProfileImagePicker({ kind, busy, onPick, button }: {
  kind: ProfileImageKind;
  busy: boolean;
  onPick: (file: File) => Promise<{ ok: true } | { ok: false; message: string }>;
  button: (open: () => void, busy: boolean, label: string) => React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const label = kind === 'avatar' ? 'Change profile picture' : 'Change banner';
  return <div>
    <input ref={input} type="file" hidden accept={PROFILE_IMAGE_TYPES.join(',')} onChange={async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setStatus(null);
      const r = await onPick(file);
      setStatus(r.ok ? { error: false, text: kind === 'avatar' ? 'Profile picture updated on Fedizen.' : 'Banner updated on Fedizen.' } : { error: true, text: r.message });
    }} />
    {button(() => input.current?.click(), busy, busy ? 'Uploading…' : label)}
    {status && <p role={status.error ? 'alert' : 'status'} className={`mt-1 text-[11px] ${status.error ? 'text-destructive' : 'text-muted-foreground'}`} style={{ margin: '4px 0 0', fontSize: 12 }}>{status.text}</p>}
  </div>;
}
