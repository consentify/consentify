---
"@consentify/core": minor
---

`guard(category, onGrant, onRevoke)` now re-arms after a revoke: a later re-grant calls `onGrant` again and the next revoke calls `onRevoke` again, until the returned dispose function is called. Guards without `onRevoke` are unchanged and still run `onGrant` once.
