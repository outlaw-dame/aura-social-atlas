import { useEffect, useState } from "react";
import { detectProfile, readEnv, watchDeviceProfile, type DeviceProfile } from "./device-profile";

/** Live device profile (client-only). Re-renders when size, fold, posture, input or display mode change. */
export function useDeviceProfile(): DeviceProfile {
  const [profile, setProfile] = useState<DeviceProfile>(() => detectProfile(readEnv()));
  useEffect(() => watchDeviceProfile(setProfile), []);
  return profile;
}
