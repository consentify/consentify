# Meta (Facebook) Pixel

Block the Meta Pixel until the user grants marketing consent.

## Setup

```ts
// lib/consent.ts
import { createConsentify } from '@consentify/core';

export const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
});
```

## Load Meta Pixel with guard()

```ts
import { consent } from './lib/consent';

consent.guard(
  'marketing',
  () => {
    // Load fbevents.js via script tag
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);

    // Initialize pixel after script loads
    script.onload = () => {
      window.fbq('init', 'YOUR_PIXEL_ID');
      window.fbq('track', 'PageView');
    };
  },
  () => {
    // Revocation: tell Meta to stop tracking
    if (typeof window.fbq === 'function') {
      window.fbq('consent', 'revoke');
    }
  },
);
```

## How it works

1. Page loads - no Meta Pixel script is present
2. User grants marketing consent
3. `guard('marketing')` fires `onGrant`: loads fbevents.js, initializes pixel, tracks PageView
4. If user later revokes marketing consent, `onRevoke` calls `fbq('consent', 'revoke')`

## With Google Consent Mode

If you also use GTM with Meta's CAPI integration, add the marketing mapping:

```ts
import { enableConsentMode } from '@consentify/core';

enableConsentMode(consent, {
  mapping: {
    analytics: ['analytics_storage'],
    marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
  },
});
```

GTM will then control Meta CAPI tags based on `ad_storage` consent.

## Track custom events

After the pixel is loaded, track events inside the same guard or check consent manually:

```ts
consent.guard('marketing', () => {
  // Pixel is loaded, safe to track
  window.fbq('track', 'Purchase', { value: 29.99, currency: 'USD' });
});
```

## React

```tsx
import { useConsentify } from '@consentify/react';
import { consent } from '../lib/consent';

export function MetaPixelLoader() {
  const granted = useConsentify(consent, 'marketing');

  useEffect(() => {
    if (!granted) return;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    script.onload = () => {
      window.fbq('init', 'YOUR_PIXEL_ID');
      window.fbq('track', 'PageView');
    };
    document.head.appendChild(script);
  }, [granted]);

  return null;
}
```

## Verification

- [ ] Meta Pixel script does not appear in network tab before marketing consent
- [ ] After accepting marketing, `fbevents.js` loads and `PageView` fires
- [ ] Meta Events Manager shows the PageView event
- [ ] Revoking marketing consent calls `fbq('consent', 'revoke')`
- [ ] No `_fbp` cookie is set before consent
