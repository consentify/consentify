# Solid.js Guide

Consentify works with Solid.js via signals and the effect cleanup pattern.

## Install

```bash
npm install @consentify/core
```

## Create a signal

Create a reactive signal that mirrors the consent state:

```ts
// lib/consent.ts
import { createConsentify } from '@consentify/core';
import { createSignal } from 'solid-js';
import type { ConsentState, UserCategory } from '@consentify/core';

export const consent = createConsentify({
  policy: {
    categories: ['analytics', 'marketing'] as const,
  },
  cookie: {
    name: 'consent',
    sameSite: 'Lax',
    secure: true,
  },
  consentMaxAgeDays: 365,
});

export function createConsentSignal<T extends UserCategory>() {
  const [state, setState] = createSignal<ConsentState<T>>(consent.get());

  // Subscribe on creation; the unsubscribe function is returned for cleanup
  const unsub = consent.subscribe(() => setState(consent.get()));

  // Return a cleanup function that Solid can use in effects
  return [state, unsub] as const;
}
```

## Banner component

```tsx
// components/CookieBanner.tsx
import { onCleanup, createEffect } from 'solid-js';
import { consent, createConsentSignal } from '~/lib/consent';

export function CookieBanner() {
  const [state, unsub] = createConsentSignal();

  onCleanup(unsub);

  return (
    <>
      {state().decision === 'unset' && (
        <div role="dialog" aria-label="Cookie consent" class="banner">
          <p>We use cookies to improve your experience.</p>
          <div class="actions">
            <button onClick={() => consent.acceptAll()}>Accept All</button>
            <button onClick={() => consent.rejectAll()}>Reject All</button>
          </div>
        </div>
      )}
    </>
  );
}
```

## Conditional rendering

Use derived signals for conditional logic:

```tsx
import { createMemo } from 'solid-js';

export function AnalyticsGate() {
  const [state, unsub] = createConsentSignal();

  const analyticsGranted = createMemo(() => 
    state().decision === 'decided' && state().snapshot.choices.analytics
  );

  onCleanup(unsub);

  return (
    <>
      {analyticsGranted() && <AnalyticsDashboard />}
    </>
  );
}
```

## Guard in effect

Use `guard()` inside an effect to load scripts conditionally:

```tsx
import { onMount, onCleanup, createEffect } from 'solid-js';

export function AnalyticsScripts() {
  let disposeGuard: (() => void) | null = null;

  onMount(() => {
    disposeGuard = consent.guard('analytics', () => {
      // Load analytics script
      const script = document.createElement('script');
      script.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX';
      document.head.appendChild(script);
      // ... gtag initialization
    });
  });

  onCleanup(() => {
    if (disposeGuard) disposeGuard();
  });

  return null;
}
```

## Subscribe pattern alternative

If you prefer not to create a wrapper function, use the direct pattern:

```tsx
export function CookieBanner() {
  const [state, setState] = createSignal(consent.get());

  let unsub: (() => void) | null = null;
  createEffect(() => {
    if (!unsub) {
      unsub = consent.subscribe(() => setState(consent.get()));
    }
  });

  onCleanup(() => unsub?.());

  return (
    <>
      {state().decision === 'unset' && (
        <div role="dialog" aria-label="Cookie consent">
          <p>We use cookies to improve your experience.</p>
          <button onClick={() => consent.acceptAll()}>Accept All</button>
          <button onClick={() => consent.rejectAll()}>Reject All</button>
        </div>
      )}
    </>
  );
}
```

## SSR with SolidStart

For SolidStart SSR, read cookies server-side:

```ts
// routes/layout.server.ts
import { consent } from '~/lib/consent';

export async function load({ request }) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const state = consent.get(cookieHeader);
  return { consentState: state };
}
```

Client-side hydration is safe because `getServerSnapshot()` always returns `{ decision: 'unset' }`.

## Key points

- **Signals + effects** - natural fit for Solid's reactive system
- **Cleanup with onCleanup** - ensures subscriptions are torn down when components unmount
- **Derived signals** - use `createMemo` for reactive logic that depends on consent state
- **SSR-safe** - server API reads cookies; client signals hydrate without mismatches

See [API Reference](./api-reference.md) for full API details.
