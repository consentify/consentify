---
"@consentify/core": patch
---

An explicit client `set()` (and `acceptAll()` / `rejectAll()`) now always records a new decision with a fresh `givenAt`, even when the choices are unchanged, so re-affirming consent restarts the `consentMaxAgeDays` window and emits `'change'`, matching `server.set()`. In cloud mode each re-affirmation is reported as a new consent event.
