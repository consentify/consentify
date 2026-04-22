---
'@consentify/core': minor
---

Consolidated review-round hardening, typing, and docs cleanup. No breaking changes.

- **Bundle-size CI gate**: `pnpm size` now runs in both `ci.yml` and `release.yml`, so a regression blocks merges and publishes. The `cloud-v*` tag trigger and the deprecated `@consentify/cloud` publish step were removed from the release workflow.
- **Visitor-id retry fix**: a throwing `visitorId` factory no longer poisons the in-memory cache. Failed resolutions now log a warning, fall back to an empty id (matching server-side defaults), and reset the cache so the next consent write retries. See new regression test in `packages/core/src/index.test.ts`.
- **Unsigned `getProof()` warning**: calling `getProof()` on an instance without a `secret` now emits a one-time `console.warn` explaining that the FNV1a fallback is forgeable and advising callers to pass `secret` for HMAC-SHA256 signing. The sync return type is flagged `@deprecated`; the plan is to make it return `null` without a secret in the next major release. Behavior is unchanged in this release.
- **Typed `ConsentAdapter<T>`**: `ConsentAdapter` is now generic on the category union and the type parameter is threaded through `CreateConsentifyInit` and `CloudInit`. The default type parameter keeps existing adapters compiling.
- **Narrowed cloud `createConsentify` overloads**: the cloud entry point now returns `Promise<ConsentifyAsyncInstance<…>>` when a `secret` is provided and `Promise<ConsentifyInstance<…>>` otherwise, mirroring the self-hosted overloads. Callers can narrow `getProof()` behavior from the input shape alone.
- **`client.get(category)` deprecated**: the boolean overload on `client.get` is marked `@deprecated` in JSDoc; use `isGranted(category)` instead. The runtime overload is retained for backward compatibility and slated for removal in v3.
- **Internal module split**: `packages/core/src/index.ts` has been split into focused modules under `packages/core/src/internal/` (`types`, `util`, `cookie`, `crypto`, `visitor`, `cloud`, `gcm`, `debug`). The public entry point and exports are unchanged; tree-shaking is preserved via `sideEffects: false`. Both ESM and IIFE bundles remain inside their size budgets (4.83 kB / 5.06 kB gzipped).
- **Docs cleanup**: the top-level README has been trimmed to positioning, quick start, and primary examples. The full API reference (tables, typed events, `getProof` signed/unsigned guidance, server/client namespaces, custom adapters, cloud reporting, IIFE + CSP/SRI) lives under `docs/guides/api-reference.md`. `packages/core/README.md` gains a script-tag section with CSP nonce + SRI guidance.
