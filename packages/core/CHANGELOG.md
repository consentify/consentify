# @consentify/core

## 2.4.0

### Minor Changes

- Add three-mode `createConsentify()` entry point. The factory now branches on
  its input:

  - **Self-hosted (sync, default)**: unchanged behaviour, plus optional
    `secret` (HMAC-SHA256 proofs, server-only), optional `adapter` (custom
    storage backend), and optional `visitorId` override.
  - **SaaS / Consentify Dev (async)**: `createConsentify({ siteId, apiKey })`
    returns `Promise<ConsentifyInstance>`. Fetches `SiteConfig` from
    `cdn.consentify.dev` and auto-enables event reporting to
    `ingest.consentify.dev`. Endpoints are overridable.

  New exports: `ConsentAdapter`, `VisitorIdSource`, `CloudInit`,
  `ConsentifyInstance`, `ConsentifyAsyncInstance`, `ConsentifyConfigError`,
  and `verifyProof(proof, secret)`.

  Build pipeline: the ESM `dist/index.js` is now minified via `esbuild`
  (tsc emits `.d.ts` only). Size budget: ESM 4.71 kB / IIFE min 4.93 kB,
  both under 5 kB gzipped.

  No breaking changes to existing APIs. Projects that were previously using
  `@consentify/cloud` should migrate to `createConsentify({ siteId })` -- the
  cloud package is now deprecated.

## 2.2.0

### Minor Changes

- eaaa712: Add typed event system (`on`/`once`) and `enableDebug()` adapter.

  New APIs:

  - `instance.on('change', handler)` - subscribe to consent state changes with typed `from`/`to`/`timestamp` payload
  - `instance.on('clear', handler)` - subscribe to consent clear events
  - `instance.once(type, handler)` - one-time event listener, auto-unsubscribes after first call
  - `enableDebug(instance, options?)` - tree-shakeable debug adapter that logs consent changes

  Also includes IIFE/UMD bundle (`dist/consentify.iife.min.js`) for script tag usage.

  All existing APIs (`subscribe`, `guard`, `get`, `set`, `clear`) are unchanged.

## 2.1.0

### Minor Changes

- Add multi-tab consent synchronisation via `BroadcastChannel`. Consent changes made in one browser tab are now automatically reflected in all other open tabs on the same origin.

## 1.0.0

### 🎉 Stable Release

**Core Features:**

- Headless cookie consent SDK with zero dependencies
- Full TypeScript support with strong typing
- SSR-safe implementation (server and client APIs)
- Compact cookie-based storage with optional localStorage mirror
- Policy versioning with automatic snapshot invalidation
- Support for custom consent categories
- Deterministic policy hashing
- GDPR and CCPA compliance ready

**React Integration:**

- `subscribe()` method for `useSyncExternalStore` integration
- `getServerSnapshot()` for SSR hydration support
- Internal state caching for optimal React performance
- Subscriber notification system for reactive updates

**API:**

- `createConsentify()` — Main factory function
- Server API: `get()`, `set()`, `clear()`
- Client API: `get()`, `set()`, `clear()`, `subscribe()`, `getServerSnapshot()`
- Default categories: preferences, analytics, marketing, functional, unclassified

## 0.1.0

### Initial Release

- Initial beta release with core functionality
