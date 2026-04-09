# Hotjar

Block Hotjar session recording until the user grants analytics consent.

## Setup

```ts
// lib/consent.ts
import { createConsentify } from '@consentify/core';

export const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
});
```

## Load Hotjar with guard()

Hotjar does not have a revocation API - once loaded, it can't be fully stopped. Use `guard()` without `onRevoke` so it fires once:

```ts
import { consent } from './lib/consent';

consent.guard('analytics', () => {
  window.hj = window.hj || function() { (window.hj.q = window.hj.q || []).push(arguments); };
  window._hjSettings = { hjid: YOUR_HOTJAR_ID, hjsv: 6 };

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://static.hotjar.com/c/hotjar-${YOUR_HOTJAR_ID}.js?sv=6`;
  document.head.appendChild(script);
});
```

Without an `onRevoke` callback, `guard()` fires once when consent is granted and then stops watching. The Hotjar script loads and runs for the rest of the session.

## How it works

1. Page loads - no Hotjar script is present
2. User grants analytics consent
3. `guard('analytics')` fires: injects the Hotjar script
4. Hotjar starts session recording and heatmaps
5. On next page load without consent, Hotjar is not loaded

## React

```tsx
import { useConsentify } from '@consentify/react';
import { consent } from '../lib/consent';
import { useEffect, useRef } from 'react';

export function HotjarLoader() {
  const granted = useConsentify(consent, 'analytics');
  const loaded = useRef(false);

  useEffect(() => {
    if (!granted || loaded.current) return;
    loaded.current = true;

    window.hj = window.hj || function() { (window.hj.q = window.hj.q || []).push(arguments); };
    window._hjSettings = { hjid: YOUR_HOTJAR_ID, hjsv: 6 };

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://static.hotjar.com/c/hotjar-${YOUR_HOTJAR_ID}.js?sv=6`;
    document.head.appendChild(script);
  }, [granted]);

  return null;
}
```

## Verification

- [ ] Hotjar script does not appear in network tab before consent
- [ ] After accepting analytics, `hotjar-*.js` loads
- [ ] Hotjar dashboard shows session recordings from consented users
- [ ] Rejecting analytics does not load Hotjar
- [ ] On page reload without consent, Hotjar is not present
