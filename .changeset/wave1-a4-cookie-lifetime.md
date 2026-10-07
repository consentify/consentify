---
"@consentify/core": minor
---

The consent cookie's `Max-Age` now follows `consentMaxAgeDays` when `cookie.maxAgeSec` is not set (an explicit `maxAgeSec` still wins; the one-year default is unchanged when neither is set). New `cookie.partitioned` option adds the CHIPS `Partitioned` attribute and forces `Secure`, for embedded / third-party iframe contexts.
