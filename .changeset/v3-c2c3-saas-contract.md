---
"@consentify/core": major
"create-consentify": minor
---

Cloud events now use ingest v2: `POST <ingest>/v2/events` with `{ v: 2, eventId, siteId, action, record, visitorHash, sdkVersion }`, where `record` is the full consent record. `CloudInit.apiKey` is renamed to `publicKey` and is sent only as the `X-Consentify-Key` header, never in the body, and the new server-only `reportConsent(consent, { serverKey, setCookie })` reports decisions made in server code, with an HMAC `proof` when the instance has a `secret`. SiteConfig v2 adds `policyTextVersion` (recorded as `pv`, with `fallback.textVersion` as its fallback), `locales`, `defaultLocale` and `vendors`, `CloudInit` gains `lang`, and the scaffolder's `--api-key` flag and `CONSENTIFY_API_KEY` env var are now `--public-key` and `CONSENTIFY_PUBLIC_KEY`.
