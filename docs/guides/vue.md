# Vue 3 Guide

Consentify works seamlessly with Vue 3 via a simple composable that leverages `shallowRef` for reactive state management.

## Install

```bash
npm install @consentify/core
```

## Create a composable

```ts
// composables/useConsentify.ts
import { shallowRef, onScopeDispose } from 'vue';
import type { ConsentState, UserCategory } from '@consentify/core';

export function useConsentify<T extends UserCategory>(
  instance: { get(): ConsentState<T>; subscribe(cb: () => void): () => void },
) {
  const state = shallowRef<ConsentState<T>>(instance.get());

  const unsub = instance.subscribe(() => {
    state.value = instance.get();
  });

  onScopeDispose(() => {
    unsub();
  });

  return state;
}
```

## Shared consent instance

```ts
// lib/consent.ts
import { createConsentify } from '@consentify/core';

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
```

## Banner component

```vue
<!-- components/CookieBanner.vue -->
<template>
  <div v-if="state.decision === 'unset'" role="dialog" aria-label="Cookie consent" class="banner">
    <p>We use cookies to improve your experience.</p>
    <div class="actions">
      <button @click="consent.acceptAll()">Accept All</button>
      <button @click="consent.rejectAll()">Reject All</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useConsentify } from '@/composables/useConsentify';
import { consent } from '@/lib/consent';

const state = useConsentify(consent);
</script>
```

## Conditional rendering

Use the state reactive value directly:

```vue
<template>
  <AnalyticsDashboard v-if="state.decision === 'decided' && state.snapshot.choices.analytics" />
</template>

<script setup lang="ts">
import { useConsentify } from '@/composables/useConsentify';
import { consent } from '@/lib/consent';

const state = useConsentify(consent);
</script>
```

## Guard with onMounted

Use `guard()` to load scripts conditionally:

```vue
<template>
  <div v-if="consent.isGranted('analytics')">Analytics enabled</div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { consent } from '@/lib/consent';

onMounted(() => {
  const dispose = consent.guard('analytics', () => {
    // Load analytics script
    const script = document.createElement('script');
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX';
    document.head.appendChild(script);
    // ... gtag initialization
  });

  // Cleanup on component unmount (if needed)
  onBeforeUnmount(() => dispose());
});
</script>
```

## SSR with Nuxt

For Nuxt SSR, initialize state client-side and use the server API for reading cookies:

```ts
// middleware/consent.ts (Nuxt)
export default defineEventHandler(async (event) => {
  const cookieHeader = getHeader(event, 'cookie') ?? '';
  const state = consent.get(cookieHeader);
  event.node.res.setHeader('x-consent-decided', state.decision);
});
```

The client-side `useConsentify` composable will hydrate correctly as long as initialization happens in `onMounted` or a `<ClientOnly>` wrapper.

## Key points

- **No provider needed** - the composable reads from any instance
- **Automatic cleanup** - `onScopeDispose` unsubs on component unmount
- **Shallow reactivity** - `shallowRef` is sufficient since the state object is replaced on changes, not mutated
- **SSR-safe** - initialize state in the browser after hydration; use the server API on the server

See [API Reference](./api-reference.md) for full API details.
