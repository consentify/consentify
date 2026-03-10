# @consentify/cloud

Cloud adapter for [@consentify/core](../core/) - connects the consent SDK to Consentify SaaS analytics.

## Overview

`@consentify/cloud` is a lightweight adapter (~2KB gzipped) that bridges your local consent state with Consentify SaaS cloud analytics. It subscribes to consent changes and automatically posts events to your SaaS backend.

## Installation

```bash
npm install @consentify/cloud @consentify/core
```

## Usage

```typescript
import { createConsentify } from '@consentify/core';
import { enableCloud } from '@consentify/cloud';

// Create a consent instance
const consent = createConsentify({
  policy: {
    categories: ['analytics', 'marketing'],
  },
});

// Enable cloud analytics
const unsubscribe = enableCloud(consent, {
  siteId: 'your-site-id',
  apiKey: 'optional-api-key',
  endpoint: 'https://api.consentify.dev', // optional, defaults to https://consentify.dev/api
});

// Later, if needed:
unsubscribe();
```

## How it works

1. **Initialization**: `enableCloud()` posts the current consent state immediately (if already decided)
2. **Subscription**: Subscribes to future consent changes via `instance.subscribe()`
3. **Event posting**: When consent changes, posts an event to `/api/consent/events`
4. **Deduplication**: Only posts when choices or policy version actually change
5. **Visitor tracking**: Generates and persists a visitor hash in `localStorage` for analytics

## Silent failure

Network errors are silently swallowed and never block consent operations. This ensures consent logic remains fast and responsive even if analytics is unavailable.

## Visitor hash persistence

The visitor hash is stored in `localStorage` under the key `consentify_visitor`. This allows Consentify SaaS to track consent events across page loads and sessions.

If `localStorage` is unavailable (private browsing, blocked, etc.), a temporary hash is generated per session.

## API endpoints

### POST /api/consent/events

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: [optional]`

**Body:**
```json
{
  "siteId": "uuid",
  "action": "accept_all" | "reject_all" | "customize",
  "categories": {
    "necessary": true,
    "analytics": true,
    "marketing": false
  },
  "visitorHash": "uuid",
  "policyVersion": "abc123"
}
```

**Action derivation:**
- `accept_all`: All non-necessary categories granted
- `reject_all`: All non-necessary categories denied
- `customize`: Mixed/partial choices

## TypeScript

Full TypeScript support. The adapter is generic over your category types:

```typescript
type MyCategories = 'analytics' | 'marketing' | 'preferences';

const consent = createConsentify({
  policy: {
    categories: ['analytics', 'marketing', 'preferences'],
  },
});

enableCloud(consent, { siteId: 'site-1' });
```

## License

MIT
