<p align="center"><img src="./assets/banner.svg" alt="consentify" width="600"></p>

# consentify

**Headless cookie consent that actually blocks scripts.**

[![npm version](https://img.shields.io/npm/v/@consentify/core.svg)](https://www.npmjs.com/package/@consentify/core)
[![CI](https://github.com/consentify/consentify/actions/workflows/ci.yml/badge.svg)](https://github.com/consentify/consentify/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@consentify/core)](https://bundlephobia.com/package/@consentify/core)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/@consentify/core.svg)](https://github.com/consentify/consentify/blob/main/packages/core/LICENSE)

TypeScript-first, SSR-safe, zero-dependency consent management. Works on the server (Node.js headers), on the client (cookies/localStorage), and with React via `useSyncExternalStore` -- no Provider required.

## Quick Start

Scaffold a typed setup into an existing project (Next.js, Vite, Remix, Astro, or vanilla):

```bash
npx create-consentify@latest
```

Or install the SDK directly:

```bash
npm install @consentify/core
```

```ts
import { createConsentify } from '@consentify/core';

const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
});

// Check consent (client-side)
consent.isGranted('analytics'); // false — not yet granted

// User accepts analytics
consent.set({ analytics: true });

consent.isGranted('analytics'); // true
```

## The Full Integration: Blocking Google Analytics Until Consent

This is what consent management is actually for -- preventing tracking scripts from loading until the user explicitly opts in. `guard()` handles the entire lifecycle: wait for consent, load the script, and optionally clean up if consent is revoked.

```ts
// lib/consent.ts
import { createConsentify } from '@consentify/core';

export const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
  cookie: { name: 'consent', sameSite: 'Lax', secure: true },
  consentMaxAgeDays: 365,
});
```

```ts
// Load GA only when analytics consent is granted
consent.guard('analytics', () => {
  const s = document.createElement('script');
  s.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX';
  s.async = true;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXX');
});
```

If the user has already consented, the script loads immediately. If not, `guard()` waits and fires once consent is granted -- no manual `subscribe()` wiring needed.

You can also handle revocation:

```ts
const dispose = consent.guard(
  'marketing',
  () => loadPixel(),      // runs when marketing consent is granted
  () => removePixel(),    // runs if consent is later revoked
);

// Stop watching entirely
dispose();
```

```ts
// Your cookie banner UI (framework-agnostic)
import { consent } from './lib/consent';

document.getElementById('accept-all')?.addEventListener('click', () => {
  consent.set({ analytics: true, marketing: true });
});

document.getElementById('reject-all')?.addEventListener('click', () => {
  consent.set({ analytics: false, marketing: false });
});

document.getElementById('reset')?.addEventListener('click', () => {
  consent.clear();
  window.location.reload();
});
```

## Google Consent Mode v2

Built-in support for Google Consent Mode v2. No extra package needed.

```ts
import { createConsentify, enableConsentMode, defaultConsentModeMapping } from '@consentify/core';

const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing', 'preferences'] as const },
});

// Wire up Google Consent Mode with the default mapping
const dispose = enableConsentMode(consent, {
  mapping: defaultConsentModeMapping,
  waitForUpdate: 500,
});
```

`enableConsentMode` automatically calls `gtag('consent', 'default', ...)` on init and `gtag('consent', 'update', ...)` whenever the user changes their choices. It bootstraps `dataLayer` and `gtag` if they don't exist.

You can also provide a custom mapping:

```ts
enableConsentMode(consent, {
  mapping: {
    necessary: ['security_storage'],
    analytics: ['analytics_storage'],
    marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
  },
});
```

## React Integration

```bash
npm install @consentify/core @consentify/react
```

```tsx
// lib/consent.ts
import { createConsentify } from '@consentify/core';

export const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
});
```

```tsx
// components/CookieBanner.tsx
import { useConsentify } from '@consentify/react';
import { consent } from '../lib/consent';

export function CookieBanner() {
  const state = useConsentify(consent);

  if (state.decision === 'decided') return null;

  return (
    <div role="dialog" aria-label="Cookie consent">
      <p>We use cookies to improve your experience.</p>
      <button onClick={() => consent.set({ analytics: true, marketing: true })}>
        Accept All
      </button>
      <button onClick={() => consent.set({ analytics: false, marketing: false })}>
        Reject All
      </button>
    </div>
  );
}
```

```tsx
// components/Analytics.tsx — only render tracking when consented
import { useConsentify } from '@consentify/react';
import { consent } from '../lib/consent';

export function Analytics() {
  const state = useConsentify(consent);

  if (state.decision !== 'decided' || !state.snapshot.choices.analytics) {
    return null;
  }

  return <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX" />;
}
```

No Provider or Context needed. `useConsentify` is powered by `useSyncExternalStore` -- it subscribes directly to the consent instance and re-renders on changes.

## SSR / Next.js

Consentify is SSR-safe out of the box. The server API reads and writes consent via raw `Cookie` / `Set-Cookie` headers -- no DOM required.

```ts
// app/layout.tsx (Next.js App Router)
import { cookies } from 'next/headers';
import { consent } from '../lib/consent';
import { CookieBanner } from '../components/CookieBanner';
import { Analytics } from '../components/Analytics';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const state = consent.get(cookieStore.toString());

  return (
    <html>
      <body>
        {children}
        <CookieBanner />
        {state.decision === 'decided' && state.snapshot.choices.analytics && <Analytics />}
      </body>
    </html>
  );
}
```

```ts
// app/api/consent/route.ts — Server Action to set consent
import { NextResponse } from 'next/server';
import { consent } from '../../../lib/consent';

export async function POST(request: Request) {
  const { choices } = await request.json();
  const cookieHeader = request.headers.get('cookie') ?? '';
  const setCookie = consent.set(choices, cookieHeader);

  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', setCookie);
  return res;
}
```

`getServerSnapshot()` always returns `{ decision: 'unset' }` during SSR, so hydration mismatches are impossible.

## API Reference

### `createConsentify(init)`

Returns a consent instance with flat top-level methods and `server`/`client` namespaces for advanced use.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `policy.categories` | `readonly string[]` | *required* | Consent categories (e.g., `['analytics', 'marketing']`) |
| `policy.identifier` | `string` | auto-hash | Stable policy version key. Changing it invalidates existing consent |
| `cookie.name` | `string` | `'consentify'` | Cookie name |
| `cookie.maxAgeSec` | `number` | `31536000` (1 year) | Cookie max-age in seconds |
| `cookie.sameSite` | `'Lax' \| 'Strict' \| 'None'` | `'Lax'` | SameSite attribute |
| `cookie.secure` | `boolean` | `true` | Secure flag (forced `true` when `sameSite: 'None'`) |
| `cookie.path` | `string` | `'/'` | Cookie path |
| `cookie.domain` | `string` | — | Cookie domain |
| `consentMaxAgeDays` | `number` | - | Auto-expire consent after N days |
| `mode` | `'opt-in' \| 'opt-out'` | `'opt-in'` | GDPR opt-in (deny by default) or CCPA opt-out (grant by default) |
| `expirationWarningDays` | `number` | `30` | Days before expiry to emit `'expiring'` event |
| `storage` | `StorageKind[]` | `['cookie']` | Client storage priority (`'cookie'`, `'localStorage'`) |

### Flat API (primary)

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `() => ConsentState<T>` | Current consent state (client-side) |
| `get` | `(cookieHeader: string) => ConsentState<T>` | Read consent from a `Cookie` header (server-side) |
| `isGranted` | `(category: string) => boolean` | Check a single category (client-side) |
| `set` | `(choices: Partial<Choices<T>>) => void` | Update consent choices (client-side) |
| `set` | `(choices: Partial<Choices<T>>, cookieHeader: string) => string` | Returns a `Set-Cookie` header string (server-side) |
| `clear` | `() => void` | Clear all consent data (client-side) |
| `clear` | `(serverMode: string) => string` | Returns a clearing `Set-Cookie` header (server-side) |
| `acceptAll` | `() => void` | Grant all user categories (client-side) |
| `acceptAll` | `(cookieHeader: string) => string` | Grant all, returns `Set-Cookie` header (server-side) |
| `rejectAll` | `() => void` | Deny all user categories; necessary stays `true` (client-side) |
| `rejectAll` | `(cookieHeader: string) => string` | Deny all, returns `Set-Cookie` header (server-side) |
| `getProof` | `() => ConsentProof<T> \| null` | Tamper-evident consent receipt for audit trails |
| `getProof` | `(cookieHeader: string) => ConsentProof<T> \| null` | Server-side consent proof |
| `guard` | `(category, onGrant, onRevoke?) => () => void` | Run code when consent is granted; optionally handle revocation. Returns a dispose function |
| `subscribe` | `(cb: () => void) => () => void` | Subscribe to changes (React-compatible) |
| `getServerSnapshot` | `() => ConsentState<T>` | Always returns `{ decision: 'unset' }` for SSR |
| `on` | `(type, handler) => () => void` | Subscribe to typed events (`'change'`, `'clear'`, `'expiring'`). Returns unsubscribe |
| `once` | `(type, handler) => () => void` | One-time event listener, auto-unsubscribes after first call |

### Server / Client Namespaces (advanced)

The `server` and `client` namespaces are still available for direct access:

| Method | Signature | Description |
|--------|-----------|-------------|
| `server.get` | `(cookieHeader: string \| null \| undefined) => ConsentState<T>` | Read consent from a `Cookie` header |
| `server.set` | `(choices: Partial<Choices<T>>, currentCookieHeader?: string) => string` | Returns a `Set-Cookie` header string |
| `server.clear` | `() => string` | Returns a clearing `Set-Cookie` header |
| `client.get` | `() => ConsentState<T>` | Current consent state |
| `client.get` | `(category: string) => boolean` | Check a single category |
| `client.set` | `(choices: Partial<Choices<T>>) => void` | Update consent choices |
| `client.clear` | `() => void` | Clear all consent data |
| `client.guard` | `(category, onGrant, onRevoke?) => () => void` | Guard with dispose |
| `client.subscribe` | `(cb: () => void) => () => void` | Subscribe to changes |
| `client.getServerSnapshot` | `() => ConsentState<T>` | Always `{ decision: 'unset' }` |

### `enableConsentMode(instance, options)`

Wires Google Consent Mode v2 to a consent instance. Returns a dispose function.

| Option | Type | Description |
|--------|------|-------------|
| `mapping` | `Partial<Record<category, GoogleConsentType[]>>` | Maps consent categories to Google consent types |
| `waitForUpdate` | `number` | Milliseconds to wait before applying defaults (optional) |

Google consent types: `ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`, `functionality_storage`, `personalization_storage`, `security_storage`.

### `enableDebug(instance, options?)`

Tree-shakeable debug adapter that logs consent changes. Unused imports are removed by bundlers.

```ts
import { enableDebug } from '@consentify/core';

const dispose = enableDebug(consent);
// [consentify] Consent changed { from: ..., to: ..., timestamp: ... }
// [consentify] Consent cleared { timestamp: ... }

// Custom logger
enableDebug(consent, {
  onLog: (message, event) => myLogger.info(message, event),
});
```

### Consentify Dev / Cloud reporting (built into core)

Cloud analytics now lives directly in `@consentify/core` — pass `siteId` to
`createConsentify` and the factory becomes async, fetches your SiteConfig from
the CDN, and starts event reporting automatically.

```ts
import { createConsentify } from '@consentify/core';

const consent = await createConsentify({
  siteId: 'your-site-id',
  apiKey: 'sk_live_...',  // optional
  // optional endpoint overrides:
  endpoints: {
    config: 'https://cdn.consentify.dev',
    ingest: 'https://ingest.consentify.dev',
  },
});
```

> **Note:** The separate `@consentify/cloud` package is deprecated as of
> `v2.0.0` and is a no-op. Remove it from your `package.json` and move the
> options to `createConsentify({ siteId, apiKey })`.

### Typed Events

Subscribe to consent lifecycle events with typed payloads:

```ts
consent.on('change', (event) => {
  console.log(event.from);      // previous ConsentState
  console.log(event.to);        // new ConsentState
  console.log(event.timestamp); // Date.now()
});

consent.on('clear', (event) => {
  console.log(event.timestamp);
});

// One-time listener
consent.once('change', (event) => {
  // fires once, then auto-unsubscribes
});

// Expiration warning (requires consentMaxAgeDays)
consent.on('expiring', (event) => {
  console.log(`Consent expires in ${event.daysRemaining.toFixed(0)} days`);
  // Show re-consent prompt
});
```

### Accept All / Reject All

Convenience methods that set all user categories at once:

```ts
consent.acceptAll();  // All categories true
consent.rejectAll();  // All categories false (necessary stays true)

// Server-side
const header = consent.acceptAll(cookieHeader);
```

### Consent Proof (Audit Trail)

Get a tamper-evident consent receipt for compliance records:

```ts
const proof = consent.getProof();
// { policy: '...', givenAt: '2026-...', choices: {...}, signature: 'a1b2c3d4' }

// Server-side
const proof = consent.getProof(cookieHeader);
```

### Consent Mode (opt-in / opt-out)

Configure default behavior per jurisdiction:

```ts
// GDPR (default): categories denied until user consents
const gdpr = createConsentify({
  policy: { categories: ['analytics'] as const },
  mode: 'opt-in',
});

// CCPA: categories granted until user opts out
const ccpa = createConsentify({
  policy: { categories: ['analytics'] as const },
  mode: 'opt-out',
});
ccpa.isGranted('analytics'); // true (default until user opts out)
```

### `useConsentify(instance, category?)` (React)

```ts
import { useConsentify } from '@consentify/react';

// Full state
const state = useConsentify(consent);
// state: { decision: 'unset' } | { decision: 'decided', snapshot: Snapshot<T> }

// Boolean for a single category
const analyticsGranted = useConsentify(consent, 'analytics');
// analyticsGranted: boolean
```

### Script Tag / IIFE

For non-bundled apps (WordPress, static sites), use the IIFE build:

```html
<script src="https://unpkg.com/@consentify/core/dist/consentify.iife.min.js"></script>
<script>
  var consent = Consentify.createConsentify({
    policy: { categories: ['analytics', 'marketing'] }
  });

  consent.guard('analytics', function() {
    // Load analytics script
  });
</script>
```

The IIFE bundle is 3.25kb gzipped and exposes all exports on the `Consentify` global.

### Policy Versioning

The `'necessary'` category is always `true` and cannot be disabled. When you change your `policy.categories` (or `policy.identifier`), all existing consent is automatically invalidated -- users will be prompted again.

## Packages

| Package | Description |
|---------|-------------|
| [@consentify/core](./packages/core) | Headless consent SDK -- TypeScript-first, SSR-safe, zero dependencies. Includes built-in Consentify Dev mode (`createConsentify({ siteId })`). |
| [@consentify/react](./packages/react) | React hook for @consentify/core |
| [create-consentify](./packages/create-consentify) | `npx` scaffolder -- wires the SDK into Next.js, Vite, Remix, Astro, or vanilla projects |
| ~~[@consentify/cloud](./packages/cloud)~~ | **Deprecated (v2.0.0, no-op shell).** Cloud functionality moved into `@consentify/core` Mode B. |

## Coming Soon: Consentify Dev

A hosted consent management platform -- the tool developers and marketers use
to configure policies, translate banners, and watch opt-in rates. It pairs
with this SDK via `createConsentify({ siteId })`.

- **Visual banner builder** -- drag-and-drop consent UI
- **Consent analytics dashboard** -- see opt-in/out rates
- **One-line integration** -- single script tag setup
- **Multi-language support** -- GDPR-compliant translations

[consentify.dev](https://consentify.dev)

## Roadmap

- Consentify Dev bidirectional sync -- fetch policy config from the dashboard
- Geo-aware consent defaults -- show banners only where required

## Support

If you find this project useful, consider supporting its development:

- [GitHub Sponsors](https://github.com/sponsors/RomanDenysov)
- [Ko-fi](https://ko-fi.com/romandenysov)

## License

MIT &copy; 2025 [Roman Denysov](https://github.com/RomanDenysov)
