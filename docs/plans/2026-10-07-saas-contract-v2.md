# SaaS Contract v2: CDN, SiteConfig v2, Ingest v2

**Date:** 2026-10-07
**Status:** Proposed (v3 tasks C2, C3)
**SDK side:** `@consentify/core` v3, entry `@consentify/core/cloud`
**Audience:** the team building the hosted platform (CDN publisher, ingest service, dashboard)

This document is the wire contract between the SDK and the hosted platform. It is self-contained: the SaaS can be built from it without reading SDK code. The key words MUST, SHOULD and MAY are used as in RFC 2119. Statements about "the SDK" describe what `@consentify/core` v3 does; statements about "the CDN", "the ingest" or "the SaaS" are requirements on the platform.

The platform is not live yet, so v2 has no compatibility obligations towards earlier SDKs (see [Legacy v1](#legacy-v1-events)).

## Contents

1. [Overview](#1-overview)
2. [CDN: SiteConfig delivery](#2-cdn-siteconfig-delivery)
3. [SiteConfig v2](#3-siteconfig-v2)
4. [Ingest v2](#4-ingest-v2)
5. [What the SaaS must implement](#5-what-the-saas-must-implement)
6. [Design decisions](#6-design-decisions)

## 1. Overview

The SDK talks to two services:

| Service | Default base URL | Integrator override | Direction |
|---------|------------------|---------------------|-----------|
| CDN | `https://cdn.consentify.dev` | `endpoints.config` | SDK reads the site's SiteConfig (`GET`) |
| Ingest | `https://ingest.consentify.dev` | `endpoints.ingest` | SDK writes consent events (`POST`) |

The SDK strips one trailing `/` from both base URLs before appending paths.

A site has an id (`siteId`) and two keys:

| Key | Header | Used by | Secret |
|-----|--------|---------|--------|
| Public key | `X-Consentify-Key` | The browser reporter (`createCloudConsentify({ publicKey })`) | No. It ships in client bundles and is visible to anyone |
| Server key | `X-Consentify-Server-Key` | `reportConsent(consent, { serverKey, ... })` in the integrator's server code | Yes |

Keys never appear in a request body, a URL or the SDK's local storage, with one exception: the browser retry buffer stores the public key next to the failed event (`consentify_event_buffer`, see [4.5](#45-responses-and-retries)).

Conventions for all JSON in this contract: UTF-8, no comments. The SDK omits optional fields that are unset; it never sends `null` or `""` for them. The SaaS MUST do the same in what it publishes (a `null` in a SiteConfig makes the config invalid, see [3.3](#33-validation-in-the-sdk)).

## 2. CDN: SiteConfig delivery

### 2.1 Layout

Two files per site:

```
GET {config}/config/{siteId}/latest.json   ->  { "current": "{hash}" }
GET {config}/config/{siteId}/{hash}.json   ->  SiteConfig (section 3)
```

- `{hash}` is the config version: one file per published config, never changed after it is written. The SDK treats it as an opaque, non-empty string and compares it for equality only. Recommended: the first 16 hex characters of the SHA-256 of the file body (a content hash, so republishing identical content yields the same name).
- `{siteId}` and `{hash}` are inserted into the path verbatim (no URL encoding), so both MUST match `[A-Za-z0-9_-]+`.
- `latest.json` MUST be an object whose `current` is a non-empty string. Other fields are ignored (the SaaS MAY add e.g. `publishedAt` for debugging).
- Publishing order: write `{hash}.json` first, then `latest.json`, then purge `latest.json` at the CDN edge. `latest.json` must never name a file that does not exist yet.
- Old `{hash}.json` files MUST stay available for at least 24 hours after they stop being current (a client may read `latest.json` just before a publish and the hashed file just after). Keeping them forever is RECOMMENDED: they are small, and they let the SaaS resolve the `record.policy` of any stored event to the categories and texts that were live.

### 2.2 Response headers

| File | `Cache-Control` | Notes |
|------|-----------------|-------|
| `latest.json` | `public, max-age=60` | Short. Purge at the edge on publish. A longer `max-age` delays new configs for visitors without a cached copy |
| `{hash}.json` | `public, max-age=31536000, immutable` | Content never changes for a given name |

Both files:

- MUST send `Access-Control-Allow-Origin: *`. The SDK reads them with `fetch` from the customer's origin; without the header the browser hides the response and the SDK falls back.
- SHOULD send `Content-Type: application/json; charset=utf-8`.
- MUST NOT set cookies or vary on cookies. The SDK sends plain `GET`s with no credentials, no custom headers and no query string (CORS simple requests, so there is no preflight).
- Unknown site or hash: `404`. The SDK then uses its cache or the integrator's local fallback policy. Avoid redirects.

### 2.3 How the SDK loads and caches (load model)

- One deadline (`timeoutMs`, default 3000 ms) covers both requests; when it passes, the requests are aborted.
- Browser: the result is cached in `localStorage` (`consentify_cfg_{siteId}`). For `configTtlSec` (default 3600 s) the cached config is used with no request at all. After that it is used once more as is and revalidated in the background: `GET latest.json`, and the second request only when `current` differs from the cached hash. The running page keeps its config; the next page load uses the new one.
- Server (SSR): the same rules with an in-process memory cache; concurrent renders share one request.
- Any failure (network error, timeout, non-2xx, invalid JSON, invalid shape) means: cached config (even an expired one), else the integrator's `fallback`. The SDK does not retry within a page load.

Expected load: per browser at most one `latest.json` per `configTtlSec`, plus one `{hash}.json` per published change. Worst-case propagation of a publish to a returning visitor: `configTtlSec` + the `latest.json` `max-age` (about 61 minutes with defaults), plus one page load.

## 3. SiteConfig v2

### 3.1 Shape

```ts
interface SiteConfig {
  v?: 2;                       // format version
  categories: string[];        // user categories, in display order
  policyIdentifier: string;    // consent key: changing it asks every visitor again
  policyTextVersion?: string;  // recorded on new decisions as record.pv
  mode?: 'opt-in' | 'opt-out';
  consentMaxAgeDays?: number;
  locales?: string[];          // BCP 47 tags the consent UI is published in
  defaultLocale?: string;
  vendors?: Vendor[];
}

interface Vendor {
  id: string;
  category: string;
  name: string;
  privacyPolicyUrl?: string;
}
```

The SDK exports these types from `@consentify/core/cloud` (`SiteConfig`, `Vendor`).

### 3.2 Fields

| Field | Type | Required | SDK behavior | SaaS rules |
|-------|------|----------|--------------|------------|
| `v` | `2` | SHOULD be sent | Absent or `2` is accepted; any other value makes the config invalid | Always publish `2` |
| `categories` | `string[]` | yes | Become the instance's categories. `necessary` is implicit and always granted | Unique, non-empty strings; MUST NOT contain `necessary`. Adding or removing a category MUST come with a new `policyIdentifier` (see below) |
| `policyIdentifier` | non-empty `string` | yes | Stored in every record as `record.policy`. A stored record with a different value is ignored and the visitor is asked again | Change it for material policy changes and whenever `categories` change; otherwise keep it, since a change re-prompts every visitor. Short (it is stored in a cookie): a date (`"2026-10-01"`) or a semver works |
| `policyTextVersion` | `string` | no | Recorded on every new decision as `record.pv`. Changing it does not invalidate existing consent | Bump on wording or translation changes that are not material. Short |
| `mode` | `'opt-in' \| 'opt-out'` | no (default `opt-in`) | A local `mode` in the integrator's init wins | MUST be one of the two values (the SDK does not check it) |
| `consentMaxAgeDays` | `number` | no | Records older than this are expired: the visitor is asked again. A local value wins | Positive integer (the SDK does not check it) |
| `locales` | `string[]` | no | Data only: validated, cached, exposed as `consent.cloud.config.locales` | BCP 47 tags |
| `defaultLocale` | `string` | no | Data only | SHOULD be one of `locales` |
| `vendors` | `Vendor[]` | no | Data only: the SDK attaches no consent logic to vendors | `id` unique per site; `category` one of `categories` or `necessary`; `privacyPolicyUrl` an absolute `https:` URL |

Why a category change needs a new identifier: the SDK keys stored consent by `policyIdentifier` alone. With an unchanged identifier, a record from before a new category was added stays valid, and the new category reads as not granted (in `opt-out` mode too), so the visitor is never asked about it.

Additional fields are allowed. The SDK passes the whole object through unchanged (cache and `consent.cloud.config`), so new optional fields can be added without changing `v`.

### 3.3 Validation in the SDK

The SDK treats a SiteConfig as invalid, and falls back to its cache or the integrator's `fallback`, when any of these holds:

- the body is not a JSON object;
- `categories` is not an array;
- `policyIdentifier` is missing, not a string, or `""`;
- `v` is present and not `2`;
- `policyTextVersion` or `defaultLocale` is present and not a string (`null` included);
- `locales` is present and not an array of strings;
- `vendors` is present and not an array of objects whose `id`, `category` and `name` are strings and whose `privacyPolicyUrl`, when present, is a string.

Not checked by the SDK, so the SaaS MUST validate them before publishing: element types and uniqueness of `categories`, absence of `necessary`, `mode`, `consentMaxAgeDays`, vendor `category` values, URL formats. Cached copies are validated with the same rules.

### 3.4 Versioning

`v` changes only for a breaking change. An SDK that reads an unknown `v` treats the config as invalid and runs on its local fallback, so a future `v: 3` config MUST be published under a different path (for example `/config/v3/{siteId}/...`) next to the v2 files, for as long as SDKs that read v2 are in use.

### 3.5 Example

`GET https://cdn.consentify.dev/config/site_8kq2m/latest.json`

```json
{ "current": "4f1c9a07be52d3e8" }
```

`GET https://cdn.consentify.dev/config/site_8kq2m/4f1c9a07be52d3e8.json`

```json
{
  "v": 2,
  "categories": ["analytics", "marketing"],
  "policyIdentifier": "2026-10-01",
  "policyTextVersion": "2026-10-01",
  "mode": "opt-in",
  "consentMaxAgeDays": 365,
  "locales": ["en", "de"],
  "defaultLocale": "en",
  "vendors": [
    { "id": "ga4", "category": "analytics", "name": "Google Analytics 4", "privacyPolicyUrl": "https://policies.google.com/privacy" },
    { "id": "meta-pixel", "category": "marketing", "name": "Meta Pixel", "privacyPolicyUrl": "https://www.facebook.com/privacy/policy/" }
  ]
}
```

## 4. Ingest v2

### 4.1 Endpoint

```
POST {ingest}/v2/events
Content-Type: application/json
```

One event per request; there is no batching. Bodies are small (the record is cookie-sized, under 4 KB); the ingest SHOULD reject bodies over 16 KB with `413`.

Who sends events:

- **Browser reporter**: started by `createCloudConsentify` in the browser. Sends one event per consent decision, that is every `set`, `acceptAll` and `rejectAll` that writes a new record (a repeat of the same choices with a `source`, such as a banner click, is a new decision with a new `id` and `givenAt`; a repeat without a `source` keeps the stored record and sends nothing), and on page load any decided record it has not reported yet. Uses `fetch` with `keepalive: true`, so events survive page unload. Auth: `X-Consentify-Key` when the integrator configured `publicKey`.
- **Server reporter**: `reportConsent(consent, { serverKey, setCookie | cookieHeader, visitorId?, timeoutMs? })`, called by the integrator after writing consent in server code (for example a Next.js Server Action). One call, one attempt, default timeout 3000 ms. Auth: `X-Consentify-Server-Key`. It throws in a browser, so the server key cannot be used from browser code by mistake.

### 4.2 Keys and headers

| | Public key | Server key |
|-|-----------|------------|
| Header | `X-Consentify-Key` | `X-Consentify-Server-Key` |
| Sent by | Browser reporter, only if `publicKey` is configured | `reportConsent`, always |
| Secret | No | Yes |
| May submit | Browser events for its site, without `proof` | Server events for its site, with or without `proof` |
| May not | Submit `proof`; read anything | Read anything (v2 has no read API) |

Rules for the ingest:

1. Each key belongs to exactly one site. A key whose site differs from the body's `siteId`: `403`.
2. A request carries at most one of the two headers. Both: `400`.
3. Public key: the ingest MAY require it per site. When a site requires it, a browser event without it, or with a key that does not match, gets `401`. Because the key is public it identifies the site rather than authenticating the sender; the abuse controls for browser events are the `Origin` check against the site's registered domains and rate limits (per site and per client IP).
4. Server key: an invalid server key gets `401`. A body with `proof` that was not authenticated by a valid server key gets `400`: browsers never send proofs, because the signing secret is server-only.
5. The ingest derives the event's channel (`browser` or `server`) from the header that authenticated it, never from the body, and stores it with the event.
6. The ingest MUST compare keys in constant time, SHOULD store only hashes of server keys, SHOULD allow two active server keys per site for rotation, and MUST NOT log key values.

Recommended key formats: `pk_live_...` / `sk_live_...` (and `_test_` variants), so a leaked server key is easy to recognize in code scans. The SDK treats both as opaque strings.

### 4.3 CORS (browser events)

A browser event is a cross-origin `POST` with `Content-Type: application/json` and possibly `X-Consentify-Key`, so browsers send a preflight first.

- `OPTIONS {ingest}/v2/events` MUST answer `204` with:
  - `Access-Control-Allow-Origin: *` (or the request's `Origin`)
  - `Access-Control-Allow-Methods: POST`
  - `Access-Control-Allow-Headers: Content-Type, X-Consentify-Key`
  - `Access-Control-Max-Age: 86400`
- The `POST` response MUST also carry `Access-Control-Allow-Origin`.
- The SDK sends no credentials (no cookies), so `*` is fine.
- `X-Consentify-Server-Key` MUST NOT be listed in `Access-Control-Allow-Headers`: a browser then cannot send the server key cross-origin even if it leaks into client code. Server-to-server requests are not subject to CORS.

### 4.4 Payload

```ts
interface IngestEvent {
  v: 2;
  eventId: string;
  siteId: string;
  action: 'accept_all' | 'reject_all' | 'customize';
  record: ConsentRecord;
  visitorHash?: string;
  sdkVersion: string;
  proof?: ConsentProof; // server events only
}

// Consent record v2, exactly as stored in the visitor's cookie.
interface ConsentRecord {
  v?: 2;                                // absent on v1 records written by SDK 2.x
  id?: string;                          // random id of the decision, 12 lowercase hex chars; absent on v1 records
  policy: string;                       // SiteConfig.policyIdentifier at decision time
  givenAt: string;                      // ISO 8601 UTC with milliseconds
  choices: Record<string, boolean>;     // "necessary": true plus every category
  pv?: string;                          // SiteConfig.policyTextVersion at decision time
  lang?: string;                        // language of the consent UI (BCP 47, unvalidated)
  src?: 'banner' | 'preferences' | 'api'; // which UI recorded the decision
}

interface ConsentProof extends ConsentRecord {
  signature: string;                    // 64 lowercase hex chars, HMAC-SHA256
}
```

`IngestEvent` is exported from `@consentify/core/cloud` for TypeScript consumers.

| Field | Present | Meaning |
|-------|---------|---------|
| `v` | always | Payload format, `2` |
| `eventId` | always | Random id of this event, the idempotency key (see [4.7](#47-deduplication)). A UUID v4 in practice; on pages without `crypto.randomUUID` (plain `http:` pages, very old browsers) a random string of about 20 characters from `[0-9a-z]`. Treat as an opaque string of at most 64 characters |
| `siteId` | always | Site the event belongs to |
| `action` | always | Derived by the SDK from `record.choices` and the instance's categories: `accept_all` when every user category is `true`, `reject_all` when every one is `false`, otherwise `customize`. A convenience: the SaaS can recompute it from `record` and the categories published under `record.policy` |
| `record` | always | The consent record as stored. v2 records have `v: 2`, `id` (the decision's identity, see [4.7](#47-deduplication)) and the optional `pv`, `lang`, `src`. v1 records (written by SDK 2.x and still valid in v3) have only `policy`, `givenAt` and `choices` |
| `visitorHash` | browser: always; server: only with an explicit `visitorId` | See [4.6](#46-visitorhash) |
| `sdkVersion` | always | Version of `@consentify/core` that built the event, e.g. `"3.0.0"` |
| `proof` | server events from instances with a `secret` | HMAC proof of `record`, see [4.8](#48-proofs) |

Notes:

- `record.givenAt` comes from the visitor's device clock (browser events) or the integrator's server clock (server events). The ingest SHOULD store its own `receivedAt` and use it for ordering and retention.
- `record.choices` holds every category of the policy at decision time plus `"necessary": true`.
- The ingest MUST ignore unknown fields in the event and in `record` (store them or drop them, but do not reject). New optional fields may appear in later SDK minor versions without a change of `v`.
- Validation the ingest SHOULD apply, answering `400` on failure: `v === 2`; `eventId` a string of 1 to 64 characters; `siteId` matches the key; `action` one of the three values; `record` an object with a non-empty string `policy`, a parseable `givenAt`, a `choices` object of booleans, `v` absent or `2`, and `id` absent or a string of at most 64 characters; `visitorHash`, when present, a string of at most 256 characters; `sdkVersion` a string; `proof` only with a server key (rule 4 above).

### 4.5 Responses and retries

- Success is any `2xx`. Recommended: `202` with an empty body. The SDK reads only the status; response bodies are ignored.
- A duplicate `eventId` is a success (`2xx`), not `409`.
- Any other status, a network error or a timeout counts as failure:
  - **Browser**: the event (URL, body and public key) is kept in `localStorage` (`consentify_event_buffer`, a single slot: a newer failure replaces it, and a later successful event clears it without resending it). On the next page load it is resent once with the identical body (same `eventId`) and then dropped, whatever the outcome.
  - **Server**: no retry. `reportConsent` resolves `false`.
- The SDK cannot tell permanent from transient errors, so validation failures SHOULD be `4xx`, never `5xx`. `429` is a failure like any other (at most one retry, on the next page load).
- The ingest SHOULD answer quickly (enqueue, then process): server actions wait for the response, up to the integrator's `timeoutMs`.

### 4.6 `visitorHash`

Despite the name, the SDK does not hash anything: `visitorHash` is an opaque pseudonymous string.

| Channel | Integrator `visitorId` | `action` | `visitorHash` |
|---------|------------------------|----------|---------------|
| Browser | set (string or factory) | any | The integrator's id as given (for example an account id) |
| Browser | not set | `accept_all`, `customize` | Random id stored in the visitor's `localStorage` (`consentify_visitor`): a UUID v4 (or the fallback format described for `eventId`), created at the first such decision and stable for that browser until a `reject_all` or until site data is cleared |
| Browser | not set | `reject_all` | A one-off token of 8 lowercase hex characters (e.g. `"3f9a0c1e"`), never stored; the stored id is deleted. Every refusal gets a new token |
| Server | passed to `reportConsent` | any | The integrator's id as given |
| Server | not passed | any | Absent (there is no stored id on the server) |

If an integrator's `visitorId` factory throws, a browser event carries a one-off token instead and a server event carries no `visitorHash`.

Rules for the SaaS:

- The SaaS MUST NOT use `visitorHash` to link a `reject_all` event to other events, and MUST NOT infer from its format which case applies (an integrator id can look like a token).
- The SaaS SHOULD store a keyed hash of `visitorHash` (for example HMAC-SHA256 with a per-site key) rather than the raw value. Lookups by an integrator's id still work by hashing the query.
- Counting distinct `visitorHash` values overcounts refusals (each one has a new token). This is by design.

### 4.7 Deduplication

Two levels:

1. **Event**: `(siteId, eventId)` is unique. A browser retry resends the identical body, so the same `eventId` arrives twice. Store it once and answer `2xx` to the duplicate.
2. **Decision**: one decision can arrive as several events with different `eventId`s:
   - a server event from `reportConsent`, then a browser event when the visitor loads the next page (the browser reporter reports every decided record it has not reported yet; it cannot know the server already did);
   - an integrator calling `reportConsent` twice for the same record;
   - rarely, two tabs racing before the browser's own dedup key is written.

   The identity of a decision is `(siteId, record.id)`. Every record the SDK v3 writes, in the browser or on the server, has a random `id`; `givenAt` alone is not enough, because two decisions in the same millisecond (two quick writes in one browser, or two visitors) share it. Records without `id` (v1 records written by SDK 2.x) fall back to `(siteId, record.policy, record.givenAt)`. The browser dedups with the same key (`consentify_last_event` holds `{siteId}|{policy}|{id}`, or `{siteId}|{policy}|{givenAt}` for a record without `id`, so reloads do not re-report). The SaaS SHOULD store one decision per identity and merge its events: keep `proof` from the server event, `visitorHash` from whichever event has one (the browser event, when the server event has none), the channels seen, and the earliest `receivedAt`. Events with the same identity but different `choices` should not occur; keep both and flag them.

A repeat of the same choices from the consent UI (a write with a `source`) has a new `id` and `givenAt` and is a new decision on purpose (re-affirmation is evidence too). A write without a `source` that leaves the choices unchanged (an integrator restoring saved choices on every page load) keeps the stored record: the browser sends nothing, and a server write returns a `Set-Cookie` header for the same record, so a `reportConsent` for it carries the same `id` and merges into that decision.

### 4.8 Proofs

A proof is present only on server events, and only when the integrator created the instance with a `secret`, an HMAC key that never leaves the integrator's server. The SaaS does not know this secret.

- Signed fields: `policy`, `givenAt`, `choices`, and `id`, `v`, `pv`, `lang`, `src` when present. Absent fields are left out of the signed body.
- `proof` = the signed fields + `signature`. `signature` = lowercase hex of HMAC-SHA256(secret, canonical), where canonical is the signed fields serialized as JSON without whitespace, with object keys sorted recursively (the SDK's `stableStringify`).
- The SaaS MUST store `proof` verbatim: it is the evidence.
- The SaaS SHOULD check, without the secret, that the proof's signed fields equal the same fields of `record` (deep equality on `policy`, `givenAt`, `choices`, `id`, `v`, `pv`, `lang`, `src`), and answer `400` on a mismatch.
- Verification is done by whoever holds the secret, normally the integrator, after exporting proofs from the dashboard:

  ```ts
  import { verifyProof } from '@consentify/core';

  await verifyProof(event.proof, process.env.CONSENT_SIGNING_SECRET!); // true, or false if any signed field was altered
  ```

  `verifyProof` runs in Node 20+ and in browsers (Web Crypto) and returns `false` instead of throwing. It also accepts proofs after a JSON round trip, so stored proofs verify as is.
- Reimplementing verification in another language requires reproducing the canonical form exactly. `stableStringify` orders keys with JavaScript `String.prototype.localeCompare`, which matches code-point order for lowercase ASCII keys but not in general (category names with upper-case letters, digits or symbols can sort differently). Use `verifyProof` instead.
- Proofs of v1 records (no `id`, `v`, `pv`, `lang`, `src`) are signed over `{ policy, givenAt, choices }` and verify the same way.

Worked example (the server event in [4.9](#49-examples)): with secret `example-signing-secret` the canonical form is

```
{"choices":{"analytics":true,"marketing":true,"necessary":true},"givenAt":"2026-10-07T12:35:10.402Z","id":"5d7e1a2b9c04","lang":"de","policy":"2026-10-01","pv":"2026-10-01","src":"banner","v":2}
```

and the signature is `64b7ff53608509a91e92426f622137748a5b2c64e7d9fa3ad0b8aed89c402d08`; `verifyProof` returns `true` for that proof and `false` once any signed field is changed.

### 4.9 Examples

**A. Browser accept (stored visitor id)**

```http
POST /v2/events HTTP/1.1
Host: ingest.consentify.dev
Origin: https://shop.example
Content-Type: application/json
X-Consentify-Key: pk_live_5f2b9c

{
  "v": 2,
  "eventId": "0f8b8a52-6d2e-4c47-9a0e-2b1d6f3c9e71",
  "siteId": "site_8kq2m",
  "action": "accept_all",
  "record": {
    "v": 2,
    "id": "8c1f2e9a4b7d",
    "policy": "2026-10-01",
    "givenAt": "2026-10-07T12:34:56.789Z",
    "choices": { "analytics": true, "marketing": true, "necessary": true },
    "pv": "2026-10-01",
    "lang": "en",
    "src": "banner"
  },
  "visitorHash": "550e8400-e29b-41d4-a716-446655440000",
  "sdkVersion": "3.0.0"
}
```

**B. Browser reject (one-off token)**

```http
POST /v2/events HTTP/1.1
Host: ingest.consentify.dev
Origin: https://shop.example
Content-Type: application/json
X-Consentify-Key: pk_live_5f2b9c

{
  "v": 2,
  "eventId": "7d4e2c90-1f3b-4a85-b6e7-58c0d9a2f163",
  "siteId": "site_8kq2m",
  "action": "reject_all",
  "record": {
    "v": 2,
    "id": "e4a90b3c7f12",
    "policy": "2026-10-01",
    "givenAt": "2026-10-07T12:40:02.115Z",
    "choices": { "analytics": false, "marketing": false, "necessary": true },
    "pv": "2026-10-01",
    "lang": "en",
    "src": "banner"
  },
  "visitorHash": "3f9a0c1e",
  "sdkVersion": "3.0.0"
}
```

**C. Server event with proof (no `visitorId` passed)**

```http
POST /v2/events HTTP/1.1
Host: ingest.consentify.dev
Content-Type: application/json
X-Consentify-Server-Key: sk_live_9d1e44

{
  "v": 2,
  "eventId": "c3a1d7e2-5b8f-4e09-a6d4-91f2e0b7c845",
  "siteId": "site_8kq2m",
  "action": "accept_all",
  "record": {
    "v": 2,
    "id": "5d7e1a2b9c04",
    "policy": "2026-10-01",
    "givenAt": "2026-10-07T12:35:10.402Z",
    "choices": { "analytics": true, "marketing": true, "necessary": true },
    "pv": "2026-10-01",
    "lang": "de",
    "src": "banner"
  },
  "sdkVersion": "3.0.0",
  "proof": {
    "policy": "2026-10-01",
    "givenAt": "2026-10-07T12:35:10.402Z",
    "choices": { "analytics": true, "marketing": true, "necessary": true },
    "id": "5d7e1a2b9c04",
    "v": 2,
    "pv": "2026-10-01",
    "lang": "de",
    "src": "banner",
    "signature": "64b7ff53608509a91e92426f622137748a5b2c64e7d9fa3ad0b8aed89c402d08"
  }
}
```

The integrator code that produced C:

```ts
const consent = await createCloudConsentify({ siteId: 'site_8kq2m', fallback, secret: process.env.CONSENT_SIGNING_SECRET! });
// in a Server Action:
const setCookie = consent.acceptAll({ cookieHeader, source: 'banner', lang: 'de' });
await reportConsent(consent, { serverKey: process.env.CONSENTIFY_SERVER_KEY!, setCookie });
```

With `visitorId: 'acct_1842'` in the `reportConsent` options, the body would also contain `"visitorHash": "acct_1842"`.

### 4.10 Legacy v1 events

SDK 2.x posted `{ siteId, action, categories, visitorHash, policyVersion, apiKey? }` to `{ingest}/v1/events`, with the key in the body. That format is not part of this contract. Installs of SDK 2.x, and the retry buffer of a browser upgraded from 2.x (replayed once by v3), may still send it once the default host is live. The ingest SHOULD answer `410 Gone` on `/v1/events` and MUST NOT store or log those bodies, since they can contain keys.

## 5. What the SaaS must implement

CDN publisher:

- [ ] Validate a SiteConfig before publishing: the SDK rules in [3.3](#33-validation-in-the-sdk) plus the SaaS rules in [3.2](#32-fields) (unique categories without `necessary`, valid `mode` and `consentMaxAgeDays`, vendor categories, URLs).
- [ ] Force a new `policyIdentifier` when categories change; warn the user that any identifier change re-prompts every visitor.
- [ ] Write `{hash}.json` (content hash, immutable), then `latest.json`, then purge `latest.json` at the edge.
- [ ] Serve both with `Access-Control-Allow-Origin: *`, JSON content type, and the `Cache-Control` values in [2.2](#22-response-headers); `404` for unknown sites; no cookies.
- [ ] Keep old `{hash}.json` files (at least 24 hours; RECOMMENDED forever) and store every published config by hash and `policyIdentifier`, so `record.policy` in any event resolves to its categories and texts.

Ingest:

- [ ] `POST /v2/events` and the `OPTIONS` preflight with the CORS headers in [4.3](#43-cors-browser-events) (`X-Consentify-Server-Key` not allowed cross-origin).
- [ ] Key checks from [4.2](#42-keys-and-headers): keys bound to one site, at most one key header, optional public key requirement per site, server key required for `proof`, constant-time comparison, hashed server keys, rotation, no key logging.
- [ ] `Origin` allowlist and rate limits for browser events.
- [ ] Payload validation from [4.4](#44-payload) (`400`), unknown fields ignored, `413` above 16 KB.
- [ ] Idempotency on `(siteId, eventId)`; duplicates answer `2xx`.
- [ ] Decision merge on `(siteId, record.id)`, falling back to `(siteId, record.policy, record.givenAt)` for records without `id`, as in [4.7](#47-deduplication).
- [ ] Store the event with `receivedAt` and the channel taken from the authenticating key; store `proof` verbatim after the record consistency check in [4.8](#48-proofs).
- [ ] Treat `visitorHash` as in [4.6](#46-visitorhash): keyed hash at rest, no linking of `reject_all` tokens.
- [ ] Answer fast (`202`, process asynchronously); `4xx` for client errors, never `5xx`.
- [ ] `410 Gone` for `/v1/events`, without storing or logging the body.

Dashboard:

- [ ] Issue a public key and a server key per site (show the server key once; allow rotation with two active keys).
- [ ] Export stored events with their proofs as JSON, for integrators to verify with `verifyProof`.

Privacy:

- [ ] Anything stored beyond the event payload (IP address, User-Agent, `receivedAt`) and the retention periods must be added to `docs/guides/cloud-privacy.md`, which is the integrator-facing description of what cloud mode collects.

## 6. Design decisions

**Keys only in headers.** In v1 the key was also in the body, so it ended up wherever bodies go: the browser retry buffer, request logs, the stored event. A header keeps it out of stored data. There are two keys because the browser key is public by nature and can only identify a site, while server events carry proofs and need real authentication. Not allowing the server key header in CORS means a server key pasted into client code still cannot be used from a browser.

**The full record instead of `categories` and `policyVersion`.** The record is the evidence: `pv`, `lang` and `src` answer what the visitor saw, in which language and through which UI. Sending it unchanged also lets the ingest check a proof against the record it signs.

**Random `eventId`, separate decision identity.** `eventId` identifies one event and makes retries idempotent. It is deliberately not derived from the record: a server event and the browser's later event for the same decision carry different, complementary data (`proof` versus `visitorHash`), so the second one must not be dropped as a duplicate. They are merged by decision identity (`record.id`) instead.

**`reportConsent(consent, { serverKey, setCookie | cookieHeader, visitorId?, timeoutMs? }): Promise<boolean>`.**

- It takes the instance from `createCloudConsentify`. The site id and ingest endpoint come from `consent.cloud` (`siteId`, `ingest`), and the record is read and `action` derived with the instance's policy, so a call cannot report to another site or endpoint than the instance's, and a record written under another policy is not reported at all. The instance's `secret`, if any, signs the proof, so there is no second secret to pass.
- It reads the record from the `Set-Cookie` header the write returned: exactly what was written, metadata included, with no request parsing. `cookieHeader` covers records written elsewhere. Either way the record is validated like a read (policy, expiry), and an unset or cleared cookie resolves `false` without a request.
- The server key is a per-call option, not a `CloudInit` field: `CloudInit` is often shared between server and client code, and a secret in it would end up in client bundles. `reportConsent` also throws `ConsentifyConfigError` in a browser, like `secret`, and is left out of the script-tag (IIFE) bundle.
- It resolves `true` or `false` and never rejects: reporting must not break the consent action it follows. It makes one attempt with a timeout (default 3000 ms) because server actions wait for it, and keeps no retry state, which a serverless function could not keep anyway; the browser reporter covers the decision again on the next page load.
- `visitorHash` is sent only for an explicit `visitorId`. There is no stored id on the server, and a one-off token would add nothing.

**`sdkVersion`** lets the SaaS attribute anomalies to SDK versions and plan contract changes. It is read from `@consentify/core`'s `package.json` at build time, so every published bundle carries its real version.

**SiteConfig validation is strict on types.** A wrong type in any field sends the visitor to the cache or the local fallback instead of half-applying a config. Consent keeps working in that case, and an obvious, total failure is easier to catch before publishing than a partial one.
