---
"@consentify/core": patch
---

In `opt-out` mode, a partial `set()` before any decision now keeps the categories you did not pass granted, on both the client and the server, instead of denying them. `opt-in` mode, explicit choices, and `acceptAll()`/`rejectAll()` behave as before.
