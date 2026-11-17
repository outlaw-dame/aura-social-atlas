# Push setup status (preview, signed out)

Result: `{configured: false, problem: "bad-private-key"}`. Settings → Notifications loaded (HTTP 200).

`configured: false` follows from the problem result: the check always returns false when it reports a problem. My filter read the problem name but not the true/false flag itself.

Next step (for you, not code): run `bun scripts/vapid-keys.ts` again on your computer and replace both VAPID keys together in Project Settings → Secrets. After that, I can run this check again.

No code, database, secrets or commits will change.
