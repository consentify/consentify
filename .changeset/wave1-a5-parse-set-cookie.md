---
"@consentify/core": minor
---

Add `parseSetCookie()`, a pure helper that turns a server-side `Set-Cookie` header into `{ name, value, options }` for framework cookie setters such as Next.js `cookies().set()`. The value comes back URI-decoded, because those setters encode it themselves. The Next.js guide now uses it instead of hand-parsing the header and hardcoding cookie options.
