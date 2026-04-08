# Consentify Competitive Analysis Report

## Executive Summary

The consent management market is fragmented into three distinct tiers:

1. **Enterprise CMPs** (OneTrust, Cookiebot, Osano) - Full SaaS with compliance, hosting, analytics dashboards
2. **Lightweight Open Source** (vanilla-cookieconsent, react-cookie-consent) - ~150KB bundles, minimal scope, developer-friendly
3. **Headless APIs** (emerging) - Raw consent state + analytics adapters, zero UI

**Consentify's Position**: Currently operates as a headless SDK in tier 3. The aspirational checklist (16+ integrations, banner themes, UMD bundle, shadow DOM) shifts toward tier 2, competing with lightweight open source. This analysis validates which tier matters for market fit.

---

## Market Landscape

### Enterprise Segment ($1,100-$500K/year)
| Platform | Approach | Sweet Spot | Barrier to Entry |
|----------|----------|-----------|------------------|
| **OneTrust** | SaaS-only, custom pricing | Fortune 500, heavily regulated | $1,100+/month minimum, sales call |
| **Cookiebot** | SaaS + free tier | Mid-market (50-7,000 pages) | August 2025: 100% price hike to €30/month base tier |
| **Osano** | SaaS-light + free tier | Mid-market, developer-friendly | $44/month; free tier ~5K views/month |

**Key Pattern**: All three require SaaS infrastructure. They don't sell standalone SDKs. Marketing teams own adoption, not developers.

### Lightweight Open Source (Free - $0/month)
| Package | Weekly Downloads | Bundle Size | Approach | Active? |
|---------|-----------------|-------------|----------|---------|
| **vanilla-cookieconsent** | 122K | 152 KB | Vanilla JS, highly configurable | Yes (actively maintained) |
| **cookieconsent** (Osano) | ~50K est. | 135 KB | Vanilla JS, features-rich | No (7 years, no updates) |
| **react-cookie-consent** | Unknown | Small | React hook, minimal | Yes |

**Key Pattern**: Lightweight alternatives focus on state management, not integrations. No built-in Segment, PostHog, Mixpanel.

### Consentify's Current Niche
- **@consentify/core**: Headless consent state machine (zero UI, zero deps)
- **@consentify/react**: `useSyncExternalStore` hook
- **@consentify/cloud**: Analytics adapter (POST to custom endpoint)
- **Google Consent Mode v2**: Already supported

---

## Competitive Feature Breakdown

### What EVERY Consent Tool Must Have
1. **Script Blocking** - Prevent tracking scripts from executing before consent
2. **Consent Categories** - Necessary, Analytics, Marketing, Functional (minimum)
3. **Multiple Consent Types** - Accept All, Reject All, Save Preferences
4. **Withdraw Capability** - Users must change consent as easily as they gave it
5. **Consent Logging** - Server-side records for audits (not just browser cookies)
6. **Cookie Scanning** - Detect what scripts/cookies exist on the page

**Consentify Today**: ✅ Has 1-2 (state machine + categories). Missing 3-6.

---

## Integration Strategy Analysis

### What Developers Actually Need (By Priority)

**Tier 1 - Essential (Universal Demand)**
1. **Google Consent Mode v2** ✅ Already supported by Consentify
2. **Google Analytics 4** - Paired with Consent Mode
3. **Google Tag Manager** - Conditional tag firing
4. **Facebook Pixel / Meta CAPI** - Advertising compliance

**Why**: GA4 + GTM dominate free/cheap analytics. Facebook is required by e-commerce. These three touch 80% of web properties.

**Tier 2 - Valuable (Mid-market)**
5. **Segment** - Analytics warehouse aggregation
6. **Mixpanel** - Product analytics
7. **PostHog** - Privacy-first analytics
8. **HubSpot** - CRM + email consent

**Tier 3 - Nice-to-Have (Niche)**
9. **Intercom, Drift** - Chat/support widgets
10. **Hotjar, FullStory** - Session recording (usually requires explicit opt-in anyway)
11. **Amplitude, Mixpanel** - Overlaps tier 2

### Integration Reality Check

**SaaS CMPs offer "integrations" by firing GTM tags**, not by bundling SDKs:
- OneTrust: Sets GA4 consent via GTM trigger (not SDK code)
- Cookiebot: Same - GTM integration
- Osano: Same - "Block until consent via GTM"

**Lightweight libraries don't offer integrations at all** - they just provide the state, leaving developers to wire it up:
```javascript
// vanilla-cookieconsent approach (and what developers expect)
if (consent.analytics) {
  // Manually initialize GA4, PostHog, etc.
  gtag('consent', 'update', {...})
}
```

**Consentify's Cloud adapter** fits the headless model: `enableCloud(instance, { siteId, endpoint })` POSTs consent changes to a custom backend.

---

## Critical Market Insights

### 1. Script Tag / UMD Bundle Priority: **CAN DEFER**

Why developers need it:
- Non-JavaScript environments (CMS, static sites, WordPress)
- One-line setup without build tools

Why Consentify can skip it initially:
- Target audience is JavaScript developers (Next.js, React, Vue, etc.)
- Lightweight open source users avoid SaaS anyway
- Enterprise users expect SaaS, not DIY script tags

**Verdict**: Valuable for long tail, not critical for MVP SaaS launch.

### 2. React Banner Components: **LIKELY WRONG APPROACH**

Current market reality:
- Lightweight libraries (vanilla-cookieconsent) provide **themeable banners** but keep styling separate
- Enterprise CMPs provide **drag-drop builders** in SaaS
- Developers expect **zero UI by default** (headless pattern)

Why bundling React banner themes is risky:
- Design/branding is always custom - generic themes offend designers
- React components lock developers to React ecosystem
- SaaS CMPs already own this space with better UX builders

**Verdict**: Skip. Build a design reference instead, let developers copy patterns.

### 3. Dark Patterns & Regulatory Risk

**Major enforcement trend in 2025:**
- Regulators actively targeting "dark patterns" (Accept > Reject friction)
- GDPR, CCPA, UK-ICO all flagging consent UX in 2024-2025
- Companies fined for: hidden reject buttons, vague wording, visual bias

**Consentify's advantage**: Headless = no built-in dark patterns. Developers build the UX, they own compliance risk.

### 4. Standalone vs SaaS Analytics

Market segments use different models:

| Segment | Model | Tools |
|---------|-------|-------|
| **Enterprise** | SaaS-only analytics + compliance | OneTrust, Cookiebot, Osano |
| **Mid-market** | DIY consent + GTM/GA4 (free) | vanilla-cookieconsent, react-cookie-consent |
| **Emerging** | Headless SDK + custom analytics | Consentify, DIY solutions |

**Insight**: Consentify's @consentify/cloud adapter is the right bet - it's the only layer missing in the DIY segment.

---

## Features to SKIP (Low ROI)

### 1. Shadow DOM Isolation
- **Why it's tempting**: Prevents style conflicts in embeds
- **Reality**: Breaks Material UI, Bootstrap, Tailwind CSS
- **Market need**: Rare - most consent banners aren't embedded
- **Cost**: High (complex styling, React complexity)
- **Verdict**: Skip

### 2. Route Exclusions / SPA Route Guards
- **Why it's tempting**: Let developers opt out of consent on certain routes
- **Reality**: GDPR says consent is per-category, not per-route
- **Market need**: Developers should architect this themselves
- **Cost**: Medium (state machine complexity)
- **Verdict**: Skip - document that apps own route logic

### 3. Debug Mode (verbose logging)
- **Why it's tempting**: Help developers understand state flow
- **Reality**: Use browser DevTools, read source code, write tests
- **Market need**: Low - consent state is simple
- **Cost**: Low but adds surface area
- **Verdict**: Skip for MVP, add if support requests prove it matters

### 4. Window Global API (`window.__consentify`)
- **Why it's tempting**: Developers can access consent from any script
- **Reality**: Breaks ES module architecture, confuses scoping
- **Market need**: Low - use hooks, dependency injection
- **Cost**: Low but adds complexity
- **Verdict**: Skip - encourage hook usage instead

### 5. Built-in Theme Components (extensive)
- **Why it's tempting**: Fast adoption for non-designers
- **Reality**: Every brand hates generic designs
- **Market need**: Handled by SaaS or custom CSS
- **Cost**: High (design debt, maintenance)
- **Verdict**: Skip - provide one default, rest copy-paste

---

## Market Gaps (Consentify Can Own)

### 1. Headless + Typed Consent State
**Gap**: Open source libraries use weak typing, SaaS tools hide the API.
**Opportunity**: Consentify's core is TypeScript-first with policy versioning - competitors don't match this.

### 2. Zero-Dependency Privacy
**Gap**: Competitors add jQuery, lodash, React, Material UI.
**Opportunity**: Consentify ships zero deps. This matters to developers optimizing bundles.

### 3. SSR-First Consent
**Gap**: Most libraries break in Next.js SSR (BroadcastChannel, localStorage issues).
**Opportunity**: Consentify's `isBrowser()` guard + server API is production-ready for SSR.

### 4. Cross-Tab Sync via BroadcastChannel
**Gap**: Lightweight libraries ignore it, enterprise tools rely on server sync.
**Opportunity**: Consentify already does this - unique, valuable for SPA user retention.

### 5. Decoupled Cloud Analytics
**Gap**: Open source has no analytics, SaaS owns the data silo.
**Opportunity**: Consentify Cloud adapter is open-ended - developers can POST to any endpoint (Segment, custom dashboard, etc.)

---

## Recommended Roadmap (By Impact)

### MVP for Indie/Small Team Market
✅ Already have:
- Headless state machine
- React hook (useSyncExternalStore)
- Google Consent Mode v2
- Cloud analytics adapter
- SSR safety

❌ Critical gaps:
1. **Script blocking** - Mechanism to block <script> tags before consent (can be simple - document pattern or lightweight helper)
2. **Documentation** - Show GTM integration pattern for GA4, Facebook Pixel
3. **Test coverage** - Prove SSR safety with Next.js example

**Impact**: Enables DIY developers using free tools (GTM + GA4). Directly competes with vanilla-cookieconsent on technical merits (typed state, SSR safety).

### Phase 2 for Small Business Market ($100-500K revenue)
- UMD bundle (for WordPress, static sites, non-JS environments)
- Pre-built Segment integration adapter (like @consentify/cloud but for Segment)
- Design system reference (CSS-in-JS, Tailwind, Bootstrap)

**Impact**: Reach CMS/non-developer segments.

### Phase 3 for Enterprise (Skip Unless Revenue Justifies)
- Skip: React banner themes, Shadow DOM, route guards, debug mode
- Instead focus SaaS features that enterprises actually pay for: consent audit logs, geo-targeting rules, multi-domain dashboards

---

## Conclusion

### What Matters
1. **Consent state machine** ✅ (Consentify has this)
2. **Script blocking** ⚠️ (Missing, document pattern)
3. **Google Consent Mode v2 + GTM** ✅ (Supported)
4. **SSR safety** ✅ (Unique advantage)
5. **Zero deps** ✅ (Competitive advantage)
6. **Analytics hooks (Cloud/Segment)** ✅ (Partially done)

### What Doesn't
- React banner components (too opinionated, low ROI)
- Shadow DOM isolation (rare use case, high cost)
- Route guards (developer responsibility)
- Window globals (breaks architecture)

### Competitive Position
Consentify has **rare technical advantages** (SSR, zero deps, typed state, cross-tab sync) that competitors ignore because they're selling SaaS + UI, not SDKs. Lean into this.

**Best market fit**: TypeScript-first developers using Next.js, Remix, or other SSR frameworks who want **privacy-first, auditable consent** without SaaS lock-in. This segment is growing (post-privacy-crash, post-iOS limits).

---

## Sources Consulted

- [CookieYes Documentation](https://www.cookieyes.com/documentation/)
- [Cookiebot Pricing Review 2025](https://tekpon.com/software/cookiebot/pricing/)
- [OneTrust Pricing & Packaging](https://www.onetrust.com/pricing/)
- [Osano Review & Pricing](https://www.osano.com/plans)
- [vanilla-cookieconsent on npm](https://www.npmjs.com/package/vanilla-cookieconsent)
- [React Cookie Consent](https://www.npmjs.com/package/react-cookie-consent)
- [Google Consent Mode v2 Implementation Guide](https://developers.google.com/tag-platform/security/guides/consent)
- [GDPR Implementation Guide - DEV Community](https://dev.to/andreashatlem/gdpr-cookie-consent-implementation-what-most-developers-get-wrong-and-how-to-fix-it-1jpl)
- [Meta Pixel GTM Integration](https://stape.io/blog/add-facebook-pixel-gtm)
- [npm-compare: Cookie Consent Packages](https://npm-compare.com/cookieconsent,vanilla-cookieconsent)
