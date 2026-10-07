# create-consentify

## 0.3.0

### Minor Changes

- f45e191: Cloud mode moved to its own entry point so self-hosted apps no longer ship the SaaS client. Migrate `createConsentify({ siteId })` from `@consentify/core` to `createCloudConsentify({ siteId })` from `@consentify/core/cloud` with the same options; `createConsentify` now rejects `siteId` at compile time and throws `ConsentifyConfigError` at runtime. Script-tag cloud users switch from `dist/consentify.iife.min.js` (now self-hosted only) to the new `dist/consentify-cloud.iife.min.js`, and the scaffolder emits the new import.
- f45e191: Cloud events now use ingest v2: `POST <ingest>/v2/events` with `{ v: 2, eventId, siteId, action, record, visitorHash, sdkVersion }`, where `record` is the full consent record. `CloudInit.apiKey` is renamed to `publicKey` and is sent only as the `X-Consentify-Key` header, never in the body, and the new server-only `reportConsent(consent, { serverKey, setCookie })` reports decisions made in server code, with an HMAC `proof` when the instance has a `secret`. SiteConfig v2 adds `policyTextVersion` (recorded as `pv`, with `fallback.textVersion` as its fallback), `locales`, `defaultLocale` and `vendors`, `CloudInit` gains `lang`, and the scaffolder's `--api-key` flag and `CONSENTIFY_API_KEY` env var are now `--public-key` and `CONSENTIFY_PUBLIC_KEY`.

### Patch Changes

- 984f099: The vanilla script-tag snippet pins the IIFE URL to `@consentify/core@3` and uses the same `fallback` block as `consent-config`, including the `identifier` hint.
- 28561d9: Let `enableConsentMode` skip `gtag('consent', 'default')` when a head snippet already sent it (`sendDefault: false`).

  The scaffolder waits until mount before painting the banner, and its Consent Mode head snippet follows the categories the user picked. The core package README now matches the flat API and the real bundle size.

- f45e191: `createCloudConsentify` now requires a local `fallback` policy (`{ categories, identifier?, mode?, consentMaxAgeDays? }`) and no longer rejects when the CDN is unreachable, slow or serves a bad config: it uses a cached SiteConfig or the fallback instead, and reports which one on `consent.cloud.source`. The SiteConfig is cached in `localStorage` (`consentify_cfg_<siteId>`) in the browser and in memory on the server, with `configTtlSec` (default 3600) stale-while-revalidate and a `timeoutMs` deadline (default 3000). The scaffolder emits a `fallback` from the categories and mode you pick.

## 0.2.1

### Patch Changes

- Packaging fixes: `exports` lists `types` first and adds a `default` condition (react); ship the MIT LICENSE file in the tarball (create-consentify); remove `engines.pnpm` constraint from published manifests.

## 0.2.0

### Minor Changes

- Migrate generated SaaS setup to `@consentify/core` Mode B.

  When a user opts into the Consentify Dev integration, the scaffolder now
  emits:

  ```ts
  export const consent = await createConsentify({
    siteId: process.env.NEXT_PUBLIC_CONSENTIFY_SITE_ID!,
    apiKey: process.env.NEXT_PUBLIC_CONSENTIFY_API_KEY,
    mode: "opt-in",
  });
  ```

  instead of the previous self-hosted `createConsentify(...)` + separate
  `enableCloud(...)` call. `@consentify/cloud` is no longer added to the
  installed runtime dependencies by any framework scaffolder.

  Existing self-hosted scaffolds (no `--site-id` flag, no SaaS opt-in) are
  unaffected and continue to emit a synchronous `createConsentify({ policy,
mode })` config.
