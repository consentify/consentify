# Cloud Mode: Data & Privacy

This document describes what data cloud mode (`createCloudConsentify({ siteId })` from `@consentify/core/cloud`) collects, stores, and transmits. For self-hosted mode (`createConsentify({ policy })` from `@consentify/core`), no network calls are made and the cloud client is not part of your bundle.

## Self-Hosted Mode (No Cloud)

When you create an instance with only a policy:

```ts
const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
});
```

**Zero network calls** - all consent decisions stay in-browser cookies and localStorage. Nothing is sent to any server.

## Cloud Mode (Hosted Platform)

When you create the instance with `createCloudConsentify` and a `siteId`:

```ts
import { createCloudConsentify } from '@consentify/core/cloud';

const consent = await createCloudConsentify({
  siteId: 'your-site-id',
  publicKey: 'pk_live_...', // optional; public, sent as a request header
  fallback: { categories: ['analytics', 'marketing'], identifier: 'your-published-policy-identifier' },
});
```

Consentify reports consent changes to the hosted platform for audit trails and analytics. The platform is not live yet - this documents the contract when it launches.

## SiteConfig Requests

To build the instance, the SDK loads the site's configuration (categories, policy identifier and text version, defaults, banner locales and vendor list) with plain `GET` requests to `https://cdn.consentify.dev/config/<siteId>/latest.json` and `/config/<siteId>/<hash>.json` (or your `endpoints.config`). The SDK adds no visitor identifier, consent choices or key to these requests. The result is cached (see below), so most page loads and server renders make no request at all.

## Offline Behavior

If the CDN is unreachable, slow (beyond `timeoutMs`, default 3 seconds), answers with an error, or serves a malformed config:

- A cached SiteConfig, even an expired one, is used as is.
- With no cache, the instance is built from the required `fallback` policy and one `console.warn` is logged. Consent keeps working: the banner, `guard()` and cookie storage behave as with a self-hosted policy.
- The factory does not reject, so the site's consent layer does not go down with the CDN.

Set `fallback.identifier` to the site's published policy identifier. Otherwise the fallback has a different policy version than the published one, and returning visitors are asked again while the fallback is active.

## Local Storage

Cloud mode uses four localStorage keys:

| Key | Purpose | Lifetime | Content |
|-----|---------|----------|---------|
| `consentify_visitor` | Visitor identifier for consent records (not used when you pass `visitorId`) | Created at the first `accept_all` or `customize` decision, never on page load. Deleted when the visitor chooses `reject_all`; otherwise kept until site data is cleared | Random UUID v4 (a `Math.random` fallback on browsers without Web Crypto) |
| `consentify_event_buffer` | Retry buffer for the last failed event | Until the next successful send, or the next page load, which retries it once | JSON: `{ url, body, publicKey? }` - the event payload below and your public key |
| `consentify_last_event` | Deduplication key | Persistent | `siteId\|policyHash\|givenAt` to prevent re-reporting identical decisions |
| `consentify_cfg_<siteId>` | SiteConfig cache | Overwritten on each refresh; fresh for `configTtlSec` (default 1 hour), then served stale while refreshing | JSON: `{ t, h, c }` - fetch time, config hash, and the site's public SiteConfig. No visitor data |

If localStorage is unavailable (private browsing, quota exceeded, etc.), deduplication falls back to in-memory only and the SiteConfig is fetched on every page load - no errors. Events retry on next page load if the first attempt failed.

## Consent Record

The consent record kept in the `consentify` cookie (and passed to a custom `adapter`) stores the policy version, timestamp and choices, plus the policy text version (`pv`), the language of the consent UI (`lang`) and which UI recorded the decision (`src`: `banner`, `preferences` or `api`). These fields describe what the visitor was shown, not who the visitor is. Every event carries the full record (see below).

## Event Payload

Each consent change in the browser is POSTed to `https://ingest.consentify.dev/v2/events` (or your custom endpoint):

```json
{
  "v": 2,
  "eventId": "9b2f7c1e-4d3a-4f6b-8e21-0c5d7a9e3f14",
  "siteId": "your-site-id",
  "action": "customize",
  "record": {
    "v": 2,
    "policy": "2026-10-01",
    "givenAt": "2026-10-07T12:34:56.789Z",
    "choices": { "necessary": true, "analytics": true, "marketing": false },
    "pv": "2026-10-01",
    "lang": "en",
    "src": "preferences"
  },
  "visitorHash": "550e8400-e29b-41d4-a716-446655440000",
  "sdkVersion": "3.0.0"
}
```

- **eventId**: Random UUID for this event, so a retried event is stored once. Not linked to the visitor
- **action**: Derived from the decision: `accept_all` (all user categories granted), `reject_all` (none granted), `customize` (mixed)
- **record**: The [consent record](#consent-record) as stored in the cookie: policy version, timestamp, choices (including `necessary`, always `true`), and `pv`, `lang`, `src` when set. Records written by SDK 2.x have only `policy`, `givenAt` and `choices`
- **visitorHash**: Your `visitorId` if you set one. Otherwise the stored random id for `accept_all` and `customize`, and a one-off 8-character hex token for `reject_all` (see [Visitor ID](#visitor-id))
- **sdkVersion**: Version of `@consentify/core` that sent the event

Your public key, if configured, is sent only in the `X-Consentify-Key` request header, never in the body. It identifies the site and is not a secret.

## Server Events

Decisions made in server code (for example a Next.js Server Action calling `consent.acceptAll({ cookieHeader })`) can be reported with `reportConsent(consent, { serverKey, setCookie })` from `@consentify/core/cloud`. A server event has the same shape as above, with two differences:

- **visitorHash** is present only when you pass `visitorId`. There is no stored visitor id on the server, so by default server events carry no visitor identifier at all.
- **proof**: when the instance was created with a `secret`, the event includes an HMAC-SHA256 signature of the record (`{ ...record, signature }`). It contains no data beyond the record. Browser events never carry a proof.

Server events authenticate with your server key in the `X-Consentify-Server-Key` header. Keep it in server-only environment variables; `reportConsent` throws when called in a browser.

The browser also reports a server-written record on the next page load (it has not reported it yet), so the platform may receive the same decision twice and stores it once.

## Visitor ID

The SDK resolves the identifier when it sends an event, not when the page loads.

**Default (no `visitorId`):**

- Before the first decision the SDK does not read or write `consentify_visitor`. A visitor who never decides gets no identifier. Retrying a buffered event does not create one either: the retry resends the stored payload as is.
- `accept_all` or `customize`: the SDK reads `consentify_visitor`, creates a random UUID there if none exists, and sends it as `visitorHash`. Later events from the same browser carry the same id.
- `reject_all`: the SDK deletes `consentify_visitor` if present and sends a one-off token of 8 random hex characters (for example `"3f9a0c1e"`) as `visitorHash`. The token is never stored, so every refusal gets a new one and cannot be linked to earlier or later events from that browser.
- With an `adapter`, `adapter.save()` needs a key for every decision, so it creates `consentify_visitor` after any decision, `reject_all` included. On page load, `adapter.load()` runs only when an id is already stored.

**Custom `visitorId`:**

```ts
const fallback = { categories: ['analytics'], identifier: 'your-published-policy-identifier' };

// Custom string
const consent = await createCloudConsentify({
  siteId: '...',
  fallback,
  visitorId: 'user-123',
});

// Custom factory (sync or async), e.g. the signed-in account
const consent2 = await createCloudConsentify({
  siteId: '...',
  fallback,
  visitorId: async () => (await fetchCurrentUser()).id,
});
```

A custom `visitorId` is sent as `visitorHash` with every browser event, `reject_all` included, and is passed to the adapter. The SDK then never reads, creates or deletes `consentify_visitor`. The reporter calls a factory once per event; if the factory throws or rejects, that event carries a one-off token instead.

### Legal basis

The stored id lets a consent record be attributed to the same browser over time. GDPR requires the controller to be able to demonstrate that the user consented (Art. 7(1)) and to demonstrate compliance in general (accountability, Art. 5(2)). For that reason the reporter creates the id only once the visitor has granted at least one optional category, and uses it only in consent records. Refusals are reported without a persistent identifier: the stored id is deleted and the `reject_all` event carries a one-off token. A custom `visitorId`, and the key an `adapter` stores records under, are your own; choosing them, and having a legal basis for keeping them with consent records, is your responsibility.

## Reject All Is Reported

Consent decisions are recorded for both acceptances and rejections. This is intentional - proof-of-consent requires documenting both grants and refusals for audit trails and compliance. The `action: reject_all` event proves the user refused optional categories on a given date. Without a custom `visitorId` it carries a one-off token, not the visitor id (see [Visitor ID](#visitor-id)).

## No Bundled Tracking Scripts

Cloud mode **does not** block, load, or interfere with third-party tracking scripts. It only reports consent state changes to the platform. Use `guard()` to conditionally load your tracking scripts:

```ts
consent.guard('analytics', () => {
  // Your own script loading logic
  gtag('consent', 'update', {...});
});
```

## Privacy Notes for Your Policy

If you use cloud mode, your privacy policy should mention:

- You collect pseudonymous consent decisions via Consentify
- Visitor identifiers are UUIDs or identifiers you provide (not names, emails, etc.)
- Data is retained by the Consentify platform for audit and reporting purposes
- Visitors can clear localStorage to reset their visitor ID

Example language:

> "We use Consentify, a privacy-first consent management platform, to record your consent choices. When you allow at least one optional category, a pseudonymous visitor identifier (UUID) is stored locally so your consent record can be attributed to this browser; it is deleted if you reject all optional categories. Consent decisions are sent to Consentify's servers for compliance and analytics purposes."

## Data Retention & Deletion

The hosted platform is not live yet - retention policies will be documented when the service launches. Until then, assume:

- Events are stored server-side for compliance auditing
- A stored visitor ID stays in the browser until the visitor chooses `reject_all` or clears site data
- No built-in user data deletion API yet

## Custom Endpoint

You can redirect events to your own server instead:

```ts
const consent = await createCloudConsentify({
  siteId: 'your-site-id',
  fallback, // as above
  endpoints: { ingest: 'https://your-server.com/api/consent' }, // POSTs to .../api/consent/v2/events
});
```

Events are identical in structure. Your endpoint must accept POST requests with the payload above and return HTTP 2xx on success. `reportConsent` posts to the same endpoint.

## No Identifier Linking

Cloud mode does not:
- Accept email addresses, names, or personally identifiable data
- Link consent to user profiles (you do that server-side if needed)
- Track page views or session data beyond consent events
- Set third-party cookies

## Transport Security

All events are sent via HTTPS with `keepalive: true` (survives page unload). Keys travel only in request headers, never in the event body:

| Header | Key | Where | What it allows |
|--------|-----|-------|----------------|
| `X-Consentify-Key` | `publicKey` | Browser events | Submitting browser events for its site. Public: it ships in your client bundle |
| `X-Consentify-Server-Key` | `serverKey` | `reportConsent` (server) | Submitting server events for its site, including proofs. Secret: never expose it to the browser |

---

See [API Reference](./api-reference.md#createcloudconsentifyinit--consentifycorecloud) for the full `createCloudConsentify` config options.
