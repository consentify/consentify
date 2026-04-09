# @consentify/core

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
