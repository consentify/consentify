# @consentify/core

## 2.5.0

### Minor Changes

- 89b3f5b: Consolidated review-round hardening, typing, and docs cleanup. No breaking changes.

  - **Bundle-size CI gate**: `pnpm size` now runs in both `ci.yml` and `release.yml`, so a regression blocks merges and publishes. The `cloud-v*` tag trigger and the deprecated `@consentify/cloud` publish step were removed from the release workflow.
  - **Visitor-id retry fix**: a throwing `visitorId` factory no longer poisons the in-memory cache. Failed resolutions now log a warning, fall back to an empty id (matching server-side defaults), and reset the cache so the next consent write retries. See new regression test in `packages/core/src/index.test.ts`.
  - **Unsigned `getProof()` warning**: calling `getProof()` on an instance without a `secret` now emits a one-time `console.warn` explaining that the FNV1a fallback is forgeable and advising callers to pass `secret` for HMAC-SHA256 signing. The sync return type is flagged `@deprecated`; the plan is to make it return `null` without a secret in the next major release. Behavior is unchanged in this release.
  - **Typed `ConsentAdapter<T>`**: `ConsentAdapter` is now generic on the category union and the type parameter is threaded through `CreateConsentifyInit` and `CloudInit`. The default type parameter keeps existing adapters compiling.
  - **Narrowed cloud `createConsentify` overloads**: the cloud entry point now returns `Promise<ConsentifyAsyncInstance<…>>` when a `secret` is provided and `Promise<ConsentifyInstance<…>>` otherwise, mirroring the self-hosted overloads. Callers can narrow `getProof()` behavior from the input shape alone.
  - **`client.get(category)` deprecated**: the boolean overload on `client.get` is marked `@deprecated` in JSDoc; use `isGranted(category)` instead. The runtime overload is retained for backward compatibility and slated for removal in v3.
  - **Internal module split**: `packages/core/src/index.ts` has been split into focused modules under `packages/core/src/internal/` (`types`, `util`, `cookie`, `crypto`, `visitor`, `cloud`, `gcm`, `debug`). The public entry point and exports are unchanged; tree-shaking is preserved via `sideEffects: false`.
  - **Bundle-size reduction**: follow-up cleanup consolidated three per-storage `try/catch` switches into a single `localStorage` dispatcher, inlined single-use helpers (`readClientRaw`, `firstAvailableStore`, `clearCookieHeader`), folded the per-read validity / policy / expiration checks, removed a redundant `BroadcastChannel.onmessage` outer catch that duplicated per-listener error handling, and shortened a few long runtime messages. Both the ESM and IIFE bundles are now back under the original **5 kB gzipped** budget (ESM 4.74 kB, IIFE 4.97 kB); `.size-limit.json` has been retightened to `5 kB` for both entries.
  - **Docs cleanup**: the top-level README has been trimmed to positioning, quick start, and primary examples. The full API reference (tables, typed events, `getProof` signed/unsigned guidance, server/client namespaces, custom adapters, cloud reporting, IIFE + CSP/SRI) lives under `docs/guides/api-reference.md`. `packages/core/README.md` gains a script-tag section with CSP nonce + SRI guidance.

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
