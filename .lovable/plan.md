# Fedizen acceptance probe: readiness status (inspection only)

Checked against the current code (769a56f) and the live backend. Nothing was edited, deployed or created.

## Findings

1. **Setting the switch.** `getFedizenNativeAcceptance` reads `process.env.ATLAS_FEDIZEN_ACCEPTANCE_PROBES` at request time (src/lib/bonfire-acceptance.functions.ts:19). Lovable sets server-side environment values only through Project Settings -> Secrets (the secrets tools). This project has **no separate private staging**. Preview and the published app use the same backend and the same secrets, so a value set there applies to both. There is no supported way to scope a secret to preview only. `ATLAS_BONFIRE_NATIVE_GRAPHQL_READS` is a separate switch and stays off unless someone sets it.
2. **Disposable connected session.** **None exists.** The preview browser is signed out. `fedizen_connections` has 0 rows, so no Atlas account is connected to Fedizen. The backend has 3 sign-in accounts; I did not check which ones they are. None of them has a Fedizen API connection.
3. **Running the function under a session.** The tooling supports this in principle. `lovable auth-session` can create a preview session for an existing account (another person's account needs approval). Playwright can then call the server function from inside the app. Without a Fedizen connection the probe can only report "disabled", "not connected" or "failed", so it can't produce acceptance evidence yet. A real connection requires a person to click Following -> Connect Fedizen -> Allow on fedizen.net.
4. **Impact on production and the shared database.** Yes, it reaches both. The secret affects the published app as well as preview. The probe reads the shared production database (`fedizen_connections` and its token) and makes read requests to fedizen.net under that account. It only runs for a signed-in caller whose own user ID matches the `expectedAtlasUserId` they send. It can't target another user, and it writes nothing according to its contract.

## Safe next actions (need your approval; not done)

- A. Pick or create a throwaway Atlas account and a throwaway Fedizen account. You do the Connect Fedizen -> Allow step yourself.
- B. Turn the probe on with `ATLAS_FEDIZEN_ACCEPTANCE_PROBES=enabled` in Secrets for a short window only. Accept that production is affected too. Leave the native-reads switch unset.
- C. Create a session for that throwaway account, call the probe once from inside the app, and record only its cleaned-up check results.
- D. Remove the secret right away, then disconnect or delete the throwaway connection.
- Alternative with no production exposure: create a Lovable draft, which has its own isolated backend. You would need to connect Fedizen again inside the draft, and the draft's callback address would need to be registered with Fedizen.
