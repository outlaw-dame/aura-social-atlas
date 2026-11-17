// Makes a VAPID key pair for Atlas's push relay. Run locally: `bun scripts/vapid-keys.ts`, then put the two values in
// the Worker secrets ATLAS_VAPID_PUBLIC_KEY and ATLAS_VAPID_PRIVATE_KEY (and a contact in ATLAS_VAPID_SUBJECT, e.g.
// mailto:you@example.org). Never commit or paste the private key anywhere else.
import { b64u, newKeyPair } from '../src/lib/push/webpush';

const k = await newKeyPair();
console.log(`ATLAS_VAPID_PUBLIC_KEY=${b64u(k.pub)}`);
console.log(`ATLAS_VAPID_PRIVATE_KEY=${b64u(k.d)}`);
