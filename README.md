<p align="center"><img src="./assets/banner.svg" alt="consentify" width="600"></p>

# consentify

**Headless cookie consent that actually blocks scripts.**

[![npm version](https://img.shields.io/npm/v/@consentify/core.svg)](https://www.npmjs.com/package/@consentify/core)
[![CI](https://github.com/consentify/consentify/actions/workflows/ci.yml/badge.svg)](https://github.com/consentify/consentify/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@consentify/core)](https://bundlephobia.com/package/@consentify/core)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/@consentify/core.svg)](https://github.com/consentify/consentify/blob/main/packages/core/LICENSE)

TypeScript-first, SSR-safe, zero-dependency consent management. Works on the server (Node.js headers), on the client (cookies/localStorage), and with React via `useSyncExternalStore` — no Provider required.

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

This is what consent management is actually for — preventing tracking scripts from loading until the user explicitly opts in. `guard()` handles the entire lifecycle: wait for consent, load the script, and optionally clean up if consent is revoked.

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

If the user has already consented, the script loads immediately. If not, `guard()` waits and fires once consent is granted — no manual `subscribe()` wiring needed.

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
  consent.acceptAll();
});

document.getElementById('reject-all')?.addEventListener('click', () => {
  consent.rejectAll();
});

document.getElementById('reset')?.addEventListener('click', () => {
  consent.clear();
  window.location.reload();
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
      <button onClick={() => consent.acceptAll()}>Accept All</button>
      <button onClick={() => consent.rejectAll()}>Reject All</button>
    </div>
  );
}
```

No Provider or Context needed. `useConsentify` is powered by `useSyncExternalStore` — it subscribes directly to the consent instance and re-renders on changes.

## SSR / Next.js

Consentify is SSR-safe out of the box. The server API reads and writes consent via raw `Cookie` / `Set-Cookie` headers — no DOM required.

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

## Google Consent Mode v2

Built-in support for Google Consent Mode v2. No extra package needed.

```ts
import { createConsentify, enableConsentMode, defaultConsentModeMapping } from '@consentify/core';

const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing', 'preferences'] as const },
});

enableConsentMode(consent, {
  mapping: defaultConsentModeMapping,
  waitForUpdate: 500,
});
```

See [Google Consent Mode v2 in the API reference](./docs/guides/api-reference.md#enableconsentmodeinstance-options) for custom mappings and advanced options.

## Full API Reference

The primary APIs above cover most integrations. For tables, the `server` / `client` namespaces, typed events, `getProof` details, custom adapters, cloud reporting, IIFE + CSP/SRI guidance, and everything else, see:

- **[API Reference](./docs/guides/api-reference.md)** — every method, option, and type
- **[Next.js Guide](./docs/guides/nextjs.md)** — App Router, Server Components, Route Handlers
- **[Vue 3 Guide](./docs/guides/vue.md)** — composables, reactive state, conditional rendering
- **[Svelte Guide](./docs/guides/svelte.md)** — stores, reactive declarations, SSR with SvelteKit
- **[Solid.js Guide](./docs/guides/solid.md)** — signals, effects, cleanup patterns

## Packages

| Package | Description |
|---------|-------------|
| [@consentify/core](./packages/core) | Headless consent SDK — TypeScript-first, SSR-safe, zero dependencies. Includes built-in Consentify Dev mode (`createConsentify({ siteId })`, hosted platform not live yet). |
| [@consentify/react](./packages/react) | React hook for `@consentify/core` |
| [create-consentify](./packages/create-consentify) | `npx` scaffolder — wires the SDK into Next.js, Vite, Remix, Astro, or vanilla projects |
| ~~[@consentify/cloud](./packages/cloud)~~ | **Deprecated (v2.0.0, no-op shell).** Cloud functionality moved into `@consentify/core`. |

## How it compares

| | Consentify | Banner libraries¹ | SaaS CMPs² |
|---|-----------|-------------------|------------|
| **Approach** | Headless SDK — you own the UI | Bundled, configurable banner | Hosted widget + dashboard |
| **Server / SSR API** | Yes — raw `Cookie` / `Set-Cookie` headers | No — browser-only | No — browser-only script |
| **TypeScript-first** | Yes — typed categories end-to-end | Varies | No SDK |
| **Bundle size** | < 5 kB gzipped, enforced in CI | up to ~150 kB | External hosted script |
| **Google Consent Mode v2** | Built-in (`enableConsentMode`) | Manual wiring | Usually built-in |
| **Cost** | Free (MIT) | Free (MIT) | ~$30–$1,100+/month |

¹ vanilla-cookieconsent, Klaro, Osano cookieconsent &nbsp;·&nbsp; ² OneTrust, Cookiebot, CookieYes

The closest project in spirit is **c15t** — also headless and TypeScript-based. Consentify differentiates on the server-side header API (SSR without a consent flash), the enforced < 5 kB budget, and zero runtime dependencies.

## Non-goals

- **Not a TCF 2.2 CMP** — IAB Transparency & Consent Framework support would multiply bundle size. Publishers running programmatic advertising requiring a TCF CMP should use a dedicated solution; Consentify works alongside them.
- **No bundled banner UI in core** — Consentify is headless by design. UI components live in your codebase or the hosted platform; this keeps core minimal and lets you own your UX.
- **No per-script auto-blocking** — Don't use Consentify to scan and rewrite `<script>` tags. Use `guard()` to conditionally load your own scripts; this gives you full control and better performance.

## Coming Soon: Consentify Dev

A hosted consent management platform — the tool developers and marketers use to configure policies, translate banners, and watch opt-in rates. It pairs with this SDK via `createConsentify({ siteId })`.

> **Not live yet.** Until launch, `createConsentify({ siteId })` will fail against the default endpoints — use self-hosted mode (`policy`) today.

- **Visual banner builder** — drag-and-drop consent UI
- **Consent analytics dashboard** — see opt-in/out rates
- **One-line integration** — single script tag setup
- **Multi-language support** — GDPR-compliant translations

[consentify.dev](https://consentify.dev)

## Support

If you find this project useful, consider supporting its development:

- [GitHub Sponsors](https://github.com/sponsors/RomanDenysov)
- [Ko-fi](https://ko-fi.com/romandenysov)

## License

MIT &copy; 2025 [Roman Denysov](https://github.com/RomanDenysov)
