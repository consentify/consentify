---
"@consentify/core": major
"create-consentify": minor
---

Cloud mode moved to its own entry point so self-hosted apps no longer ship the SaaS client. Migrate `createConsentify({ siteId })` from `@consentify/core` to `createCloudConsentify({ siteId })` from `@consentify/core/cloud` with the same options; `createConsentify` now rejects `siteId` at compile time and throws `ConsentifyConfigError` at runtime. Script-tag cloud users switch from `dist/consentify.iife.min.js` (now self-hosted only) to the new `dist/consentify-cloud.iife.min.js`, and the scaffolder emits the new import.
