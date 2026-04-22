# @consentify/core

[![npm version](https://img.shields.io/npm/v/@consentify/core.svg)](https://www.npmjs.com/package/@consentify/core)
[![npm downloads](https://img.shields.io/npm/dm/@consentify/core.svg)](https://www.npmjs.com/package/@consentify/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@consentify/core)](https://bundlephobia.com/package/@consentify/core)
[![license](https://img.shields.io/npm/l/@consentify/core.svg)](./LICENSE)

> Headless cookie consent SDK — zero dependencies, TypeScript-first, SSR-ready.

## Why Consentify?

- **🪶 Lightweight** — Zero runtime dependencies, ~2KB minified + gzipped
- **🔒 Type-safe** — Full TypeScript support with inference for your categories
- **⚡ SSR-ready** — Separate server/client APIs that never touch the DOM on server
- **⚛️ React-ready** — Built-in `useSyncExternalStore` support for React 18+
- **🎯 Headless** — Bring your own UI, we handle the state
- **📋 Compliant** — Built for GDPR, CCPA, and similar regulations

## Install

Fastest path: scaffold the SDK into your project with `npx create-consentify@latest`.

Or install directly:

```bash
npm install @consentify/core
# or
pnpm add @consentify/core
# or
yarn add @consentify/core
```

## Quick Start

```ts
import { createConsentify, defaultCategories } from '@consentify/core';

const consent = createConsentify({
  policy: {
    identifier: 'v1.0',
    categories: defaultCategories, // ['preferences', 'analytics', 'marketing', 'functional', 'unclassified']
  },
});

// Set user choices
consent.client.set({ analytics: true, marketing: false });

// Check consent
if (consent.isGranted('analytics')) {
  loadAnalytics();
}

// Get full state
const state = consent.client.get();
// → { decision: 'decided', snapshot: { policy: '...', givenAt: '...', choices: {...} } }
// → { decision: 'unset' } (if no consent given yet)
```

## React Integration

For React projects, use the [`@consentify/react`](https://www.npmjs.com/package/@consentify/react) package which provides a ready-to-use hook:

```bash
npm install @consentify/react
```

```tsx
import { createConsentify, defaultCategories, useConsentify } from '@consentify/react';

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

<details>
<summary>Manual integration with useSyncExternalStore</summary>

If you prefer not to add the React package, you can use `useSyncExternalStore` directly:

```tsx
import { useSyncExternalStore } from 'react';
import { createConsentify, defaultCategories } from '@consentify/core';

const consent = createConsentify({
  policy: { identifier: 'v1.0', categories: defaultCategories },
});

function useConsent() {
  return useSyncExternalStore(
    consent.client.subscribe,
    consent.client.get,
    consent.client.getServerSnapshot
  );
}
```

</details>

## Server-Side Usage

The server API works with raw `Cookie` headers — perfect for Next.js, Remix, or any Node.js framework:

```ts
// Read consent from request
const state = consent.server.get(request.headers.get('cookie'));

if (state.decision === 'decided' && state.snapshot.choices.analytics) {
  // User consented to analytics
}

// Set consent (returns Set-Cookie header string)
const setCookieHeader = consent.server.set(
  { analytics: true },
  request.headers.get('cookie')
);
response.headers.set('Set-Cookie', setCookieHeader);

// Clear consent
const clearHeader = consent.server.clear();
```

### Next.js App Router Example

```tsx
// lib/consent.ts
import { createConsentify, defaultCategories } from '@consentify/core';

export const consent = createConsentify({
  policy: { identifier: 'v1.0', categories: defaultCategories },
});

// app/layout.tsx
import { cookies } from 'next/headers';
import { consent } from '@/lib/consent';

export default async function RootLayout({ children }) {
  const cookieStore = await cookies();
  const state = consent.server.get(cookieStore.toString());
  
  return (
    <html>
      <body>
        {children}
        {state.decision === 'decided' && state.snapshot.choices.analytics && (
          <Analytics />
        )}
      </body>
    </html>
  );
}
```

## Custom Categories

Define your own consent categories with full type safety:

```ts
const consent = createConsentify({
  policy: {
    identifier: 'v1.0',
    categories: ['analytics', 'ads', 'personalization'] as const,
  },
});

// TypeScript knows your categories!
consent.set({ analytics: true, ads: false });
consent.isGranted('personalization'); // ✓ valid
consent.isGranted('unknown');         // ✗ type error
```

## Configuration

```ts
createConsentify({
  policy: {
    identifier: 'v1.0',           // Recommended: version your policy
    categories: defaultCategories,
  },
  // Consent validity (when to re-prompt user)
  consentMaxAgeDays: 365,         // Optional: re-consent after N days
  // Consent mode: 'opt-in' (GDPR, default) or 'opt-out' (CCPA)
  mode: 'opt-in',                 // 'opt-in' | 'opt-out'
  // Days before expiry to emit 'expiring' event (requires consentMaxAgeDays)
  expirationWarningDays: 30,      // Default: 30
  // Cookie storage settings (browser retention)
  cookie: {
    name: 'consent',              // Default: 'consentify'
    maxAgeSec: 60 * 60 * 24 * 365, // Default: 1 year (browser storage)
    sameSite: 'Lax',              // 'Lax' | 'Strict' | 'None'
    secure: true,                 // Forced true when sameSite='None'
    path: '/',
    domain: '.example.com',       // Optional: for cross-subdomain
  },
  storage: ['cookie'],            // ['cookie'] | ['localStorage', 'cookie']
});
```

## API Reference

### `createConsentify(options)`

Returns an object with `policy`, `client`, and `server` properties.

#### `client` (browser)

| Method | Description |
|--------|-------------|
| `get()` | Returns `ConsentState` - `{ decision: 'decided', snapshot }` or `{ decision: 'unset' }` |
| `get(category)` | Returns `boolean` - `true` if category is consented (`'necessary'` always returns `true`) |
| `set(choices)` | Merges choices and persists; notifies subscribers if changed |
| `clear()` | Removes stored consent; notifies subscribers |
| `acceptAll()` | Sets all user categories to `true` |
| `rejectAll()` | Sets all user categories to `false` (necessary stays `true`) |
| `getProof()` | Returns `ConsentProof` with tamper-evident signature, or `null` if unset |
| `subscribe(cb)` | Subscribe to changes; returns unsubscribe function |
| `getServerSnapshot()` | Returns `{ decision: 'unset' }` for SSR hydration |

#### `server` (Node.js)

| Method | Description |
|--------|-------------|
| `get(cookieHeader)` | Parse consent from `Cookie` header string |
| `set(choices, cookieHeader?)` | Returns `Set-Cookie` header string |
| `clear()` | Returns `Set-Cookie` header string to delete cookie |

### Types

```ts
type ConsentState<T> = 
  | { decision: 'unset' }
  | { decision: 'decided'; snapshot: Snapshot<T> };

interface Snapshot<T> {
  policy: string;      // Policy identifier/hash
  givenAt: string;     // ISO timestamp
  choices: Choices<T>; // { necessary: true, ...categories }
}

type Choices<T> = Record<'necessary' | T, boolean>;
```

### Default Categories

```ts
const defaultCategories = [
  'preferences',   // User preferences (language, theme)
  'analytics',     // Analytics and performance
  'marketing',     // Advertising and marketing
  'functional',    // Enhanced functionality
  'unclassified',  // Uncategorized cookies
] as const;
```

### Consent Mode (opt-in / opt-out)

```ts
// GDPR (default): categories denied until user consents
const gdpr = createConsentify({
  policy: { categories: ['analytics'] as const },
  mode: 'opt-in',
});
gdpr.isGranted('analytics'); // false (until user consents)

// CCPA: categories granted until user opts out
const ccpa = createConsentify({
  policy: { categories: ['analytics'] as const },
  mode: 'opt-out',
});
ccpa.isGranted('analytics'); // true (until user opts out)
```

### Consent Proof (Audit Trail)

```ts
consent.set({ analytics: true, marketing: false });

const proof = consent.getProof();
// { policy: '...', givenAt: '2026-...', choices: {...}, signature: '...' }

// Server-side
const proof = consent.getProof(cookieHeader);
```

**Signed vs unsigned.** Pass a `secret` to enable tamper-evident HMAC-SHA256 signatures (recommended for any compliance use case). In signed mode, `getProof()` returns `Promise<ConsentProof<T> | null>`.

```ts
const consent = createConsentify({
  policy: { categories: ['analytics'] as const },
  secret: process.env.CONSENT_SIGNING_SECRET,
});

const proof = await consent.getProof();
```

Without a `secret`, `getProof()` falls back to a non-cryptographic FNV1a hash. This path is **forgeable**, emits a one-time `console.warn`, and is slated to return `null` in a future major release. Only use it for local debugging.

### Expiration Warning

```ts
const consent = createConsentify({
  policy: { categories: ['analytics'] as const },
  consentMaxAgeDays: 365,
  expirationWarningDays: 30,
});

consent.on('expiring', (event) => {
  console.log(`Consent expires in ${event.daysRemaining.toFixed(0)} days`);
  // Show re-consent prompt
});
```

## Script Tag / IIFE

For non-bundled apps (WordPress, static sites), load the IIFE build directly:

```html
<script src="https://unpkg.com/@consentify/core/dist/consentify.iife.min.js"></script>
<script>
  var consent = Consentify.createConsentify({
    policy: { categories: ['analytics', 'marketing'] }
  });

  consent.guard('analytics', function () {
    // Load analytics script
  });
</script>
```

The IIFE bundle is ~5kb gzipped and exposes all exports on the `Consentify` global.

### CSP nonce + SRI (recommended)

If your site enforces a strict Content Security Policy, pin a Subresource Integrity hash and forward a nonce from your server template:

```html
<script
  src="https://unpkg.com/@consentify/core@2/dist/consentify.iife.min.js"
  integrity="sha384-REPLACE_WITH_SRI_HASH"
  crossorigin="anonymous"
  nonce="%%CSP_NONCE%%"></script>
```

Pair this with a CSP header like `script-src 'self' 'nonce-%%CSP_NONCE%%'`. Regenerate the SRI hash per pinned version:

```bash
openssl dgst -sha384 -binary dist/consentify.iife.min.js | openssl base64 -A
```

See [MDN: Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) for the full spec.

## How It Works

1. **Policy versioning** — Consent is tied to a policy identifier. When you update your policy (change `identifier`), previous consent is invalidated.

2. **Necessary cookies** — The `'necessary'` category is always `true` and cannot be disabled.

3. **Storage** — Cookie is the canonical store (works on server). Optionally mirror to `localStorage` for faster client reads.

4. **Compact format** — Consent is stored as a URL-encoded JSON snapshot in a single cookie.

5. **Consent expiration** — Optional `consentMaxAgeDays` invalidates consent after N days, requiring users to re-consent. This is independent of `cookie.maxAgeSec` (which controls how long the browser stores the cookie).

## Support

If you find this library useful:

- ⭐ Star the repo on [GitHub](https://github.com/consentify/consentify)
- 💖 [Sponsor on GitHub](https://github.com/sponsors/RomanDenysov)
- ☕ [Buy me a coffee on Ko-fi](https://ko-fi.com/romandenysov)
- ☕ [Buy me a coffee](https://buymeacoffee.com/romandenysov)

## License

MIT © 2025 [Roman Denysov](https://github.com/RomanDenysov)
