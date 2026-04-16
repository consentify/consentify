# @consentify/cloud

## 2.0.0

### Major Changes

- **Package deprecated. `enableCloud()` is now a no-op.**

  All cloud functionality (event reporting, visitor hash, deduplication, retry
  buffer) has moved into `@consentify/core` and is automatically enabled when
  you construct an instance with a `siteId`:

  ```ts
  import { createConsentify } from '@consentify/core';

  const consent = await createConsentify({
    siteId: 'your-site-id',
    apiKey: 'sk_live_...',
  });
  ```

  The previous `enableCloud(instance, options)` call now only logs a
  deprecation warning and returns a no-op disposer. No HTTP requests, no
  visitor hash, nothing.

  This package is kept in the registry only because npm blocks unpublishing
  packages older than 72 hours. Please remove `@consentify/cloud` from your
  `package.json` and move the options to `createConsentify({ siteId, apiKey })`
  in `@consentify/core`.

  See the [migration guide](./README.md) for details.
