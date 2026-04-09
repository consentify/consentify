# PostHog

Integrate PostHog analytics with consent-aware initialization and opt-out support.

## Setup

```ts
// lib/consent.ts
import { createConsentify } from '@consentify/core';

export const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
});
```

## Initialize PostHog with guard()

PostHog's JS SDK has built-in opt-in/opt-out support. Use `guard()` to control when tracking starts:

```ts
import posthog from 'posthog-js';
import { consent } from './lib/consent';

// Initialize PostHog in disabled state
posthog.init('phc_YOUR_PROJECT_KEY', {
  api_host: 'https://us.i.posthog.com',
  opt_out_capturing_by_default: true, // start with tracking disabled
  persistence: 'localStorage+cookie',
});

consent.guard(
  'analytics',
  () => {
    // User granted analytics consent - enable capturing
    posthog.opt_in_capturing();
  },
  () => {
    // User revoked analytics consent - disable capturing
    posthog.opt_out_capturing();
  },
);
```

## How it works

1. PostHog initializes but does NOT capture anything (`opt_out_capturing_by_default: true`)
2. User grants analytics consent
3. `guard('analytics')` fires `onGrant`: calls `posthog.opt_in_capturing()`
4. PostHog starts capturing events, pageviews, and session recordings
5. If user revokes consent, `onRevoke` calls `posthog.opt_out_capturing()`

## Alternative: lazy init

If you don't want PostHog loaded at all before consent:

```ts
consent.guard('analytics', () => {
  import('posthog-js').then(({ default: posthog }) => {
    posthog.init('phc_YOUR_PROJECT_KEY', {
      api_host: 'https://us.i.posthog.com',
    });
  });
});
```

This approach is simpler but does not support revocation (PostHog can't be fully unloaded once initialized).

## React

```tsx
import { useConsentify } from '@consentify/react';
import { consent } from '../lib/consent';
import posthog from 'posthog-js';

export function PostHogConsent() {
  const granted = useConsentify(consent, 'analytics');

  useEffect(() => {
    if (granted) {
      posthog.opt_in_capturing();
    } else {
      posthog.opt_out_capturing();
    }
  }, [granted]);

  return null;
}
```

## Verification

- [ ] PostHog does not capture events before analytics consent
- [ ] After accepting analytics, events appear in PostHog dashboard
- [ ] Session recordings start only after consent
- [ ] Revoking consent stops capturing
- [ ] PostHog's `/decide` endpoint is not called before consent (if using lazy init)
