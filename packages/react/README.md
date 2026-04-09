# @consentify/react

[![npm version](https://img.shields.io/npm/v/@consentify/react.svg)](https://www.npmjs.com/package/@consentify/react)
[![npm downloads](https://img.shields.io/npm/dm/@consentify/react.svg)](https://www.npmjs.com/package/@consentify/react)
[![license](https://img.shields.io/npm/l/@consentify/react.svg)](./LICENSE)

> React hook for [@consentify/core](https://www.npmjs.com/package/@consentify/core) — headless cookie consent SDK.

## Install

```bash
npm install @consentify/react
# or
pnpm add @consentify/react
# or
yarn add @consentify/react
```

## Usage

```tsx
import { createConsentify, defaultCategories, useConsentify } from '@consentify/react';

// Create once at module level
const consent = createConsentify({
  policy: { identifier: 'v1.0', categories: defaultCategories },
});

function CookieBanner() {
  const state = useConsentify(consent);

  if (state.decision === 'decided') return null;

  return (
    <div className="cookie-banner">
      <p>We use cookies to enhance your experience.</p>
      <button onClick={() => consent.acceptAll()}>Accept All</button>
      <button onClick={() => consent.rejectAll()}>Essential Only</button>
    </div>
  );
}
```

## API

### `useConsentify(instance)`

React hook that subscribes to consent state changes using `useSyncExternalStore`.

```tsx
const state = useConsentify(consent);
// { decision: 'unset' } | { decision: 'decided', snapshot: Snapshot<T> }
```

### `useConsentify(instance, category)`

Category overload that returns a boolean for a single category:

```tsx
const analyticsGranted = useConsentify(consent, 'analytics');
// boolean - true if granted, false otherwise
```

### Using Events in React

Subscribe to consent lifecycle events with `useEffect`:

```tsx
import { useEffect, useState } from 'react';

function ExpirationWarning() {
  const [expiring, setExpiring] = useState(false);

  useEffect(() => {
    const unsub = consent.on('expiring', (event) => {
      setExpiring(true);
    });
    return unsub;
  }, []);

  if (!expiring) return null;
  return <p>Your consent is expiring soon. Please re-consent.</p>;
}
```

### Consent Proof

Get a tamper-evident consent receipt for compliance:

```tsx
const proof = consent.getProof();
// { policy, givenAt, choices, signature } or null
```

### Re-exports

This package re-exports everything from `@consentify/core`:
- `createConsentify`, `defaultCategories`, `enableConsentMode`, `enableDebug`
- All types (`ConsentState`, `Snapshot`, `Choices`, `ConsentProof`, `ConsentMode`, etc.)

## SSR Support

The hook uses `useSyncExternalStore` with a server snapshot that returns `{ decision: 'unset' }`, ensuring hydration works correctly in SSR frameworks like Next.js.

## License

MIT © 2025 [Roman Denysov](https://github.com/RomanDenysov)
