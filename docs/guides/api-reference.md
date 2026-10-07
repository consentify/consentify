# API Reference

Full reference for `@consentify/core` and `@consentify/react`. For a getting-started tour, see the [project README](../../README.md).

## `createConsentify(init)`

Returns a consent instance with flat top-level methods and `server`/`client` namespaces for advanced use.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `policy.categories` | `readonly string[]` | *required* | Consent categories (e.g., `['analytics', 'marketing']`) |
| `policy.identifier` | `string` | auto-hash | Stable policy version key. Changing it invalidates existing consent |
| `cookie.name` | `string` | `'consentify'` | Cookie name |
| `cookie.maxAgeSec` | `number` | `consentMaxAgeDays * 86400` if set, else `31536000` (1 year) | Cookie max-age in seconds. An explicit value always wins |
| `cookie.sameSite` | `'Lax' \| 'Strict' \| 'None'` | `'Lax'` | SameSite attribute |
| `cookie.secure` | `boolean` | `true` | Secure flag (forced `true` when `sameSite: 'None'` or `partitioned: true`) |
| `cookie.path` | `string` | `'/'` | Cookie path |
| `cookie.domain` | `string` | — | Cookie domain |
| `cookie.partitioned` | `boolean` | `false` | Adds the CHIPS `Partitioned` attribute (forces `Secure`). Use when the SDK runs in an embedded / third-party iframe |
| `consentMaxAgeDays` | `number` | - | Auto-expire consent after N days. Also sets the cookie Max-Age unless `cookie.maxAgeSec` is given |
| `mode` | `'opt-in' \| 'opt-out'` | `'opt-in'` | GDPR opt-in (deny by default) or CCPA opt-out (grant by default) |
| `expirationWarningDays` | `number` | `30` | Days before expiry to emit `'expiring'` event |
| `storage` | `StorageKind[]` | `['cookie']` | Client storage priority (`'cookie'`, `'localStorage'`) |
| `secret` | `string` | — | Server-only. Adds an async, HMAC-SHA256 signed `getProof()` and passes a signed `proof` to `adapter.save()`. Throws `ConsentifyConfigError` in a browser |
| `visitorId` | `string \| () => string \| Promise<string>` | auto | Visitor ID for the adapter and cloud events. When set, it is used for every decision, `reject_all` included. Default: a random id in localStorage (`consentify_visitor`), created only after a decision (`adapter.save()`, cloud `accept_all` / `customize`); a cloud `reject_all` deletes it and sends a one-off token. See [visitor ID](./cloud-privacy.md#visitor-id) |
| `adapter` | `ConsentAdapter<T>` | — | Custom persistence backend |

`createConsentify` is self-hosted only. Cloud mode lives in [`createCloudConsentify`](#createcloudconsentifyinit--consentifycorecloud) from `@consentify/core/cloud`; passing `siteId` here is a type error and throws `ConsentifyConfigError` at runtime.

## Flat API (primary)

Without a trailing argument the flat methods use the browser store. Passing a `ServerOptions` object, `{ cookieHeader?: string | null }`, switches them to server mode: they read the given `Cookie` header and return `Set-Cookie` strings instead of writing anything. Any object counts, so `clear({})` is server mode; a missing, empty or `null` `cookieHeader` means no consent yet.

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `() => ConsentState<T>` | Current consent state (client-side) |
| `get` | `(opts: ServerOptions) => ConsentState<T>` | Read consent from `opts.cookieHeader` (server-side) |
| `isGranted` | `(category) => boolean` | Check a single category (client-side). Unset consent follows `mode`: `false` for opt-in, `true` for opt-out |
| `isGranted` | `(category, opts: ServerOptions) => boolean` | Same check against `opts.cookieHeader` (server-side) |
| `set` | `(choices: Partial<Choices<T>>) => void` | Update consent choices (client-side) |
| `set` | `(choices: Partial<Choices<T>>, opts: ServerOptions) => string` | Merges into the consent in `opts.cookieHeader`, returns a `Set-Cookie` header (server-side) |
| `clear` | `() => void` | Clear all consent data (client-side) |
| `clear` | `(opts: ServerOptions) => string` | Returns a clearing (`Max-Age=0`) `Set-Cookie` header (server-side) |
| `acceptAll` | `() => void` | Grant all user categories (client-side) |
| `acceptAll` | `(opts: ServerOptions) => string` | Grant all, returns `Set-Cookie` header (server-side) |
| `rejectAll` | `() => void` | Deny all user categories; necessary stays `true` (client-side) |
| `rejectAll` | `(opts: ServerOptions) => string` | Deny all, returns `Set-Cookie` header (server-side) |
| `getProof` | `(opts?: ServerOptions) => Promise<ConsentProof<T> \| null>` | Only on instances created with `secret` (server-only). HMAC-SHA256 signed consent receipt; see [Consent Proof](#consent-proof-audit-trail) |
| `guard` | `(category, onGrant, onRevoke?) => () => void` | Run code when consent is granted; optionally handle revocation. Returns a dispose function. With `onRevoke`, the guard re-arms after each revoke (grant → `onGrant`, revoke → `onRevoke`, repeated) until disposed. Without `onRevoke`, `onGrant` runs once and the guard stops watching |
| `subscribe` | `(cb: () => void) => () => void` | Subscribe to changes (React-compatible) |
| `getServerSnapshot` | `() => ConsentState<T>` | Always returns `{ decision: 'unset' }` for SSR |
| `on` | `(type, handler) => () => void` | Subscribe to typed events (`'change'`, `'clear'`, `'expiring'`). Returns unsubscribe |
| `once` | `(type, handler) => () => void` | One-time event listener, auto-unsubscribes after first call |
| `destroy` | `() => void` | Release the BroadcastChannel and clear all listeners and event handlers. Instance remains readable but no longer reactive. Safe to call multiple times. Useful for tests, HMR, and micro-frontends. |

## Server / Client Namespaces (advanced)

The `server` and `client` namespaces are still available as the low-level explicit API:

| Method | Signature | Description |
|--------|-----------|-------------|
| `server.get` | `(cookieHeader: string \| null \| undefined) => ConsentState<T>` | Read consent from a `Cookie` header |
| `server.set` | `(choices: Partial<Choices<T>>, currentCookieHeader?: string) => string` | Returns a `Set-Cookie` header string |
| `server.clear` | `() => string` | Returns a clearing `Set-Cookie` header |
| `client.get` | `() => ConsentState<T>` | Current consent state. Use `isGranted(category)` for a single category |
| `client.set` | `(choices: Partial<Choices<T>>) => void` | Update consent choices |
| `client.clear` | `() => void` | Clear all consent data |
| `client.guard` | `(category, onGrant, onRevoke?) => () => void` | Guard with dispose |
| `client.subscribe` | `(cb: () => void) => () => void` | Subscribe to changes |
| `client.getServerSnapshot` | `() => ConsentState<T>` | Always `{ decision: 'unset' }` |

## `parseSetCookie(header)`

Pure helper that splits a `Set-Cookie` header returned by the server API (`set`, `clear`, `acceptAll`, `rejectAll`) into `{ name, value, options }` for framework cookie setters. `options` carries the instance's cookie config as `{ path?, maxAge?, domain?, sameSite?, secure?, partitioned? }` with lowercase `sameSite` and `maxAge` in seconds; absent attributes are omitted. `value` is URI-decoded, so it can go straight into setters that encode values themselves (Next.js, SvelteKit, Express).

```ts
import { cookies } from 'next/headers';
import { parseSetCookie } from '@consentify/core';

const cookieStore = await cookies();
const { name, value, options } = parseSetCookie(consent.acceptAll({ cookieHeader: cookieStore.toString() }));
cookieStore.set(name, value, options);
```

## `enableConsentMode(instance, options)`

Wires Google Consent Mode v2 to a consent instance. Returns a dispose function.

| Option | Type | Description |
|--------|------|-------------|
| `mapping` | `Partial<Record<category, GoogleConsentType[]>>` | Maps consent categories to Google consent types |
| `waitForUpdate` | `number` | Milliseconds Google waits for an update after the default (optional, sent only with the default) |
| `sendDefault` | `boolean` | Send `gtag('consent', 'default', ...)` on init. Default `true`. Set `false` when a `<head>` snippet already sent that default; updates still fire |

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

`enableConsentMode` calls `gtag('consent', 'default', ...)` on init unless `sendDefault` is `false`, and `gtag('consent', 'update', ...)` whenever the user changes their choices. It bootstraps `dataLayer` and `gtag` if they don't exist. Google wants the default in the first `<head>` script, before tags run. When that snippet is in place, pass `sendDefault: false` so the default is sent once.

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

`'change'` and `'clear'` also fire when the consent state changes in **another tab** (via `BroadcastChannel`), so event handlers stay consistent with `subscribe()`/`guard()` across tabs.

> **Note:** `'expiring'` is evaluated on init and on consent writes (including cross-tab syncs) — not on a timer. A tab left open across the warning threshold will see the event on its next state change or reload.

## Accept All / Reject All

Convenience methods that set all user categories at once:

```ts
consent.acceptAll();  // All categories true
consent.rejectAll();  // All categories false (necessary stays true)

// Server-side: pass the request's Cookie header, get a Set-Cookie header back
const header = consent.acceptAll({ cookieHeader });
```

## Consent Proof (Audit Trail)

Tamper-evident consent receipts are HMAC-SHA256 signed and server-only. Create an instance with a `secret` in server code (it throws `ConsentifyConfigError` in a browser, where the secret would leak); that instance has an async `getProof()`. Instances without a `secret` have no `getProof` at all, because an unsigned receipt could be forged by anyone.

```ts
// server code only
import { createConsentify, verifyProof } from '@consentify/core';

const consent = createConsentify({
  policy: { categories: ['analytics'] as const },
  secret: process.env.CONSENT_SIGNING_SECRET!,
});

const proof = await consent.getProof({ cookieHeader: request.headers.get('cookie') });
// { policy: '...', givenAt: '2026-...', choices: {...}, signature: '<64 hex chars>' } or null when unset

await verifyProof(proof!, process.env.CONSENT_SIGNING_SECRET!); // true; false if any field was altered
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

The IIFE bundle is ~4.3kb gzipped and exposes all exports on the `Consentify` global. It is self-hosted only; for cloud mode load `dist/consentify-cloud.iife.min.js` instead (~5.6kb gzipped), which exposes the same exports plus `Consentify.createCloudConsentify` (see [below](#createcloudconsentifyinit--consentifycorecloud)).

### CSP nonce + SRI (recommended)

If your site uses a strict Content Security Policy, pin the integrity hash and forward a nonce from your server template:

```html
<script
  src="https://unpkg.com/@consentify/core@3/dist/consentify.iife.min.js"
  integrity="sha384-REPLACE_WITH_SRI_HASH"
  crossorigin="anonymous"
  nonce="%%CSP_NONCE%%"></script>
```

Pair this with a CSP header such as `script-src 'self' 'nonce-%%CSP_NONCE%%'`. Generate the SRI hash per version you pin (e.g. `openssl dgst -sha384 -binary dist/consentify.iife.min.js | openssl base64 -A`). See [MDN: Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) for details.

## `createCloudConsentify(init)` — `@consentify/core/cloud`

> **⚠️ Not live yet:** The hosted Consentify Dev platform (`cdn.consentify.dev` / `ingest.consentify.dev`) has not launched. Until it does, `createCloudConsentify({ siteId, fallback })` against the default endpoints cannot fetch a SiteConfig and runs on your `fallback` policy (`consent.cloud.source === 'fallback'`). Use self-hosted mode (`createConsentify({ policy })`) today, or point `endpoints` at your own infrastructure.

Cloud (SaaS) mode ships as a separate entry point so self-hosted apps never bundle it. The factory is async: it loads your SiteConfig (from cache, the CDN, or your local `fallback`), derives `policy` and `mode` from it, and starts event reporting automatically (browser only). It resolves to the same instance type as `createConsentify`, plus a `cloud` property.

```ts
import { createCloudConsentify } from '@consentify/core/cloud';

const consent = await createCloudConsentify({
  siteId: 'your-site-id',
  apiKey: 'sk_live_...',  // optional
  // Required: used when the CDN is unreachable and nothing is cached.
  fallback: {
    categories: ['analytics', 'marketing'],
    identifier: 'your-published-policy-identifier',
  },
  endpoints: {
    config: 'https://cdn.consentify.dev',
    ingest: 'https://ingest.consentify.dev',
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `siteId` | `string` | *required* | Site whose SiteConfig is fetched and to which events are reported |
| `fallback` | `{ categories: readonly string[]; identifier?: string; mode?: ConsentMode; consentMaxAgeDays?: number }` | *required* | Local policy used when no SiteConfig is available (network error, timeout, non-OK status, malformed config) and nothing is cached. Set `identifier` to the site's published `policyIdentifier`; otherwise returning visitors see the banner again while the fallback is active |
| `timeoutMs` | `number` | `3000` | Deadline for the whole two-hop SiteConfig fetch; the requests are aborted when it passes |
| `configTtlSec` | `number` | `3600` | How long a cached SiteConfig is used without a request. After that it is served stale and refreshed in the background |
| `apiKey` | `string` | — | API key sent with ingest events |
| `endpoints.config` | `string` | `https://cdn.consentify.dev` | SiteConfig CDN |
| `endpoints.ingest` | `string` | `https://ingest.consentify.dev` | Ingest endpoint |
| `mode`, `consentMaxAgeDays` | | from SiteConfig | Local values override the SiteConfig (or `fallback`) |
| `cookie`, `expirationWarningDays`, `storage`, `secret`, `adapter`, `visitorId` | | | Same as [`createConsentify`](#createconsentifyinit) |

`policy` is not accepted: categories and the policy identifier come from the SiteConfig. With `secret` (server-only) it resolves to an instance whose `getProof()` is HMAC-signed. The `CloudInit`, `CloudFallback`, `CloudInfo`, `SiteConfig` and `SiteConfigSource` types are exported from `@consentify/core/cloud`. Core and cloud share one copy of the core code, so `ConsentifyConfigError` from `@consentify/core` matches errors thrown by the cloud factory.

#### SiteConfig loading, caching and offline behavior

The SiteConfig comes from two CDN files: `/config/<siteId>/latest.json` (short CDN TTL) names the current hash, and `/config/<siteId>/<hash>.json` is immutable.

- **Browser:** the result is cached in `localStorage` under `consentify_cfg_<siteId>` as `{ t, h, c }` (fetch time, hash, SiteConfig). A fresh entry (younger than `configTtlSec`) is used without any request. A stale entry is used immediately and refreshed in the background; the refresh updates the cache only, so the running instance keeps its policy and the next page load picks up the new one. Revalidation skips the second request when `latest.json` still names the cached hash.
- **Server (SSR):** the same TTL and stale-while-revalidate rules apply to an in-module cache keyed by `endpoint|siteId`, and concurrent calls share one in-flight request, so renders do not fetch per request.
- **Offline / CDN outage:** a cached SiteConfig (fresh or stale) keeps working. With no cache, the instance is built from `fallback` and one `console.warn` is logged. The factory does not reject for network or SiteConfig problems; it only rejects with `ConsentifyConfigError` when `fallback.categories` is missing.

The returned instance exposes the outcome for debugging:

```ts
consent.cloud.source; // 'network' | 'cache' | 'stale' | 'fallback'
consent.cloud.config; // the SiteConfig in use ({ categories, policyIdentifier, mode?, consentMaxAgeDays? })
```

When `source` is `'fallback'`, `config` is your `fallback` in SiteConfig shape (`policyIdentifier` is `fallback.identifier`, or the category hash when it is omitted).

Script-tag sites use the cloud IIFE, which exposes every core export plus `createCloudConsentify` on the `Consentify` global:

```html
<script src="https://unpkg.com/@consentify/core@3/dist/consentify-cloud.iife.min.js"></script>
<script>
  Consentify.createCloudConsentify({
    siteId: 'your-site-id',
    fallback: { categories: ['analytics'], identifier: 'your-published-policy-identifier' },
  }).then(function (consent) {
    consent.guard('analytics', function () {
      // Load analytics script
    });
  });
</script>
```

### Migrating to v3: cloud mode

`createConsentify` no longer accepts `siteId`. Import the cloud factory from the subpath and add the now-required `fallback`:

```diff
- import { createConsentify } from '@consentify/core';
- const consent = await createConsentify({ siteId: 'your-site-id', apiKey: 'sk_live_...' });
+ import { createCloudConsentify } from '@consentify/core/cloud';
+ const consent = await createCloudConsentify({
+   siteId: 'your-site-id',
+   apiKey: 'sk_live_...',
+   fallback: { categories: ['analytics', 'marketing'], identifier: 'your-published-policy-identifier' },
+ });
```

A CDN failure no longer rejects the factory: code that caught `ConsentifyConfigError` around it to fall back to a local policy can rely on `fallback` instead.

Script-tag users switch from `dist/consentify.iife.min.js` to `dist/consentify-cloud.iife.min.js` and call `Consentify.createCloudConsentify(...)`.

> **Note:** The separate `@consentify/cloud` package is deprecated as of `v2.0.0` and is a no-op. Remove it from your `package.json` and use `createCloudConsentify({ siteId, apiKey })` from `@consentify/core/cloud`.

### Migrating to v3: server API and proofs

Server mode is now selected by an options object instead of a bare string, the unsigned proof fallback is gone, and `client.get(category)` is removed:

| v2 | v3 |
|----|----|
| `consent.get(cookieHeader)` | `consent.get({ cookieHeader })` |
| `consent.get(null)` | `consent.get()` (client) or `consent.get({ cookieHeader: null })` (server) |
| — | `consent.isGranted('analytics', { cookieHeader })` (server; follows `mode` when unset) |
| `consent.set(choices, cookieHeader)` | `consent.set(choices, { cookieHeader })` |
| `consent.clear('anything')` | `consent.clear({})` |
| `consent.acceptAll(cookieHeader)` / `consent.rejectAll(cookieHeader)` | `consent.acceptAll({ cookieHeader })` / `consent.rejectAll({ cookieHeader })` |
| `consent.getProof()` without `secret` (FNV1a, forgeable) | Removed. Create a server instance with `secret` and call `await consent.getProof({ cookieHeader })` |
| `consent.getProof(cookieHeader)` with `secret` | `await consent.getProof({ cookieHeader })` |
| `consent.client.get('analytics')` | `consent.isGranted('analytics')` |
| `adapter.save({ visitorId, snapshot, proof })`, `proof` always set | `proof` is optional: present only when the instance has a `secret` |

`cookieHeader` may be a string, `null` or missing, so `request.headers.get('cookie')` can be passed as is. The `consent.server.*` namespace keeps its v2 signatures.

## Custom Adapters

Implement `ConsentAdapter<T>` to persist consent to your own backend:

```ts
import type { ConsentAdapter } from '@consentify/core';

type Cats = 'analytics' | 'marketing';

const dbAdapter: ConsentAdapter<Cats> = {
  async save({ visitorId, snapshot, proof }) {
    // `proof` is only set when the instance was created with a `secret` (server side)
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

`save` is awaited on every `set()` / `acceptAll()` / `rejectAll()`. `load` is called on startup to hydrate state for the current `visitorId`; without an explicit `visitorId` it is skipped until an id is stored (a first-time visitor has nothing to load).

## Policy Versioning

The `'necessary'` category is always `true` and cannot be disabled. When you change your `policy.categories` (or `policy.identifier`), all existing consent is automatically invalidated — users will be prompted again.
