# API Reference

Full reference for `@consentify/core` and `@consentify/react`. For a getting-started tour, see the [project README](../../README.md).

## `createConsentify(init)`

Returns a consent instance with flat top-level methods and `server`/`client` namespaces for advanced use.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `policy.categories` | `readonly string[]` | *required* | Consent categories (e.g., `['analytics', 'marketing']`) |
| `policy.identifier` | `string` | auto-hash | Stable policy version key. Changing it invalidates existing consent |
| `policy.textVersion` | `string` | — | Version of the policy text shown to the user, stored as `pv` on every new [consent record](#consent-record). Does not invalidate existing consent |
| `lang` | `string` | `<html lang>` (browser) | Language of the consent UI, stored as `lang` on every new consent record. A per-call `lang` overrides it |
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

Without a trailing argument the flat methods use the browser store. Passing a `ServerOptions` object, `{ cookieHeader: string | null | undefined }`, switches them to server mode: they read the given `Cookie` header and return `Set-Cookie` strings instead of writing anything. The `cookieHeader` key is what selects server mode, so pass it even when there is no cookie: an `undefined`, empty or `null` value means no consent yet, while an object without the key (such as `{ source: 'banner' }`) is a client call.

`set`, `acceptAll` and `rejectAll` also take `WriteOptions`, `{ source?: ConsentSource; lang?: string }`, which are stored on the [consent record](#consent-record). On the server, combine them with the header: `acceptAll({ cookieHeader, source: 'banner' })`.

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `() => ConsentState<T>` | Current consent state (client-side) |
| `get` | `(opts: ServerOptions) => ConsentState<T>` | Read consent from `opts.cookieHeader` (server-side) |
| `isGranted` | `(category) => boolean` | Check a single category (client-side). Unset consent follows `mode`: `false` for opt-in, `true` for opt-out |
| `isGranted` | `(category, opts: ServerOptions) => boolean` | Same check against `opts.cookieHeader` (server-side) |
| `set` | `(choices: Partial<Choices<T>>, opts?: WriteOptions) => void` | Update consent choices (client-side) |
| `set` | `(choices: Partial<Choices<T>>, opts: ServerOptions & WriteOptions) => string` | Merges into the consent in `opts.cookieHeader`, returns a `Set-Cookie` header (server-side) |
| `clear` | `() => void` | Clear all consent data (client-side) |
| `clear` | `(opts: ServerOptions) => string` | Returns a clearing (`Max-Age=0`) `Set-Cookie` header (server-side) |
| `acceptAll` | `(opts?: WriteOptions) => void` | Grant all user categories (client-side) |
| `acceptAll` | `(opts: ServerOptions & WriteOptions) => string` | Grant all, returns `Set-Cookie` header (server-side) |
| `rejectAll` | `(opts?: WriteOptions) => void` | Deny all user categories; necessary stays `true` (client-side) |
| `rejectAll` | `(opts: ServerOptions & WriteOptions) => string` | Deny all, returns `Set-Cookie` header (server-side) |
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
| `server.set` | `(choices: Partial<Choices<T>>, currentCookieHeader?: string \| null, opts?: WriteOptions) => string` | Returns a `Set-Cookie` header string |
| `server.clear` | `() => string` | Returns a clearing `Set-Cookie` header |
| `client.get` | `() => ConsentState<T>` | Current consent state. Use `isGranted(category)` for a single category |
| `client.set` | `(choices: Partial<Choices<T>>, opts?: WriteOptions) => void` | Update consent choices |
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

// Record which UI the decision came from
consent.acceptAll({ source: 'banner' });

// Server-side: pass the request's Cookie header, get a Set-Cookie header back
const header = consent.acceptAll({ cookieHeader });
```

## Consent Record

Each decision is stored as a `Snapshot<T>` (the `snapshot` in `ConsentState`), which is also what `'change'` events and `adapter.save()` receive. Keys are short because the record lives in a cookie:

```ts
type ConsentSource = 'banner' | 'preferences' | 'api';

interface Snapshot<T> {
  v?: 2;               // record format: 2 on every new record, absent on v1 records
  id?: string;         // random id of the decision (12 hex chars): on every new record, absent on v1 records
  policy: string;      // policy.identifier or category hash
  givenAt: string;     // ISO timestamp
  choices: Choices<T>; // { necessary: true, ...categories }
  pv?: string;         // policy.textVersion
  lang?: string;       // per-call lang, else init lang, else <html lang> (browser writes)
  src?: ConsentSource; // per-call source
}
```

Optional keys are omitted when unset. `id` identifies the decision: every new record, client or server, gets a fresh random one, so two decisions in the same millisecond stay distinct (the cloud reporter and the ingest use it to deduplicate). Metadata belongs to one decision: a server `set` merges `choices` from the existing cookie, but `pv`, `lang` and `src` come only from the current call and the init options. Server writes never read `<html lang>`; pass `lang` explicitly there.

```ts
consent.set({ analytics: true }, { source: 'preferences', lang: 'de' });
consent.get(); // { decision: 'decided', snapshot: { v: 2, id, policy, givenAt, choices, lang: 'de', src: 'preferences' } }
```

Records written by v2.x (no `v`, no `id`) are still read: with a matching policy they stay `decided`, unchanged, and the next write stores a v2 record. Any other `v`, a non-string `id` / `pv` / `lang`, or an unknown `src` makes the record invalid (treated as unset).

Whether the user accepted all, rejected all or customised is not stored; it follows from `choices` and the policy's categories.

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
// { v: 2, id: '...', policy: '...', givenAt: '2026-...', choices: {...}, src: 'banner', signature: '<64 hex chars>' } or null when unset

await verifyProof(proof!, process.env.CONSENT_SIGNING_SECRET!); // true; false if any field was altered
```

The signature covers `policy`, `givenAt`, `choices` and, when present, `id`, `v`, `pv`, `lang` and `src`; other keys on a stored proof are ignored. Proofs of v1 records (including proofs issued by v2.x) have none of the new fields and still verify.

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

The IIFE bundle is ~4.4kb gzipped and exposes all exports on the `Consentify` global. It is self-hosted only; for cloud mode load `dist/consentify-cloud.iife.min.js` instead (~6.1kb gzipped), which exposes the same exports plus `Consentify.createCloudConsentify` (see [below](#createcloudconsentifyinit--consentifycorecloud)).

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
  publicKey: 'pk_live_...', // optional; sent as the X-Consentify-Key header
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
| `fallback` | `{ categories: readonly string[]; identifier?: string; textVersion?: string; mode?: ConsentMode; consentMaxAgeDays?: number }` | *required* | Local policy used when no SiteConfig is available (network error, timeout, non-OK status, malformed config) and nothing is cached. Set `identifier` to the site's published `policyIdentifier`; otherwise returning visitors see the banner again while the fallback is active. `textVersion` is recorded as `pv` while the fallback is in use |
| `timeoutMs` | `number` | `3000` | Deadline for the whole two-hop SiteConfig fetch; the requests are aborted when it passes |
| `configTtlSec` | `number` | `3600` | How long a cached SiteConfig is used without a request. After that it is served stale and refreshed in the background |
| `publicKey` | `string` | — | Public key of the site. Sent only as the `X-Consentify-Key` header of browser events, never in the body. Not a secret: it ships in your client bundle |
| `endpoints.config` | `string` | `https://cdn.consentify.dev` | SiteConfig CDN |
| `endpoints.ingest` | `string` | `https://ingest.consentify.dev` | Ingest endpoint |
| `mode`, `consentMaxAgeDays` | | from SiteConfig | Local values override the SiteConfig (or `fallback`) |
| `cookie`, `expirationWarningDays`, `storage`, `lang`, `secret`, `adapter`, `visitorId` | | | Same as [`createConsentify`](#createconsentifyinit) |

`policy` is not accepted: categories, the policy identifier and the policy text version (`policyTextVersion`, recorded as `pv` on every new record) come from the SiteConfig. With `secret` (server-only) it resolves to an instance whose `getProof()` is HMAC-signed. The `CloudInit`, `CloudFallback`, `CloudInfo`, `SiteConfig`, `SiteConfigSource`, `Vendor`, `IngestEvent` and `ReportConsentOptions` types are exported from `@consentify/core/cloud`. Core and cloud share one copy of the core code, so `ConsentifyConfigError` from `@consentify/core` matches errors thrown by the cloud factory.

#### SiteConfig loading, caching and offline behavior

The SiteConfig comes from two CDN files: `/config/<siteId>/latest.json` (short CDN TTL) names the current hash, and `/config/<siteId>/<hash>.json` is immutable.

- **Browser:** the result is cached in `localStorage` under `consentify_cfg_<siteId>` as `{ t, h, c }` (fetch time, hash, SiteConfig). A fresh entry (younger than `configTtlSec`) is used without any request. A stale entry is used immediately and refreshed in the background; the refresh updates the cache only, so the running instance keeps its policy and the next page load picks up the new one. Revalidation skips the second request when `latest.json` still names the cached hash.
- **Server (SSR):** the same TTL and stale-while-revalidate rules apply to an in-module cache keyed by `endpoint|siteId`, and concurrent calls share one in-flight request, so renders do not fetch per request.
- **Offline / CDN outage:** a cached SiteConfig (fresh or stale) keeps working. With no cache, the instance is built from `fallback` and one `console.warn` is logged. The factory does not reject for network or SiteConfig problems; it only rejects with `ConsentifyConfigError` when `fallback.categories` is missing.

The returned instance exposes the outcome for debugging:

```ts
consent.cloud.source; // 'network' | 'cache' | 'stale' | 'fallback'
consent.cloud.config; // the SiteConfig in use (see below)
consent.cloud.siteId; // init.siteId
consent.cloud.ingest; // ingest base URL in use (endpoints.ingest or the default)
```

When `source` is `'fallback'`, `config` is your `fallback` in SiteConfig shape (`policyIdentifier` is `fallback.identifier`, or the category hash when it is omitted; `policyTextVersion` is `fallback.textVersion`).

The SiteConfig (v2) has this shape. `locales`, `defaultLocale` and `vendors` are data for your consent UI: the SDK validates their types but attaches no consent logic to them. A wrong type in any field makes the whole config malformed, so the cache or `fallback` is used instead.

```ts
interface SiteConfig {
  v?: 2;
  categories: readonly string[];
  policyIdentifier: string;    // non-empty; changing it asks every visitor again
  policyTextVersion?: string;  // recorded as `pv`; changing it keeps existing consent
  mode?: 'opt-in' | 'opt-out';
  consentMaxAgeDays?: number;
  locales?: string[];          // BCP 47 tags the banner is published in
  defaultLocale?: string;
  vendors?: Vendor[];          // { id, category, name, privacyPolicyUrl? }
}
```

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

#### Event reporting

In the browser the instance POSTs one event per decision to `<ingest>/v2/events`: `{ v: 2, eventId, siteId, action, record, visitorHash, sdkVersion }`, where `record` is the full [consent record](#consent-record) and `action` is `accept_all`, `reject_all` or `customize`. `publicKey` travels only in the `X-Consentify-Key` header. The full wire contract is in [`docs/plans/2026-10-07-saas-contract-v2.md`](../plans/2026-10-07-saas-contract-v2.md); what is collected is described in the [cloud privacy guide](./cloud-privacy.md).

### `reportConsent(consent, options)` — server-side reporting

Decisions written on the server (`consent.set/acceptAll/rejectAll({ cookieHeader })`, e.g. in a Next.js Server Action) never pass through the browser reporter until the next page load. `reportConsent` sends them to the ingest endpoint right away, with a server key and, when the instance has a `secret`, an HMAC proof.

```ts
'use server';
import { cookies } from 'next/headers';
import { parseSetCookie } from '@consentify/core';
import { createCloudConsentify, reportConsent } from '@consentify/core/cloud';

const consent = await createCloudConsentify({
  siteId: process.env.CONSENTIFY_SITE_ID!,
  fallback: { categories: ['analytics', 'marketing'], identifier: 'your-published-policy-identifier' },
  secret: process.env.CONSENT_SIGNING_SECRET!, // optional: adds `proof` to server events
});

export async function acceptAllAction() {
  const store = await cookies();
  const setCookie = consent.acceptAll({ cookieHeader: store.toString(), source: 'banner' });
  const { name, value, options } = parseSetCookie(setCookie);
  store.set(name, value, options);
  await reportConsent(consent, { serverKey: process.env.CONSENTIFY_SERVER_KEY!, setCookie });
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverKey` | `string` | *required* | Server key of the site, sent as `X-Consentify-Server-Key`. Keep it in server-only env vars |
| `setCookie` | `string` | — | The `Set-Cookie` header a server write returned. Pass this **or** `cookieHeader` |
| `cookieHeader` | `string \| null \| undefined` | — | A request `Cookie` header that carries the record |
| `visitorId` | `string \| () => string \| Promise<string>` | — | Your own id for the visitor, sent as `visitorHash`. There is no stored id on the server, so without it the event has no `visitorHash`. A factory that throws drops `visitorHash`, not the event |
| `timeoutMs` | `number` | `3000` | Request deadline |

- `consent` must come from `createCloudConsentify`: the site id and ingest endpoint are taken from `consent.cloud`, and the record must match the instance's policy.
- Resolves `true` when the ingest answered 2xx, and `false` when there is no valid record (unset, cleared, other policy, expired) or the request failed or timed out. It never rejects and never retries.
- Throws `ConsentifyConfigError` when called in a browser, like `secret`: the server key would leak. It is not part of the cloud IIFE.
- The event is the browser event plus `proof` (a [`ConsentProof`](#consent-proof-audit-trail) of `record`) when the instance has a `secret`. Whoever holds the secret can check it with `verifyProof`.
- On the next page load, the browser reporter also reports the server-written record (it has not seen it yet) with a new `eventId`. The ingest treats `siteId` + `record.id` as one decision; see the contract.

### Migrating to v3: cloud mode

`createConsentify` no longer accepts `siteId`. Import the cloud factory from the subpath and add the now-required `fallback`:

```diff
- import { createConsentify } from '@consentify/core';
- const consent = await createConsentify({ siteId: 'your-site-id', apiKey: 'sk_live_...' });
+ import { createCloudConsentify } from '@consentify/core/cloud';
+ const consent = await createCloudConsentify({
+   siteId: 'your-site-id',
+   publicKey: 'pk_live_...',
+   fallback: { categories: ['analytics', 'marketing'], identifier: 'your-published-policy-identifier' },
+ });
```

A CDN failure no longer rejects the factory: code that caught `ConsentifyConfigError` around it to fall back to a local policy can rely on `fallback` instead.

Script-tag users switch from `dist/consentify.iife.min.js` to `dist/consentify-cloud.iife.min.js` and call `Consentify.createCloudConsentify(...)`.

| v2 | v3 |
|----|----|
| `apiKey` option | `publicKey` |
| Key sent as `X-API-Key` header **and** `apiKey` in the event body | Key sent only as the `X-Consentify-Key` header |
| `POST <ingest>/v1/events` with `{ siteId, action, categories, visitorHash, policyVersion }` | `POST <ingest>/v2/events` with `{ v: 2, eventId, siteId, action, record, visitorHash, sdkVersion }`; a custom `endpoints.ingest` must accept the new shape |
| `consentify_event_buffer` holds `{ url, body, apiKey? }` | `{ url, body, publicKey? }` |
| Decisions made in server code were not reported | `reportConsent(consent, { serverKey, setCookie })` |
| `create-consentify --api-key`, `CONSENTIFY_API_KEY` | `--public-key`, `CONSENTIFY_PUBLIC_KEY` |

> **Note:** The separate `@consentify/cloud` package is deprecated as of `v2.0.0` and is a no-op. Remove it from your `package.json` and use `createCloudConsentify({ siteId, publicKey, fallback })` from `@consentify/core/cloud`.

### Migrating to v3: server API and proofs

Server mode is now selected by an options object instead of a bare string, the unsigned proof fallback is gone, and `client.get(category)` is removed:

| v2 | v3 |
|----|----|
| `consent.get(cookieHeader)` | `consent.get({ cookieHeader })` |
| `consent.get(null)` | `consent.get()` (client) or `consent.get({ cookieHeader: null })` (server) |
| — | `consent.isGranted('analytics', { cookieHeader })` (server; follows `mode` when unset) |
| `consent.set(choices, cookieHeader)` | `consent.set(choices, { cookieHeader })` |
| `consent.clear('anything')` | `consent.clear({ cookieHeader })` |
| `consent.acceptAll(cookieHeader)` / `consent.rejectAll(cookieHeader)` | `consent.acceptAll({ cookieHeader })` / `consent.rejectAll({ cookieHeader })` |
| `consent.getProof()` without `secret` (FNV1a, forgeable) | Removed. Create a server instance with `secret` and call `await consent.getProof({ cookieHeader })` |
| `consent.getProof(cookieHeader)` with `secret` | `await consent.getProof({ cookieHeader })` |
| `consent.client.get('analytics')` | `consent.isGranted('analytics')` |
| `adapter.save({ visitorId, snapshot, proof })`, `proof` always set | `proof` is optional: present only when the instance has a `secret` |

The `cookieHeader` key must be present, since it is what selects server mode; its value may be a string, `null` or `undefined`, so `request.headers.get('cookie')` can be passed as is. The `consent.server.*` namespace keeps its v2 signatures (`server.set` gains an optional third `WriteOptions` argument).

### Migrating to v3: consent record

New records are [consent record v2](#consent-record): `{ v: 2, id, policy, givenAt, choices }` plus optional `pv`, `lang` and `src`. Stored v2.x records keep working without re-consent, and their proofs still verify. Code that compares whole snapshots or proofs against `{ policy, givenAt, choices }` should allow the new keys.

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

`save` is awaited on every `set()` / `acceptAll()` / `rejectAll()` and receives the full [consent record](#consent-record). `load` is called on startup to hydrate state for the current `visitorId`; without an explicit `visitorId` it is skipped until an id is stored (a first-time visitor has nothing to load). Return the snapshot as it was saved (storing it as JSON is enough): it is validated like a cookie, so optional keys must be absent or strings, not `null`.

## Policy Versioning

The `'necessary'` category is always `true` and cannot be disabled. When you change your `policy.categories` (or `policy.identifier`), all existing consent is automatically invalidated — users will be prompted again.

`policy.textVersion` is different: it is recorded on new decisions (`pv`) as evidence of which text the user saw, but changing it keeps existing consent valid. Use it for wording or translation updates, and bump `policy.identifier` for material changes that need fresh consent.
