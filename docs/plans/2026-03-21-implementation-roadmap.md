# Consentify SDK - Implementation Roadmap

**Date**: 2026-03-21
**Status**: Final synthesis from Architecture, Market, Feasibility, and DX analysis agents

---

## Executive Summary

The aspirational checklist describes a full consent platform (16+ integrations, banner UI, script tag mode, route guards). **That's the wrong direction.** The current 530-line headless SDK is the competitive advantage - it's the only serious typed, SSR-safe, zero-dependency consent state machine in the market.

**Strategy**: Stay headless. Strengthen the core. Add adapters where they unlock SaaS revenue. Skip everything that bloats the SDK or duplicates what the SaaS platform should own.

### Agent Consensus Matrix

| Feature | Architect | Market | Critic | DX | Final |
|---------|-----------|--------|--------|-----|-------|
| Events system in core | BUILD | - | - | BUILD | **BUILD** |
| Enhanced React hook | BUILD | - | - | BUILD | **BUILD** |
| Cloud bidirectional (SaaS config fetch) | BUILD | BUILD | BUILD | BUILD | **BUILD** |
| Debug mode (minimal) | BUILD | SKIP | BUILD | BUILD | **BUILD** |
| Test coverage | - | BUILD | BUILD | - | **BUILD** |
| Integration registry (16+) | BUILD (separate pkg) | SKIP | SKIP | BUILD (separate pkg) | **DEFER** - docs first |
| React banner component | BUILD (separate pkg) | SKIP | SKIP/DEFER | BUILD (separate pkg) | **DEFER** - unstyled skeleton only |
| UMD/Script tag bundle | BUILD | DEFER | DEFER | BUILD | **DEFER** |
| Route exclusions / SPA | BUILD (separate pkg) | SKIP | SKIP | - | **SKIP** |
| ConsentifyProvider | BUILD (separate pkg) | - | SKIP | SKIP | **SKIP** |
| Global window API | BUILD | SKIP | DEFER | BUILD | **DEFER** (only with UMD) |
| Shadow DOM | - | SKIP | SKIP | - | **SKIP** |
| hasConsented/resetConsent aliases | - | - | SKIP | - | **SKIP** |
| @consentify/next package | BUILD | - | - | SKIP | **SKIP** - current pattern is optimal |

---

## Phase 0: Foundation (Week 1-2)

> Test coverage and confidence before adding features.

### 0.1 Cloud package tests
- **What**: Unit tests for `@consentify/cloud` (mock fetch, test event payloads, deduplication, visitor hash, SSR no-op)
- **Why**: Cloud has zero tests. It's the SaaS revenue path - can't ship new cloud features untested.
- **Effort**: S (2-3 days)
- **Acceptance**: All cloud functions covered, mock fetch assertions, edge cases (network failure, malformed response)

### 0.2 React hook tests
- **What**: Unit tests for `useConsentify` (mock instance, test state transitions, SSR snapshot)
- **Why**: React package has zero tests. About to enhance the hook API.
- **Effort**: S (1-2 days)
- **Acceptance**: Hook returns correct state, re-renders on subscribe, SSR returns unset

### 0.3 Bundle size CI check
- **What**: Add `size-limit` or `bundlesize` to CI pipeline. Fail if core exceeds 5kb gzipped.
- **Why**: Zero-dependency, small bundle is the core value prop. Must enforce it.
- **Effort**: S (0.5 day)
- **Acceptance**: CI fails on size regression, badge in README

### 0.4 E2E smoke test
- **What**: Single Playwright test: page loads -> banner visible -> accept -> consent stored -> reload -> banner gone
- **Why**: Proves the full flow works in a real browser. Catches SSR/hydration issues.
- **Effort**: S (1-2 days)
- **Acceptance**: E2E passes in CI (headless Chrome)

**Phase 0 total**: ~1.5-2 weeks

---

## Phase 1: Core Enhancements (Week 3-4)

> Minimal, non-breaking additions to core that unlock everything else.

### 1.1 Typed event system (`on` / `once`)

- **What**: Add `instance.on(type, handler)` and `instance.once(type, handler)` to `createConsentify()` return value
- **API**:
  ```ts
  consent.on('change', (e) => { /* e.from, e.to, e.timestamp */ })
  consent.on('clear', (e) => { /* e.timestamp */ })
  consent.once('change', handler) // auto-unsubscribe after first call
  ```
- **Implementation**: ~40-50 lines using lightweight internal emitter (not EventTarget - smaller, no DOM dependency for Node)
- **Why**: Enables analytics, SaaS event collection, debug logging, and integration hooks - all without subscribe() boilerplate. Every agent recommended this.
- **Breaking**: No. `subscribe()` stays, `on()` is additive.
- **Effort**: S (2-3 days including tests)

**Pros**:
- Unlocks all adapter patterns (cloud, debug, integrations)
- Type-safe event payloads
- ~40 lines, well under budget

**Cons**:
- Slightly increases core surface area
- Must maintain event type contracts

**Acceptance**: Events fire correctly on set/clear, types infer properly, existing subscribe() unaffected, tests pass

### 1.2 Enhanced `useConsentify` hook with category overload

- **What**: Add optional `category` parameter to `useConsentify(instance, category?)` returning `boolean`
- **API**:
  ```tsx
  const state = useConsentify(consent)           // ConsentState<T>
  const ok = useConsentify(consent, 'analytics')  // boolean
  ```
- **Implementation**: ~15 lines - second `useSyncExternalStore` call with `instance.get(category)` as snapshot
- **Why**: Most common React use case is "is this category granted?" - currently requires manual extraction from ConsentState.
- **Breaking**: No. Existing single-arg usage unchanged.
- **Effort**: S (1 day including tests)

**Acceptance**: Overload types work, boolean re-renders on category change only, SSR returns false

### 1.3 Debug adapter (`enableDebug`)

- **What**: `enableDebug(instance, options?)` that hooks into `on()` events and logs operations
- **API**:
  ```ts
  enableDebug(consent)                          // default: console.log
  enableDebug(consent, { onLog: (e) => {} })    // custom handler
  ```
- **Implementation**: Subscribes to all events via `on()`, formats and logs. ~30-40 lines in core or as separate export.
- **Why**: Developers need visibility during development. Critic approved minimal version. Market analyst says skip, but it's low-cost.
- **Breaking**: No.
- **Effort**: S (1 day)

**Pros**:
- Helps developers troubleshoot
- Custom onLog enables production logging (Sentry, DataDog)
- Tiny footprint, tree-shakeable

**Cons**:
- Minor API surface increase
- Must decide: core export or separate package?

**Decision**: Export from core (it's ~30 lines and depends on the event system). Tree-shakers remove it if unused.

**Acceptance**: Logs all state changes by default, custom handler works, no output when not enabled

### 1.4 Publish `@consentify/core@3.0.0`

- **What**: Bump major version for new event API, publish
- **Why**: Even though it's non-breaking, the event system is a significant API addition. Semver major signals "new capabilities".
- **Effort**: S (0.5 day)

**Actually**: Architect and DX designer disagree on versioning. Events + debug are additive, non-breaking. **Use minor version**: `@consentify/core@2.2.0`. Save v3 for when there's an actual breaking change.

**Phase 1 total**: ~1.5-2 weeks

---

## Phase 2: SaaS Enablement (Week 5-7)

> The features that directly unlock SaaS revenue.

### 2.1 Cloud bidirectional - `enableSaaS()` adapter

- **What**: Async adapter that fetches policy config from SaaS API via token, then subscribes for event reporting
- **API**:
  ```ts
  import { enableSaaS } from '@consentify/cloud'

  const consent = createConsentify({
    policy: { categories: ['analytics', 'marketing'] } // local fallback
  })

  enableSaaS(consent, { token: 'site_xxxxx' })
    .then(config => console.log('SaaS config loaded'))
    .catch(() => console.warn('Using local fallback'))
  ```
- **SaaS API contract**:
  - `GET /api/config/{token}` - returns `{ policy, banner, translations? }`
  - `POST /api/consent/events` - existing event reporting
- **Key design decisions**:
  - **Sync factory preserved**: `createConsentify()` stays synchronous. SaaS fetch is fire-and-forget.
  - **Fallback required**: Local policy config is always the fallback. SaaS being down doesn't break the SDK.
  - **No polling**: Fetch once on init. Policy changes require page reload or manual re-fetch.
  - **Cache**: Store fetched config in localStorage with TTL. Serve stale if offline.
- **Effort**: M (1-2 weeks)

**Pros**:
- Directly powers SaaS visual builder -> deployed policy
- Offline fallback prevents SaaS dependency
- Adapter pattern - doesn't bloat core

**Cons**:
- Async bootstrap means consent state is unknown briefly (must handle loading)
- Cache invalidation complexity
- Tight coupling to SaaS API contract

**Risk mitigation**:
- Apps handle loading state themselves (SDK doesn't dictate UI)
- Cache TTL defaults to 1 hour, configurable
- API contract versioned in URL (`/v1/config/`)

**Acceptance**: Fetches config, falls back gracefully, caches, composes with existing enableCloud(), SSR no-op, tests with mock fetch

### 2.2 Integration documentation (guard() examples)

- **What**: Instead of building 16 integration packages, write thorough docs showing `guard()` patterns for the top 5 services
- **Examples to document**:
  1. Google Analytics 4 (via guard + gtag)
  2. Google Tag Manager (via guard + dataLayer)
  3. Facebook/Meta Pixel (via guard + fbq)
  4. PostHog (via guard + posthog-js)
  5. Hotjar (via guard + hj)
- **Format**: Runnable code examples in README + dedicated `/docs/integrations/` directory
- **Effort**: S (2-3 days)

**Pros (vs building integration packages)**:
- Zero maintenance burden (users own their integration code)
- No third-party API version coupling
- guard() already handles the lifecycle perfectly
- Covers 80% of demand (GA + GTM + Meta = most web properties)

**Cons**:
- Less "batteries included" than competitors
- Users must copy-paste and adapt

**Critic's verdict**: "Skip the registry. Ship guard() examples in docs. A well-documented guard pattern for GA, GTM, FB Pixel covers 90% of real use cases."

**Market analyst's finding**: "SaaS CMPs don't ship GA4 code, they wire GTM triggers. Lightweight libraries leave developers to wire it themselves."

**Decision**: Docs first. Revisit `@consentify/integrations` package only if user demand proves it.

**Acceptance**: 5 integration guides with runnable code, tested in example project

### 2.3 Next.js App Router guide

- **What**: Complete, copy-paste-ready Next.js 15 guide showing server + client consent flow
- **Why**: "This is our niche - no one does this well" (from original checklist). DX designer confirms current pattern is already optimal - just needs better docs.
- **Content**:
  - `lib/consent.ts` - instance definition
  - `app/layout.tsx` - server-side consent reading
  - `components/CookieBanner.tsx` - client-side banner
  - `components/ConsentGate.tsx` - conditional rendering
  - Middleware example (optional)
- **Effort**: S (1-2 days)

**Acceptance**: Guide works with `create-next-app`, covers SSR + client, no @consentify/next package needed

**Phase 2 total**: ~2-3 weeks

---

## Phase 3: Ecosystem (Week 8-12)

> Optional packages that extend reach. None are SaaS-blocking.

### 3.1 `@consentify/ui` - Headless React components

- **What**: Unstyled, accessible component primitives. NOT a design system.
- **Components**:
  - `<ConsentGate instance={} category="">` - render children only if category granted
  - `<ConsentBanner instance={}>` - semantic HTML skeleton (dialog, buttons, no CSS)
- **API**:
  ```tsx
  import { ConsentGate, ConsentBanner } from '@consentify/ui'

  <ConsentGate instance={consent} category="analytics" fallback={<Placeholder />}>
    <AnalyticsDashboard />
  </ConsentGate>

  <ConsentBanner
    instance={consent}
    onAcceptAll={() => consent.set({ analytics: true, marketing: true })}
    onRejectAll={() => consent.set({ analytics: false, marketing: false })}
  />
  ```
- **Styling**: None. Users bring their own CSS/Tailwind/styled-components. Ship CSS variable example in docs.
- **Effort**: M (1-2 weeks)

**Pros**:
- Reduces banner boilerplate for new projects
- Accessible HTML structure (dialog, proper ARIA)
- Headless = no design opinions to maintain

**Cons**:
- "Headless UI component" is an oxymoron - users still expect something visual
- Even unstyled components need a11y testing
- Small user base (most teams build custom banners)

**Critic's view**: "If you ship a banner, ship a minimal HTML skeleton with no CSS. No themes, no animations, no translations."

**Market's view**: "Every brand hates generic designs. Skip or provide one default, rest copy-paste."

**Decision**: Build ConsentGate (high utility, tiny). ConsentBanner only as a reference implementation in docs, not a published component.

### 3.2 UMD/IIFE bundle

- **What**: esbuild IIFE bundle of core, published as `consentify.global.min.js`
- **Build**:
  ```bash
  esbuild packages/core/src/index.ts --bundle --format=iife --global-name=Consentify --minify --outfile=dist/consentify.global.min.js
  ```
- **Usage**:
  ```html
  <script src="https://cdn.consentify.dev/v2/consentify.global.min.js"></script>
  <script>
    const consent = Consentify.createConsentify({
      policy: { categories: ['analytics', 'marketing'] }
    });
  </script>
  ```
- **No auto-init**, no `window.ConsentifyConfig` magic. Explicit factory call.
- **Size target**: <5kb gzipped (core is ~2-3kb minified today)
- **Effort**: S-M (3-5 days including CDN setup)

**Pros**:
- Unlocks non-bundler users (WordPress, static sites, CMS)
- Powers SaaS script tag delivery
- Tiny effort with esbuild

**Cons**:
- Must version CDN URLs
- No tree-shaking in IIFE (all of core ships)
- Ongoing CDN ops

**Decision**: Build, but don't block SaaS on it. SaaS can use ESM import initially.

### 3.3 `@consentify/integrations` - Pre-built helpers (if demand proves it)

- **What**: Tree-shakeable helper functions wrapping `guard()` for common services
- **API**:
  ```ts
  import { enableGoogleAnalytics } from '@consentify/integrations'
  enableGoogleAnalytics(consent, { trackingId: 'G-XXXXXXX' })
  ```
- **Scope**: Start with top 3 only (GA4, GTM, Meta Pixel). Add more based on GitHub issues.
- **Effort**: S per integration (1-2 days each)

**Decision**: Only build if Phase 2.2 docs generate user requests for pre-built versions. Don't speculatively build.

**Phase 3 total**: ~3-4 weeks

---

## What We're NOT Building (and Why)

### Route Exclusions / SPA Support - SKIP
- **Architect**: Proposed `@consentify/spa` package
- **Critic**: "This is the app's job. Apps can solve this in 1 line: `useEffect(() => consent.clear(), [route])`"
- **Market**: "GDPR is category-based, not route-based"
- **Decision**: SKIP. Document the one-liner pattern instead.

### ConsentifyProvider (React Context) - SKIP
- **Architect**: Proposed as optional in `@consentify/react-ui`
- **Critic**: "Direct instance is better. Provider adds render cost for no gain."
- **DX Designer**: "useSyncExternalStore works without context. No provider needed."
- **Decision**: SKIP. Current direct-instance pattern is superior.

### 16+ Built-in Integrations - SKIP (docs instead)
- **Architect**: Proposed `@consentify/integrations` with registry
- **Critic**: "Maintenance nightmare. Each integration is a third-party contract. XL effort, HIGH risk."
- **Market**: "SaaS CMPs don't ship GA4 code. Lightweight libraries leave developers to wire it themselves."
- **Decision**: SKIP registry. Ship guard() documentation. Revisit only if demand proves it.

### Shadow DOM for Banner - SKIP
- **Market**: "Breaks Material UI, Bootstrap, Tailwind CSS"
- **Critic**: "CSS encapsulation sounds good until users want to style from outside"
- **Decision**: SKIP permanently.

### hasConsented() / resetConsent() / onVersionMismatch - SKIP
- **Critic**: "API bloat. No new value over existing `client.get()` check and `client.clear()`."
- **Decision**: SKIP. Don't add aliases.

### @consentify/next Package - SKIP
- **DX Designer**: "Current pattern is already idiomatic. No special package needed."
- **Decision**: SKIP. Write better docs instead.

### GTM Preview / Hotjar Verify Detection - SKIP
- **Critic**: "Feature creep. Why does Consentify care about GTM Preview?"
- **Decision**: SKIP. Debug mode logs state changes, that's enough.

---

## Summary Timeline

```
Week 1-2:   Phase 0 - Tests + CI
Week 3-4:   Phase 1 - Events, enhanced hook, debug adapter
Week 5-7:   Phase 2 - SaaS enablement, integration docs, Next.js guide
Week 8-12:  Phase 3 - ConsentGate component, UMD bundle, (integrations if demanded)
```

## Version Plan

| Version | Contents | Breaking? |
|---------|----------|-----------|
| `core@2.2.0` | Event system (`on`/`once`), `enableDebug()` | No |
| `react@2.1.0` | `useConsentify(instance, category?)` overload | No |
| `cloud@1.1.0` | `enableSaaS()` adapter, tests | No |
| `ui@1.0.0` | ConsentGate component | New package |
| `core@2.3.0` | UMD build target | No |

No v3 until there's an actual breaking change. Don't burn a major version on additive features.

---

## Metrics to Track

1. **Bundle size**: core <5kb gzipped (CI enforced)
2. **npm weekly downloads**: track growth after each phase
3. **GitHub issues**: track integration requests (proves/disproves Phase 3.3)
4. **SaaS conversion**: track enableSaaS() adoption vs standalone
5. **Time to integrate**: measure via docs feedback, aim for <10 min setup

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SaaS API downtime breaks SDK | Medium | High | Local fallback policy is mandatory, cache with TTL |
| Event system bloats core | Low | Medium | Budget: 50 lines max. Review in PR. |
| Integration docs become stale | Medium | Low | Link to vendor docs, not copy. Test examples in CI. |
| UMD bundle size creeps | Medium | Medium | size-limit CI check, fail >5kb |
| Feature requests for banner UI | High | Low | Point to @consentify/ui ConsentGate + example banner in docs |

---

## Decision Log

| Decision | Chosen | Rejected | Rationale |
|----------|--------|----------|-----------|
| Integration approach | Docs + guard() examples | Registry package | Maintenance cost > user convenience. 4/4 agents flagged risk. |
| React pattern | Direct instance + enhanced hook | Provider + Context | useSyncExternalStore is already optimal. No context overhead. |
| SaaS config fetch | Async adapter (enableSaaS) | Sync factory with token | Core must stay synchronous for SSR safety |
| Banner component | ConsentGate only + doc examples | Full themed banner | Headless SDK shouldn't ship opinionated UI |
| Next.js support | Better docs | @consentify/next package | Current pattern is already the right pattern |
| Versioning | Minor bumps (2.2, 2.3) | Major v3.0 | No breaking changes = no major version |
| Debug mode | enableDebug() adapter | config flag / env detection | Adapter pattern consistent with enableCloud/enableConsentMode |
| Route handling | Skip (document one-liner) | @consentify/spa package | App's responsibility, not SDK's |
