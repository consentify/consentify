# @consentify/core

## 3.0.0

### Major Changes

- f45e191: Cloud mode moved to its own entry point so self-hosted apps no longer ship the SaaS client. Migrate `createConsentify({ siteId })` from `@consentify/core` to `createCloudConsentify({ siteId })` from `@consentify/core/cloud` with the same options; `createConsentify` now rejects `siteId` at compile time and throws `ConsentifyConfigError` at runtime. Script-tag cloud users switch from `dist/consentify.iife.min.js` (now self-hosted only) to the new `dist/consentify-cloud.iife.min.js`, and the scaffolder emits the new import.
- f45e191: Server mode on the flat API is now chosen by an options object: `get({ cookieHeader })`, `isGranted(category, { cookieHeader })`, `set(choices, { cookieHeader })`, `clear({ cookieHeader })`, `acceptAll({ cookieHeader })` and `rejectAll({ cookieHeader })` replace the bare-string and `get(null)` forms. Instances without a `secret` no longer have `getProof` (the forgeable FNV1a fallback is gone), `adapter.save` no longer receives a `proof` (saves run in the browser, where `secret` is not allowed), and the deprecated `client.get(category)` is removed in favour of `isGranted(category)`. `@consentify/react` re-exports these core APIs, so it moves to a major version too; the hook itself is unchanged.
- f45e191: New consent records use format v2: they have `v: 2`, a random decision `id` (12 hex characters, new for every decision, so the cloud reporter and the ingest can tell apart two decisions made in the same millisecond) and can store the policy text version (`policy.textVersion`, as `pv`), the UI language (`lang` option, per-call `lang`, or `<html lang>` in the browser) and the source (`set`, `acceptAll` and `rejectAll` take `{ source: 'banner' | 'preferences' | 'api' }`, stored as `src`). HMAC proofs sign these fields too, while v1 records and proofs are still read and verified, so upgrading forces no re-consent. Server mode on the flat API is selected by the `cookieHeader` key, so pass it even when there is no cookie (`clear({ cookieHeader })`); an options object without it, such as `{ source: 'banner' }`, is a client write. Client writes are now ignored with a warning outside a browser, where they used to change the instance state shared by every server request.
- f45e191: `createCloudConsentify` now requires a local `fallback` policy (`{ categories, identifier?, mode?, consentMaxAgeDays? }`) and no longer rejects when the CDN is unreachable, slow or serves a bad config: it uses a cached SiteConfig or the fallback instead, and reports which one on `consent.cloud.source`. The SiteConfig is cached in `localStorage` (`consentify_cfg_<siteId>`) in the browser and in memory on the server, with `configTtlSec` (default 3600) stale-while-revalidate and a `timeoutMs` deadline (default 3000). The scaffolder emits a `fallback` from the categories and mode you pick.
- f45e191: The default visitor id (`consentify_visitor` in localStorage) is no longer created on page load: cloud reporting creates it at the first `accept_all` or `customize` decision, and adapter hydration only uses an id that already exists (skipping `adapter.load()` for a first-time visitor). A `reject_all` event now deletes the stored id and reports a one-off 8-character hex token as `visitorHash`, and `adapter.save()` receives a one-off token for a reject-all record too, instead of a newly created stored id. A custom `visitorId` passed to `createCloudConsentify` is now sent with every cloud event; before, the reporter ignored it.
- f45e191: Cloud events now use ingest v2: `POST <ingest>/v2/events` with `{ v: 2, eventId, siteId, action, record, visitorHash, sdkVersion }`, where `record` is the full consent record. `CloudInit.apiKey` is renamed to `publicKey` and is sent only as the `X-Consentify-Key` header, never in the body, and the new server-only `reportConsent(consent, { serverKey, setCookie })` reports decisions made in server code, with an HMAC `proof` when the instance has a `secret`. SiteConfig v2 adds `policyTextVersion` (recorded as `pv`, with `fallback.textVersion` as its fallback), `locales`, `defaultLocale` and `vendors`, `CloudInit` gains `lang`, and the scaffolder's `--api-key` flag and `CONSENTIFY_API_KEY` env var are now `--public-key` and `CONSENTIFY_PUBLIC_KEY`.

### Minor Changes

- 28561d9: Let `enableConsentMode` skip `gtag('consent', 'default')` when a head snippet already sent it (`sendDefault: false`).

  The scaffolder waits until mount before painting the banner, and its Consent Mode head snippet follows the categories the user picked. The core package README now matches the flat API and the real bundle size.

- 984f099: Cloud: new `configMaxStaleSec` option (default 7 days). A cached SiteConfig older than that is no longer served stale; the factory waits for the CDN as with an empty cache and uses `fallback` if the fetch fails. On the server, a failed SiteConfig fetch with no usable cache is remembered for 30 seconds, so renders during a CDN outage use `fallback` at once instead of each waiting `timeoutMs`.
- f45e191: `guard(category, onGrant, onRevoke)` now re-arms after a revoke: a later re-grant calls `onGrant` again and the next revoke calls `onRevoke` again, until the returned dispose function is called. Guards without `onRevoke` are unchanged and still run `onGrant` once.
- f45e191: The consent cookie's `Max-Age` now follows `consentMaxAgeDays` when `cookie.maxAgeSec` is not set (an explicit `maxAgeSec` still wins; the one-year default is unchanged when neither is set). New `cookie.partitioned` option adds the CHIPS `Partitioned` attribute and forces `Secure`, for embedded / third-party iframe contexts.
- f45e191: Add `parseSetCookie()`, a pure helper that turns a server-side `Set-Cookie` header into `{ name, value, options }` for framework cookie setters such as Next.js `cookies().set()`. The value comes back URI-decoded, because those setters encode it themselves. The Next.js guide now uses it instead of hand-parsing the header and hardcoding cookie options.

### Patch Changes

- 984f099: Opt-out: a category missing from the stored record (added later under an unchanged `policy.identifier`) now reads as granted, the same default a write fills in. Before, `isGranted`, `get()` and Consent Mode reported it denied, and the next partial `set()` silently flipped it to granted. Opt-in is unchanged (missing reads as denied).
- f45e191: In `opt-out` mode, a partial `set()` before any decision now keeps the categories you did not pass granted, on both the client and the server, instead of denying them. `opt-in` mode, explicit choices, and `acceptAll()`/`rejectAll()` behave as before.
- f45e191: A `set()` (and `acceptAll()` / `rejectAll()`) with a `source`, such as `acceptAll({ source: 'banner' })` from a consent UI button, now always records a new decision with a fresh `id` and `givenAt`, even when the choices are unchanged, so re-affirming consent restarts the `consentMaxAgeDays` window and emits `'change'`; in cloud mode each re-affirmation is reported as a new consent event. A call without a `source` whose choices equal the stored record's is a no-op, so restoring saved choices on every page load (or calling `set()` in an effect that depends on consent state) neither extends consent nor notifies, emits or reports anything. Server writes follow the same rule and then return a `Set-Cookie` header for the stored record unchanged.

## 2.6.0

### Minor Changes

- Add `destroy()` to release the BroadcastChannel and all listeners (useful for tests, HMR, micro-frontends). Warn when the encoded consent cookie exceeds 3.5KB (browsers cap cookies at 4KB).
- Consent lifecycle fixes and packaging improvements:

  - **`enableConsentMode` now resets Google Consent Mode on revocation**: `clear()` sends a `consent update` with the pre-decision defaults (denied for opt-in, granted for opt-out) instead of leaving the last granted state live until reload.
  - **Cross-tab changes now emit typed events**: a `set()`/`clear()` in another tab emits `'change'`/`'clear'` on this tab's instance, consistent with `subscribe()`/`guard()` behavior.
  - **Cloud reporting no longer re-sends the same decision on every page load**: the dedup key is persisted to localStorage (also suppresses cross-tab duplicate reports).
  - **Packaging**: `exports` now lists `types` first and adds a `default` condition (fixes `require()` resolution on Node ≥ 20.17); the npm ESM entry `dist/index.js` ships unminified for debuggability (`dist/index.min.js` is the minified variant); removed `engines.pnpm` constraint from the published manifest.

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
