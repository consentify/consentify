---
"@consentify/core": minor
"create-consentify": patch
---

Let `enableConsentMode` skip `gtag('consent', 'default')` when a head snippet already sent it (`sendDefault: false`).

The scaffolder waits until mount before painting the banner, and its Consent Mode head snippet follows the categories the user picked. The core package README now matches the flat API and the real bundle size.
