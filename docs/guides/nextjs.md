# Next.js App Router Guide

Complete guide for integrating Consentify with Next.js App Router. Covers server-side consent reading, client-side banners, conditional rendering, Server Actions, and Google Consent Mode.

## Quick start

```bash
npx create-consentify@latest
```

Pick "Next.js (App Router)" and you're done — `lib/consent.ts`, `components/consent-provider.tsx`, GCM wiring, and dependencies are all set up. The rest of this guide explains what the scaffolder produces and how to extend it.

## Install (manual)

```bash
npm install @consentify/core @consentify/react
```

## 1. Shared consent instance

Create a single instance shared across server and client:

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
  expirationWarningDays: 30, // emit 'expiring' event 30 days before
});
```

This file is imported on both server and client. `createConsentify` is SSR-safe - it detects the environment automatically.

## 2. Server-side consent reading

Read consent state from the incoming cookie header in your layout:

```tsx
// app/layout.tsx
import { cookies } from 'next/headers';
import { consent } from '../lib/consent';
import { CookieBanner } from '../components/CookieBanner';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const state = consent.get({ cookieHeader: cookieStore.toString() });

  return (
    <html>
      <body>
        {children}
        <CookieBanner />
        {state.decision === 'decided' && state.snapshot.choices.analytics && (
          <AnalyticsScripts />
        )}
      </body>
    </html>
  );
}
```

Passing `{ cookieHeader }` switches `consent.get` to the server API - no browser globals needed. The same options object works for `isGranted`, `set`, `clear`, `acceptAll` and `rejectAll`.

## 3. Cookie banner (client component)

```tsx
// components/CookieBanner.tsx
'use client';

import { useConsentify } from '@consentify/react';
import { consent } from '../lib/consent';

export function CookieBanner() {
  const state = useConsentify(consent);

  if (state.decision === 'decided') return null;

  return (
    <div role="dialog" aria-label="Cookie consent" className="fixed bottom-0 inset-x-0 p-4 bg-white shadow-lg">
      <p>We use cookies to improve your experience.</p>
      <div className="flex gap-2 mt-2">
        <button onClick={() => consent.set({ analytics: true, marketing: true }, { source: 'banner' })}>
          Accept All
        </button>
        <button onClick={() => consent.set({ analytics: false, marketing: false }, { source: 'banner' })}>
          Reject All
        </button>
      </div>
    </div>
  );
}
```

`useConsentify` uses `useSyncExternalStore` - no Provider needed. During SSR it returns `{ decision: 'unset' }` via `getServerSnapshot()`, so hydration mismatches are impossible.

## 4. Conditional rendering with category overload

Use the boolean overload to conditionally render components based on a single category:

```tsx
// components/ConsentGate.tsx
'use client';

import { useConsentify } from '@consentify/react';
import { consent } from '../lib/consent';
import type { ReactNode } from 'react';

export function ConsentGate({
  category,
  children,
  fallback = null,
}: {
  category: 'analytics' | 'marketing';
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const granted = useConsentify(consent, category);
  return granted ? children : fallback;
}
```

Usage:

```tsx
<ConsentGate category="analytics" fallback={<p>Analytics requires consent</p>}>
  <AnalyticsDashboard />
</ConsentGate>
```

## 5. Server Action for setting consent

Alternative to an API route - use a Server Action to set the consent cookie:

```tsx
// app/actions.ts
'use server';

import { cookies } from 'next/headers';
import { parseSetCookie } from '@consentify/core';
import { consent } from '../lib/consent';

export async function setConsent(choices: Record<string, boolean>) {
  const cookieStore = await cookies();
  const header = consent.set(choices, { cookieHeader: cookieStore.toString() });

  // Apply the Set-Cookie header with the instance's own cookie config
  // (name, path, domain, Max-Age, SameSite, Secure). `value` is URI-encoded
  // and Next.js encodes values again, so decode it first.
  const { name, value, options } = parseSetCookie(header);
  cookieStore.set(name, value, options);
}
```

```tsx
// components/CookieBanner.tsx (Server Action version)
'use client';

import { setConsent } from '../app/actions';

export function CookieBanner() {
  // ... state check ...

  return (
    <div role="dialog" aria-label="Cookie consent">
      <button onClick={() => {
        consent.set({ analytics: true, marketing: true }, { source: 'banner' }); // client-side update
        setConsent({ analytics: true, marketing: true }); // server-side cookie
      }}>
        Accept All
      </button>
    </div>
  );
}
```

In most cases, the client-side `consent.set()` is sufficient - it writes the cookie directly. The Server Action approach is useful when you need server-side validation or logging. Here the action receives the cookie the client just wrote; since its call has no `source` and the choices are the same, it re-serializes that record instead of recording a second decision.

## 6. Load scripts with guard()

Use `guard()` in a client component to conditionally load third-party scripts:

```tsx
// components/AnalyticsScripts.tsx
'use client';

import { useEffect } from 'react';
import { consent } from '../lib/consent';
import { enableConsentMode, defaultConsentModeMapping } from '@consentify/core';

export function AnalyticsScripts() {
  useEffect(() => {
    // Wire Google Consent Mode
    enableConsentMode(consent, {
      mapping: defaultConsentModeMapping,
      waitForUpdate: 500,
    });

    // Load GA4 only when analytics is granted
    consent.guard('analytics', () => {
      const script = document.createElement('script');
      script.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX';
      script.async = true;
      document.head.appendChild(script);

      window.dataLayer = window.dataLayer || [];
      function gtag(...args: any[]) { window.dataLayer.push(arguments); }
      gtag('js', new Date());
      gtag('config', 'G-XXXXXXX');
    });

    // Load Meta Pixel only when marketing is granted
    consent.guard('marketing', () => {
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      script.onload = () => {
        window.fbq('init', 'YOUR_PIXEL_ID');
        window.fbq('track', 'PageView');
      };
      document.head.appendChild(script);
    });
  }, []);

  return null;
}
```

## 7. Middleware (optional)

Use middleware to read consent and set headers or redirect:

```ts
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { consent } from './lib/consent';

export function middleware(request: NextRequest) {
  const state = consent.get({ cookieHeader: request.headers.get('cookie') });

  const response = NextResponse.next();

  // Example: pass consent state as a header for downstream use
  response.headers.set(
    'x-consent-decided',
    state.decision === 'decided' ? 'true' : 'false',
  );

  return response;
}
```

## 8. Debug during development

```tsx
// app/layout.tsx (development only)
import { DebugConsent } from '../components/DebugConsent';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <DebugConsent />}
      </body>
    </html>
  );
}
```

```tsx
// components/DebugConsent.tsx
'use client';

import { useEffect } from 'react';
import { enableDebug } from '@consentify/core';
import { consent } from '../lib/consent';

export function DebugConsent() {
  useEffect(() => {
    const dispose = enableDebug(consent);
    return dispose;
  }, []);

  return null;
}
```

## 9. Accept All / Reject All

Simplified consent banner buttons:

```tsx
// components/CookieBanner.tsx
'use client';

import { useConsentify } from '@consentify/react';
import { consent } from '../lib/consent';

export function CookieBanner() {
  const state = useConsentify(consent);
  if (state.decision === 'decided') return null;

  return (
    <div role="dialog" aria-label="Cookie consent">
      <p>We use cookies to improve your experience.</p>
      <button onClick={() => consent.acceptAll({ source: 'banner' })}>Accept All</button>
      <button onClick={() => consent.rejectAll({ source: 'banner' })}>Reject All</button>
    </div>
  );
}
```

Server-side version (Server Actions):

```ts
// app/actions.ts
'use server';

import { cookies } from 'next/headers';
import { parseSetCookie } from '@consentify/core';
import { consent } from '../lib/consent';

export async function acceptAllConsent() {
  const cookieStore = await cookies();
  const header = consent.acceptAll({ cookieHeader: cookieStore.toString(), source: 'banner' });
  const { name, value, options } = parseSetCookie(header);
  cookieStore.set(name, value, options);
}
```

## 10. Consent Mode (opt-in / opt-out)

Configure per jurisdiction:

```ts
// lib/consent.ts
import { createConsentify } from '@consentify/core';

export const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
  mode: 'opt-in',          // GDPR: denied by default
  // mode: 'opt-out',      // CCPA: granted by default
  consentMaxAgeDays: 365,
  expirationWarningDays: 30,
});
```

## 11. Consent Proof for Compliance

Record tamper-evident consent receipts. Proofs are HMAC-signed with a server secret, so they are built on the server from the consent cookie; the browser instance has no `getProof`.

```ts
// lib/consent-signing.ts - import from server code only
import { createConsentify } from '@consentify/core';

// Same policy as lib/consent.ts, so the policy hash matches the cookie.
export const signingConsent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
  secret: process.env.CONSENT_SIGNING_SECRET!, // throws if this runs in a browser
});
```

```ts
// app/api/compliance/route.ts
import { signingConsent } from '../../../lib/consent-signing';

export async function POST(request: Request) {
  const proof = await signingConsent.getProof({ cookieHeader: request.headers.get('cookie') });
  if (proof) await db.consentProofs.insert(proof); // verify later with verifyProof(proof, secret)
  return new Response(null, { status: 204 });
}
```

```tsx
'use client';

import { useEffect } from 'react';
import { consent } from '../lib/consent';

export function ComplianceRecorder() {
  // The consent cookie travels with the request; the server signs what it reads.
  useEffect(() => consent.on('change', () => { fetch('/api/compliance', { method: 'POST' }); }), []);
  return null;
}
```

## 12. Expiration Warnings

Prompt users to re-consent before expiry:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { consent } from '../lib/consent';

export function ExpirationWarning() {
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    return consent.on('expiring', (e) => setDays(Math.round(e.daysRemaining)));
  }, []);

  if (days === null) return null;

  return (
    <div role="alert">
      <p>Your consent expires in {days} days.</p>
      <button onClick={() => { consent.acceptAll({ source: 'banner' }); setDays(null); }}>Renew</button>
    </div>
  );
}
```

## Key points

- **No Provider needed** - `useConsentify` works with direct instance imports
- **SSR-safe** - `getServerSnapshot()` returns `{ decision: 'unset' }` during SSR
- **No hydration mismatches** - server and client agree on initial state
- **Multi-tab sync** - consent changes in one tab automatically reflect in others via BroadcastChannel
- **Policy versioning** - changing categories or identifier invalidates existing consent
