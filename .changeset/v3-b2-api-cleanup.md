---
"@consentify/core": major
"@consentify/react": major
---

Server mode on the flat API is now chosen by an options object: `get({ cookieHeader })`, `isGranted(category, { cookieHeader })`, `set(choices, { cookieHeader })`, `clear({})`, `acceptAll({ cookieHeader })` and `rejectAll({ cookieHeader })` replace the bare-string and `get(null)` forms. Instances without a `secret` no longer have `getProof` (the forgeable FNV1a fallback is gone), `adapter.save` receives `proof` only when a `secret` is set, and the deprecated `client.get(category)` is removed in favour of `isGranted(category)`. `@consentify/react` re-exports these core APIs, so it moves to a major version too; the hook itself is unchanged.
