import { AVATAR_SHAPES, avatarRadius, setAvatarShape, useAvatarShape } from '@/lib/avatar-shape';
import { avatarPreset } from '@/lib/atlas-avatars';

/** Settings → Appearance: how avatars are drawn across Atlas — circle, rounded or square — each shown as a preview. */
export function AvatarShapePicker() {
  const shape = useAvatarShape();
  const face = avatarPreset('memoji-1').src;
  return <div role="radiogroup" aria-label="Avatar shape" className="atlas-shape-picker">
    {AVATAR_SHAPES.map(s => <button key={s.id} type="button" role="radio" aria-checked={shape === s.id} onClick={() => setAvatarShape(s.id)}>
      <img src={face} alt="" width={48} height={48} style={{ borderRadius: avatarRadius(s.id) }} />
      <span>{s.name}</span>
    </button>)}
  </div>;
}
