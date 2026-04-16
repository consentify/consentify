# @consentify/cloud

> **Deprecated.** This package is a no-op as of `v2.0.0`. It is kept in the
> registry only because npm blocks unpublishing packages older than 72 hours.

All cloud functionality (event reporting, visitor hash, deduplication, retry
buffer) has moved to `@consentify/core` and is automatically enabled when you
construct an instance with a `siteId`.

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

**After:**

```ts
import { createConsentify } from '@consentify/core';

const consent = await createConsentify({
  siteId: 'site_xxx',
  apiKey: 'ck_xxx',
});
```

`createConsentify({ siteId })` is async: it fetches your `SiteConfig` from the
CDN, derives `policy.categories` + `mode` from it, and starts the cloud event
reporter automatically. Any options you would have passed to `enableCloud` are
supplied at the `createConsentify` call site instead.

## What happens if you keep calling `enableCloud`?

It logs a deprecation warning and returns a no-op disposer. No network
requests. No visitor hash is generated. Nothing is reported.

Remove the dependency from your `package.json` at your earliest convenience:

```bash
pnpm remove @consentify/cloud
# or
npm uninstall @consentify/cloud
```

See the main [consentify repo](https://github.com/consentify/consentify) for
full documentation of `@consentify/core` Mode B.
