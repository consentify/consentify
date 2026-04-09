# Google Analytics 4 (GA4)

Block GA4 until the user grants analytics consent, then load the tracking script.

## Setup

```ts
// lib/consent.ts
import { createConsentify, enableConsentMode, defaultConsentModeMapping } from '@consentify/core';

export const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing', 'preferences'] as const },
});

// Wire Google Consent Mode v2 so GA4 respects consent state
enableConsentMode(consent, {
  mapping: defaultConsentModeMapping,
  waitForUpdate: 500,
});
```

## Load GA4 with guard()

```ts
import { consent } from './lib/consent';

consent.guard('analytics', () => {
  const script = document.createElement('script');
  script.src = `https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX`;
  script.async = true;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag(...args: any[]) { window.dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXX');
});
```

`guard()` waits for analytics consent before executing. If the user has already consented, the script loads immediately.

## How it works

1. `enableConsentMode()` calls `gtag('consent', 'default', { analytics_storage: 'denied', ... })` on page load
2. User grants analytics consent via your banner
3. `enableConsentMode()` automatically fires `gtag('consent', 'update', { analytics_storage: 'granted' })`
4. `guard('analytics')` fires and injects the GA4 script
5. GA4 reads the consent state from `gtag` and starts collecting data

## Consent Mode mapping

The `defaultConsentModeMapping` maps:

| Consentify category | Google consent type |
|---------------------|---------------------|
| `necessary` | `security_storage` |
| `analytics` | `analytics_storage` |
| `marketing` | `ad_storage`, `ad_user_data`, `ad_personalization` |
| `preferences` | `functionality_storage`, `personalization_storage` |

## Custom events

Once GA4 is loaded, send events normally. They will only fire after consent is granted:

```ts
consent.guard('analytics', () => {
  // GA4 is loaded, safe to track
  gtag('event', 'page_view', { page_path: window.location.pathname });
});
```

## React

```tsx
import { useConsentify } from '@consentify/react';
import { consent } from '../lib/consent';

export function AnalyticsLoader() {
  const granted = useConsentify(consent, 'analytics');

  useEffect(() => {
    if (!granted) return;
    // Load GA4 script here
  }, [granted]);

  return null;
}
```

## Verification

- [ ] GA4 script does not appear in `<head>` before consent
- [ ] After accepting analytics, the script tag is injected
- [ ] Google Consent Mode shows `analytics_storage: 'granted'` in `dataLayer`
- [ ] GA4 Realtime report shows your visit after consent
- [ ] Rejecting analytics does not load the script
