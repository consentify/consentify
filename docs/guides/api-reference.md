# API Reference

Full reference for `@consentify/core` and `@consentify/react`. For a getting-started tour, see the [project README](../../README.md).

## `createConsentify(init)`

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
| `secret` | `string` | — | Enables HMAC-SHA256 signed `getProof()`. Highly recommended |
| `visitorId` | `string \| () => string \| Promise<string>` | auto | Stable visitor ID for adapters / cloud mode |
| `adapter` | `ConsentAdapter<T>` | — | Custom persistence backend |
| `siteId` | `string` | — | Cloud mode: auto-fetch SiteConfig + enable cloud reporting. Returns `Promise` |
| `apiKey` | `string` | — | Cloud mode: API key |
| `endpoints.config` | `string` | `cdn.consentify.dev` | Cloud mode: SiteConfig CDN |
| `endpoints.ingest` | `string` | `ingest.consentify.dev` | Cloud mode: ingest endpoint |

## Flat API (primary)

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

## Server / Client Namespaces (advanced)

The `server` and `client` namespaces are still available for direct access:

| Method | Signature | Description |
|--------|-----------|-------------|
| `server.get` | `(cookieHeader: string \| null \| undefined) => ConsentState<T>` | Read consent from a `Cookie` header |
| `server.set` | `(choices: Partial<Choices<T>>, currentCookieHeader?: string) => string` | Returns a `Set-Cookie` header string |
| `server.clear` | `() => string` | Returns a clearing `Set-Cookie` header |
| `client.get` | `() => ConsentState<T>` | Current consent state |
| `client.get` | `(category: string) => boolean` | Check a single category. **Deprecated in v2.5 — use `isGranted(category)`. Slated for removal in v3.** |
| `client.set` | `(choices: Partial<Choices<T>>) => void` | Update consent choices |
| `client.clear` | `() => void` | Clear all consent data |
| `client.guard` | `(category, onGrant, onRevoke?) => () => void` | Guard with dispose |
| `client.subscribe` | `(cb: () => void) => () => void` | Subscribe to changes |
| `client.getServerSnapshot` | `() => ConsentState<T>` | Always `{ decision: 'unset' }` |

## `enableConsentMode(instance, options)`

Wires Google Consent Mode v2 to a consent instance. Returns a dispose function.

| Option | Type | Description |
|--------|------|-------------|
| `mapping` | `Partial<Record<category, GoogleConsentType[]>>` | Maps consent categories to Google consent types |
| `waitForUpdate` | `number` | Milliseconds to wait before applying defaults (optional) |

Google consent types: `ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`, `functionality_storage`, `personalization_storage`, `security_storage`.

```ts
import { createConsentify, enableConsentMode, defaultConsentModeMapping } from '@consentify/core';

const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing', 'preferences'] as const },
});

const dispose = enableConsentMode(consent, {
  mapping: defaultConsentModeMapping,
  waitForUpdate: 500,
});
```

`enableConsentMode` automatically calls `gtag('consent', 'default', ...)` on init and `gtag('consent', 'update', ...)` whenever the user changes their choices. It bootstraps `dataLayer` and `gtag` if they don't exist.

Custom mapping:

```ts
enableConsentMode(consent, {
  mapping: {
    necessary: ['security_storage'],
    analytics: ['analytics_storage'],
    marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
  },
});
```

## `enableDebug(instance, options?)`

Tree-shakeable debug adapter that logs consent changes. Unused imports are removed by bundlers.

```ts
import { enableDebug } from '@consentify/core';

const dispose = enableDebug(consent);
// [consentify] Consent changed { from: ..., to: ..., timestamp: ... }
// [consentify] Consent cleared { timestamp: ... }

enableDebug(consent, {
  onLog: (message, event) => myLogger.info(message, event),
});
```

## Typed Events

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
});
```

## Accept All / Reject All

Convenience methods that set all user categories at once:

```ts
consent.acceptAll();  // All categories true
consent.rejectAll();  // All categories false (necessary stays true)

// Server-side
const header = consent.acceptAll(cookieHeader);
```

## Consent Proof (Audit Trail)

Get a tamper-evident consent receipt for compliance records:

```ts
const proof = consent.getProof();
// { policy: '...', givenAt: '2026-...', choices: {...}, signature: 'a1b2...' }

// Server-side
const proof = consent.getProof(cookieHeader);
```

### Signed vs unsigned

- When `createConsentify({ secret })` is provided, `getProof()` returns an HMAC-SHA256 signature. **This is the recommended path for any compliance use case.** `getProof()` becomes async in this mode (returns `Promise<ConsentProof<T> | null>`).
- Without a `secret`, `getProof()` falls back to a non-cryptographic FNV1a hash. This path is **forgeable** and is only suitable for local debugging. It emits a one-time `console.warn` when used. The unsigned return type is marked `@deprecated` and will return `null` in a future major release.

```ts
const consent = createConsentify({
  policy: { categories: ['analytics'] as const },
  secret: process.env.CONSENT_SIGNING_SECRET, // recommended
});

const proof = await consent.getProof();
```

## Consent Mode (opt-in / opt-out)

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

## `useConsentify(instance, category?)` (React)

```ts
import { useConsentify } from '@consentify/react';

// Full state
const state = useConsentify(consent);
// state: { decision: 'unset' } | { decision: 'decided', snapshot: Snapshot<T> }

// Boolean for a single category
const analyticsGranted = useConsentify(consent, 'analytics');
// analyticsGranted: boolean
```

## Script Tag / IIFE

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

The IIFE bundle is ~5kb gzipped and exposes all exports on the `Consentify` global.

### CSP nonce + SRI (recommended)

If your site uses a strict Content Security Policy, pin the integrity hash and forward a nonce from your server template:

```html
<script
  src="https://unpkg.com/@consentify/core@2/dist/consentify.iife.min.js"
  integrity="sha384-REPLACE_WITH_SRI_HASH"
  crossorigin="anonymous"
  nonce="%%CSP_NONCE%%"></script>
```

Pair this with a CSP header such as `script-src 'self' 'nonce-%%CSP_NONCE%%'`. Generate the SRI hash per version you pin (e.g. `openssl dgst -sha384 -binary dist/consentify.iife.min.js | openssl base64 -A`). See [MDN: Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) for details.

## Consentify Dev / Cloud reporting (built into core)

Cloud analytics lives directly in `@consentify/core` — pass `siteId` to `createConsentify` and the factory becomes async, fetches your SiteConfig from the CDN, and starts event reporting automatically.

```ts
import { createConsentify } from '@consentify/core';

const consent = await createConsentify({
  siteId: 'your-site-id',
  apiKey: 'sk_live_...',  // optional
  endpoints: {
    config: 'https://cdn.consentify.dev',
    ingest: 'https://ingest.consentify.dev',
  },
});
```

> **Note:** The separate `@consentify/cloud` package is deprecated as of `v2.0.0` and is a no-op. Remove it from your `package.json` and move the options to `createConsentify({ siteId, apiKey })`.

## Custom Adapters

Implement `ConsentAdapter<T>` to persist consent to your own backend:

```ts
import type { ConsentAdapter } from '@consentify/core';

type Cats = 'analytics' | 'marketing';

const dbAdapter: ConsentAdapter<Cats> = {
  async save({ visitorId, snapshot, proof }) {
    await db.consent.upsert({ visitorId, snapshot, proof });
  },
  async load(visitorId) {
    return await db.consent.findByVisitor(visitorId);
  },
};

const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
  adapter: dbAdapter,
});
```

`save` is awaited on every `set()` / `acceptAll()` / `rejectAll()`. `load` is called on startup to hydrate state for the current `visitorId`.

## Policy Versioning

The `'necessary'` category is always `true` and cannot be disabled. When you change your `policy.categories` (or `policy.identifier`), all existing consent is automatically invalidated — users will be prompted again.
