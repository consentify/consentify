---
"@consentify/core": patch
---

A `set()` (and `acceptAll()` / `rejectAll()`) with a `source`, such as `acceptAll({ source: 'banner' })` from a consent UI button, now always records a new decision with a fresh `id` and `givenAt`, even when the choices are unchanged, so re-affirming consent restarts the `consentMaxAgeDays` window and emits `'change'`; in cloud mode each re-affirmation is reported as a new consent event. A call without a `source` whose choices equal the stored record's is a no-op, so restoring saved choices on every page load (or calling `set()` in an effect that depends on consent state) neither extends consent nor notifies, emits or reports anything. Server writes follow the same rule and then return a `Set-Cookie` header for the stored record unchanged.
