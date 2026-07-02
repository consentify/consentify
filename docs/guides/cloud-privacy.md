# Cloud Mode: Data & Privacy

This document describes what data cloud mode (`createConsentify({ siteId })`) collects, stores, and transmits. For self-hosted mode (`policy` only), no network calls are made.

## Self-Hosted Mode (No Cloud)

When you create an instance with only a policy:

```ts
const consent = createConsentify({
  policy: { categories: ['analytics', 'marketing'] as const },
});
```

**Zero network calls** - all consent decisions stay in-browser cookies and localStorage. Nothing is sent to any server.

## Cloud Mode (Hosted Platform)

When you provide a `siteId`:

```ts
const consent = createConsentify({
  siteId: 'your-site-id',
  apiKey: 'optional-api-key', // if required by your setup
});
```

Consentify reports consent changes to the hosted platform for audit trails and analytics. The platform is not live yet - this documents the contract when it launches.

## Local Storage

Cloud mode uses three localStorage keys:

| Key | Purpose | Lifetime | Content |
|-----|---------|----------|---------|
| `consentify_visitor` | Stable visitor identifier | Persistent (until the user clears site data) | Random UUID v4 or fallback generated at first use |
| `consentify_event_buffer` | Retry buffer for failed events | Until next successful send | JSON: `{ url, body, apiKey? }` |
| `consentify_last_event` | Deduplication key | Persistent | `siteId\|policyHash\|givenAt` to prevent re-reporting identical decisions |

If localStorage is unavailable (private browsing, quota exceeded, etc.), deduplication falls back to in-memory only - no errors. Events retry on next page load if the first attempt failed.

## Event Payload

Each consent change is POSTed to `https://ingest.consentify.dev/v1/events` (or your custom endpoint):

```json
{
  "siteId": "your-site-id",
  "action": "accept_all" | "reject_all" | "customize",
  "categories": {
    "analytics": true,
    "marketing": false,
    "necessary": true
  },
  "visitorHash": "550e8400-e29b-41d4-a716-446655440000",
  "policyVersion": "abc123def456",
  "apiKey": "optional-key-if-configured"
}
```

- **action**: Derived from the decision: `accept_all` (all user categories granted), `reject_all` (none granted), `customize` (mixed or unset)
- **categories**: Full snapshot of choices including `necessary` (always `true`)
- **visitorHash**: Pseudonymous identifier - stable per-visitor, unrelated to personal data
- **policyVersion**: Hash of the policy definition; changes when categories change
- **apiKey**: Only included if provided in the SDK config (for server-to-server auth)

## Visitor ID

The visitor identifier can be controlled:

```ts
// Default: auto-generated UUID and persisted to localStorage
const consent1 = createConsentify({ siteId: '...' });

// Custom string
const consent2 = createConsentify({
  siteId: '...',
  visitorId: 'user-123',
});

// Custom factory (sync or async)
const consent3 = createConsentify({
  siteId: '...',
  visitorId: async () => {
    const user = await fetchCurrentUser();
    return user?.id || generateAnonymousId();
  },
});
```

The ID is included in the `visitorHash` field of the event payload as a pseudonymous identifier for consent analytics.

## Reject All Is Reported

Consent decisions are recorded for both acceptances and rejections. This is intentional - proof-of-consent requires documenting both grants and refusals for audit trails and compliance. The `action: reject_all` event proves the user refused optional categories on a given date.

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

> "We use Consentify, a privacy-first consent management platform, to record your consent choices. A pseudonymous visitor identifier (UUID) is stored locally to prevent duplicate reporting. Consent decisions are sent to Consentify's servers for compliance and analytics purposes."

## Data Retention & Deletion

The hosted platform is not live yet - retention policies will be documented when the service launches. Until then, assume:

- Events are stored server-side for compliance auditing
- Visitor IDs are stable (not automatically deleted)
- No built-in user data deletion API yet

## Custom Endpoint

You can redirect events to your own server instead:

```ts
const consent = createConsentify({
  siteId: 'your-site-id',
  ingestEndpoint: 'https://your-server.com/api/consent-events',
});
```

Events are identical in structure. Your endpoint must accept POST requests with the payload above and return HTTP 2xx on success.

## No Identifier Linking

Cloud mode does not:
- Accept email addresses, names, or personally identifiable data
- Link consent to user profiles (you do that server-side if needed)
- Track page views or session data beyond consent events
- Set third-party cookies

## Transport Security

All events are sent via HTTPS with `keepalive: true` (survives page unload). The `X-API-Key` header is used for optional auth if you configure `apiKey`.

---

See [API Reference](./api-reference.md) for the full `createConsentify` config options.
