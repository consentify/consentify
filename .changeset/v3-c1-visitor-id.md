---
"@consentify/core": major
---

The default visitor id (`consentify_visitor` in localStorage) is no longer created on page load: cloud reporting creates it at the first `accept_all` or `customize` decision, and adapter hydration only uses an id that already exists (skipping `adapter.load()` for a first-time visitor). A `reject_all` event now deletes the stored id and reports a one-off 8-character hex token as `visitorHash`. A custom `visitorId` passed to `createCloudConsentify` is now sent with every cloud event; before, the reporter ignored it.
