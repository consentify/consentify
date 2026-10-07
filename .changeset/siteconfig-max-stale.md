---
"@consentify/core": minor
---

Cloud: new `configMaxStaleSec` option (default 7 days). A cached SiteConfig older than that is no longer served stale; the factory waits for the CDN as with an empty cache and uses `fallback` if the fetch fails. On the server, a failed SiteConfig fetch with no usable cache is remembered for 30 seconds, so renders during a CDN outage use `fallback` at once instead of each waiting `timeoutMs`.
