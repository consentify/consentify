# @consentify/cloud

> **Deprecated.** This package is a no-op as of `v2.0.0`. It is kept in the
> registry only because npm blocks unpublishing packages older than 72 hours.

All cloud functionality (event reporting, visitor id, deduplication, retry
buffer) has moved to `@consentify/core`. Cloud mode is its own entry point,
`@consentify/core/cloud`, with the `createCloudConsentify` factory.

## Migration

**Before:**

```ts
import { createConsentify } from '@consentify/core';
import { enableCloud } from '@consentify/cloud';

const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
});

enableCloud(consent, { siteId: 'site_xxx', apiKey: 'ck_xxx' });
```

**After (`@consentify/core` v3):**

```ts
import { createCloudConsentify } from '@consentify/core/cloud';

const consent = await createCloudConsentify({
  siteId: 'site_xxx',
  publicKey: 'pk_xxx', // optional
  // Required: used when the CDN is unreachable and nothing is cached.
  fallback: { categories: ['analytics', 'marketing'], identifier: 'your-published-policy-identifier' },
});
```

`createCloudConsentify` is async: it loads your `SiteConfig` (from cache, the
CDN, or the local `fallback`), derives `policy.categories` and `mode` from it,
and starts the cloud event reporter automatically in the browser. Any options
you would have passed to `enableCloud` are supplied at the
`createCloudConsentify` call site instead. `createConsentify({ siteId })` from
`@consentify/core` throws in v3.

## What happens if you keep calling `enableCloud`?

It logs a deprecation warning and returns a no-op disposer. No network
requests. No visitor id is generated. Nothing is reported.

Remove the dependency from your `package.json` at your earliest convenience:

```bash
pnpm remove @consentify/cloud
# or
npm uninstall @consentify/cloud
```

See the main [consentify repo](https://github.com/consentify/consentify) for
full documentation of `@consentify/core/cloud`.
