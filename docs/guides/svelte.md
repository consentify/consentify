# Svelte Guide

Consentify integrates naturally with Svelte via the `readable` store primitive, since the SDK's subscribe contract matches Svelte's store expectations perfectly.

## Install

```bash
npm install @consentify/core
```

## Create a store

```ts
// lib/consent.ts
import { createConsentify } from '@consentify/core';
import { readable } from 'svelte/store';

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

// Wrap as a readable store - the SDK's subscribe function fits perfectly
export const consentState = readable(consent.get(), (set) => {
  return consent.subscribe(() => set(consent.get()));
});
```

## Banner component

```svelte
<!-- src/components/CookieBanner.svelte -->
<script>
  import { consentState, consent } from '$lib/consent';
</script>

{#if $consentState.decision === 'unset'}
  <div role="dialog" aria-label="Cookie consent" class="banner">
    <p>We use cookies to improve your experience.</p>
    <div class="actions">
      <button on:click={() => consent.acceptAll()}>Accept All</button>
      <button on:click={() => consent.rejectAll()}>Reject All</button>
    </div>
  </div>
{/if}
```

## Conditional rendering

Use the store directly with reactive declarations:

```svelte
<script>
  import { consentState, consent } from '$lib/consent';

  $: analyticsGranted = $consentState.decision === 'decided' && 
                        $consentState.snapshot.choices.analytics;
</script>

{#if analyticsGranted}
  <AnalyticsDashboard />
{/if}
```

## Guard in onMount

Use `guard()` to conditionally load third-party scripts:

```svelte
<script>
  import { onMount, onDestroy } from 'svelte';
  import { consent } from '$lib/consent';

  let dispose: (() => void) | null = null;

  onMount(() => {
    dispose = consent.guard('analytics', () => {
      // Load analytics script
      const script = document.createElement('script');
      script.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX';
      document.head.appendChild(script);
      // ... gtag initialization
    });
  });

  onDestroy(() => {
    if (dispose) dispose();
  });
</script>

<div>Analytics guard initialized</div>
```

## SSR with SvelteKit

For SvelteKit SSR, initialize the consent state server-side via the server API:

```ts
// src/routes/+layout.server.ts
import { consent } from '$lib/consent';

export async function load({ request }) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const state = consent.get(cookieHeader);
  return { consentState: state };
}
```

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import type { LayoutData } from './$types';
  import { consentState, consent } from '$lib/consent';

  export let data: LayoutData;

  // Sync server state into client store on hydration
  onMount(() => {
    consentState.set(data.consentState);
  });
</script>

<CookieBanner />
<slot />
```

The client store hydrates safely because `getServerSnapshot()` returns `{ decision: 'unset' }`, preventing hydration mismatches.

## Key points

- **Perfect fit for stores** - the SDK's `subscribe(cb)` callback signature is identical to Svelte's store contract
- **Automatic unsubscribe** - the returned function from subscribe is called by the store system
- **Auto-subscribed values** - use `$consentState` to get reactive updates automatically
- **SSR-safe** - server API reads cookies; client store hydrates without mismatches

See [API Reference](./api-reference.md) for full API details.
