---
"@consentify/core": major
---

New consent records use format v2: they have `v: 2` and can store the policy text version (`policy.textVersion`, as `pv`), the UI language (`lang` option, per-call `lang`, or `<html lang>` in the browser) and the source (`set`, `acceptAll` and `rejectAll` take `{ source: 'banner' | 'preferences' | 'api' }`, stored as `src`). HMAC proofs sign these fields too, while v1 records and proofs are still read and verified, so upgrading forces no re-consent. Server mode on the flat API is selected by the `cookieHeader` key, so pass it even when there is no cookie (`clear({ cookieHeader })`); an options object without it, such as `{ source: 'banner' }`, is a client write.
