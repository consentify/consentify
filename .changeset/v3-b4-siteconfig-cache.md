---
"@consentify/core": major
"create-consentify": patch
---

`createCloudConsentify` now requires a local `fallback` policy (`{ categories, identifier?, mode?, consentMaxAgeDays? }`) and no longer rejects when the CDN is unreachable, slow or serves a bad config: it uses a cached SiteConfig or the fallback instead, and reports which one on `consent.cloud.source`. The SiteConfig is cached in `localStorage` (`consentify_cfg_<siteId>`) in the browser and in memory on the server, with `configTtlSec` (default 3600) stale-while-revalidate and a `timeoutMs` deadline (default 3000). The scaffolder emits a `fallback` from the categories and mode you pick.
