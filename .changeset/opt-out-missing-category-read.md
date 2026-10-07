---
"@consentify/core": patch
---

Opt-out: a category missing from the stored record (added later under an unchanged `policy.identifier`) now reads as granted, the same default a write fills in. Before, `isGranted`, `get()` and Consent Mode reported it denied, and the next partial `set()` silently flipped it to granted. Opt-in is unchanged (missing reads as denied).
