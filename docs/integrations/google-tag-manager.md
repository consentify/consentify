# Google Tag Manager (GTM)

Load GTM after consent and use Google Consent Mode v2 to control which tags fire.

## Setup

```ts
// lib/consent.ts
import { createConsentify, enableConsentMode, defaultConsentModeMapping } from '@consentify/core';

export const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing', 'preferences'] as const },
});

enableConsentMode(consent, {
  mapping: defaultConsentModeMapping,
  waitForUpdate: 500,
});
```

## Load GTM with guard()

```ts
import { consent } from './lib/consent';

consent.guard('analytics', () => {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-XXXXXXX';
  document.head.appendChild(script);
});
```

## How GTM + Consent Mode works

GTM reads consent state from `gtag('consent', ...)` calls that `enableConsentMode()` manages automatically:

1. Page loads - `enableConsentMode()` sets all consent types to `'denied'` by default
2. GTM loads but holds tags that require consent (configured in GTM as "Require additional consent")
3. User grants consent - Consentify calls `gtag('consent', 'update', { analytics_storage: 'granted' })`
4. GTM re-evaluates triggers and fires tags that now have consent

## GTM consent configuration

In GTM, configure each tag's consent settings:

| Tag type | Required consent |
|----------|-----------------|
| GA4 Configuration | `analytics_storage` |
| GA4 Event | `analytics_storage` |
| Google Ads Conversion | `ad_storage` |
| Google Ads Remarketing | `ad_storage`, `ad_personalization` |
| Facebook Pixel | `ad_storage` |
| Custom HTML (analytics) | `analytics_storage` |

Tags with "No additional consent required" will fire regardless of consent state.

## Alternative: load GTM immediately, control via Consent Mode only

If you want GTM to load on every page (for consent-free tags like basic page structure), skip `guard()` and load GTM in your HTML. Consent Mode alone controls which tags fire:

```html
<!-- Load GTM immediately in <head> -->
<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
</script>
```

```ts
// Consent Mode still controls which tags fire inside GTM
enableConsentMode(consent, {
  mapping: defaultConsentModeMapping,
  waitForUpdate: 500,
});
```

This is the approach most enterprise setups use - GTM loads early, but tags only fire when consent is granted via Consent Mode.

## Verification

- [ ] `dataLayer` contains `gtm.js` event after consent
- [ ] GTM Preview shows consent state updating when user interacts with banner
- [ ] Tags configured with `analytics_storage` consent only fire after analytics consent
- [ ] Tags with no consent requirement fire immediately
- [ ] Consent Mode default values appear in `dataLayer` on page load
