# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Consentify is a minimal, headless cookie consent management SDK. It's a TypeScript monorepo with zero runtime dependencies, designed for SSR-safe usage in modern web frameworks.

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Build core only
pnpm -w --filter @consentify/core build

# Type-check core (and react transitively)
pnpm -w --filter @consentify/core check

# Run tests (vitest + happy-dom)
pnpm test

# Run browser E2E tests (Playwright)
pnpm e2e

# Lint (biome, lint-only — no formatter)
pnpm lint

# Check bundle size (limits in .size-limit.json: core ESM 5kb, core IIFE 4.4kb, cloud ESM 4.75kb, cloud IIFE 5.75kb gzipped)
pnpm run size
```

## Publishing

CI publishes on tags: `core-v*`, `react-v*`, `create-consentify-v*`. (`@consentify/cloud` is deprecated and no longer released on a schedule — it ships only if we need to republish the no-op shell.)
```bash
pnpm changeset           # Create changeset
pnpm changeset version   # Version packages
git tag core-v1.0.0 && git push origin core-v1.0.0  # Trigger release
```

**First publish of a new unscoped (top-level) package**: the granular `NPM_TOKEN` is scoped to `@consentify/*` and cannot create new top-level names. Bootstrap-publish once from local (`cd packages/<name> && npm publish --access public`), then add the now-existing package to the token's allowlist for future CI publishes. Scoped packages under `@consentify/*` work out of the box.

## Git & GitHub

- Repo lives at `consentify/consentify` (transferred from `RomanDenysov/consentify`)
- Remote SSH alias: `git@github.com-personal:consentify/consentify.git`
- **main is branch-protected** — all changes require a PR, no direct push
- After squash-merging a local branch: `git fetch && git reset --hard origin/main` (not `git pull` — branches diverge)
- `gh pr create` targets `consentify/consentify` automatically via remote

## Architecture

### Core Package (`packages/core`)

Two public entries:
- `src/index.ts` (`@consentify/core`): the self-hosted `createConsentify()` factory and re-exports. It never imports `internal/cloud`; passing `siteId` is a type error and throws `ConsentifyConfigError` at runtime.
- `src/cloud.ts` (`@consentify/core/cloud`): `createCloudConsentify()` (async; loads SiteConfig from cache (localStorage `consentify_cfg_<siteId>` in the browser, an in-module memo on the server), the CDN within `timeoutMs`, or the required `fallback`, so it never rejects for network problems; builds the instance via `createConsentify`, exposes the outcome as `instance.cloud`, starts reporting in the browser) plus the `CloudInit` / `CloudFallback` / `CloudInfo` / `SiteConfig` types.

The ESM build bundles both entries in one esbuild call with `--splitting`, so shared core code lands once in a `dist/chunk-*.js` and `ConsentifyConfigError` stays a single class across entries (never build them as separate self-contained bundles). Implementation lives in `src/internal/` (`types`, `util`, `cookie`, `crypto`, `visitor`, `cloud`, `gcm`, `debug`). The instance exposes a **flat top-level API** (`consent.get()`, `consent.set()`, `consent.guard()`, etc.) overloaded for both client and server use; the `consent.server` and `consent.client` namespaces remain available for explicit access.

- **Server signatures**: Take/return raw `Cookie` / `Set-Cookie` header strings (Node.js compatible, no DOM)
- **Client signatures**: Browser-side storage with React `useSyncExternalStore` support via `subscribe()` and `getServerSnapshot()`

Key design patterns:
- Policy versioning via hash - consent invalidates when categories change
- `'necessary'` category is always `true` and cannot be disabled
- Storage abstraction supports cookie (canonical) and localStorage (optional mirror)
- State uses discriminated union: `{ decision: 'unset' }` | `{ decision: 'decided', snapshot }`
- Typed event system: `on(type, handler)` / `once(type, handler)` for events `'change' | 'clear' | 'expiring'`; emits after `notifyListeners`. Cross-tab changes (BroadcastChannel) also emit `'change'`/`'clear'`.
- `guard(category, onGrant, onRevoke?)` - headline integration primitive: runs `onGrant` immediately if consented or once consent is granted, optionally runs `onRevoke` on revocation. Returns a dispose function. Prefer this over hand-rolled `subscribe()` + `isGranted()` loops.
- `enableDebug(instance)` - tree-shakeable debug adapter that logs consent changes via event system
- `acceptAll()` / `rejectAll()` - convenience methods that set all user categories at once
- `getProof()` - returns `ConsentProof` with FNV1a signature for audit trails
- `mode: 'opt-in' | 'opt-out'` - GDPR opt-in (deny by default) vs CCPA opt-out (grant by default)
- `expirationWarningDays` + `'expiring'` event - fires when consent is near expiry

### Internal utilities
- `internal/types.ts` - public types and `ConsentifyConfigError`
- `internal/util.ts` - `fnv1a()` / `stableStringify()` / `hashPolicy()` (deterministic policy hashing), `enc`/`dec`, `isBrowser()`, `isValidSnapshot()`, log helpers
- `internal/cookie.ts` - `readCookie()` / `writeCookie()` / `buildSetCookieHeader()` (isomorphic cookie handling), exported `parseSetCookie()` for framework cookie setters
- `internal/crypto.ts` - FNV1a / HMAC-SHA256 proofs, `verifyProof()`
- `internal/visitor.ts` - visitor ID resolution; `internal/cloud.ts` - cloud-mode config fetch and event reporting
- `internal/gcm.ts` - `enableConsentMode()`; `internal/debug.ts` - `enableDebug()`
- In the factory (`src/index.ts`): listener pattern for React reactivity (`listeners` Set, `syncState`, `notifyListeners`) and event emitter (`eventHandlers` Map) - lightweight typed emitter for `on`/`once`, emits after `notifyListeners`

### Common SDK API mistakes to avoid
- `enableConsentMode(instance, opts)` accepts `{ mapping, waitForUpdate?, sendDefault? }` - there is **no** `defaults:` key. The `gtag('consent','default',...)` command belongs in the HTML `<head>`. Pass `sendDefault: false` so the SDK only sends `update`.
- `ConsentState.decision` is `'unset' | 'decided'` - never `'pending'`.

### SSR Safety

- `isBrowser()` (defined in `src/internal/util.ts`) checks both `window` and `document` — use it for browser-only init
- `typeof BroadcastChannel !== 'undefined'` is **not** sufficient alone — Node.js 18+ exposes it natively; always pair with `isBrowser()`
- Server API is cookie-header only; `client.*` methods are browser-only

### Cloud (`packages/cloud`) — DEPRECATED

`@consentify/cloud@2.0.0` is a no-op shell. `enableCloud()` only logs a deprecation warning and returns a no-op disposer. All cloud functionality (event reporting, visitor hash, dedup, retry buffer) lives in `@consentify/core/cloud` via `createCloudConsentify({ siteId, apiKey })` (Mode B). The package is kept in the registry only because npm blocks unpublishing packages older than 72 hours.

### IIFE Bundles

- Core (self-hosted only): `dist/consentify.iife.js` and `dist/consentify.iife.min.js`, built from `src/index.ts`
- Cloud: `dist/consentify-cloud.iife.js` and `dist/consentify-cloud.iife.min.js`, built from `src/cloud-iife.ts` (build-only entry): every core export plus `createCloudConsentify`. Script-tag users on CMS sites are SaaS customers, so this bundle matters
- Built via esbuild, both expose their exports on the `Consentify` global
- Size budgets via `.size-limit.json` (gzipped): core ESM `dist/index.min.js` 5kb, core IIFE `dist/consentify.iife.min.js` 4.4kb, cloud ESM `dist/cloud.min.js` 4.75kb, cloud IIFE `dist/consentify-cloud.iife.min.js` 5.75kb
- The npm entries `dist/index.js` / `dist/cloud.js` (+ shared `dist/chunk-*.js`) are **unminified** esbuild output (debuggability, supply-chain reviewability); `dist/index.min.js` and `dist/cloud.min.js` are standalone minified bundles for size tracking and CDN use
- For non-bundler environments (WordPress, static sites, CMS)

### React Package (`packages/react`)

- `useConsentify(instance)` - returns `ConsentState<T>` via `useSyncExternalStore`
- `useConsentify(instance, category)` - returns `boolean` for a single category (overload)
- Re-exports everything from `@consentify/core`

### Scaffolder (`packages/create-consentify`)

Top-level npm package `create-consentify` (run via `npx create-consentify@latest`). Interactive CLI that scaffolds consent config + provider into existing projects (Next.js App/Pages, Vite+React, Remix, Astro, vanilla).

- Build: `tsup` bundles a single ESM `dist/index.js` with `#!/usr/bin/env node` shebang (deviates from tsc-based pattern because a CLI needs bundled deps for fast `npx`).
- Entry: `src/index.ts` wires `citty` command -> `src/cli.ts` orchestrator -> `@clack/prompts` wizard -> framework scaffolders -> `execa` install.
- Templates live in `src/templates/*` (pure template-literal functions); per-framework logic in `src/frameworks/*`.
- SaaS output (`--site-id`) imports `createCloudConsentify` from `@consentify/core/cloud` (`sdkImports()` in `templates/consent-config.ts`); vanilla script-tag instructions point to `consentify-cloud.iife.min.js`.
- Non-interactive via flags: `--framework`, `--categories`, `--mode`, `--gcm`, `--site-id`, `--api-key`, `--pm`, `--yes`.
- Never auto-edits existing files - only creates new files and prints wiring instructions.

### Testing

- Test files: `packages/core/src/index.test.ts`, `packages/react/src/index.test.ts`, and `packages/create-consentify/src/__tests__/*.test.ts` (8 files covering templates, detection, frameworks, flags, gcm-mapping, provider output, safe writes, pm commands). `packages/cloud` has no tests - it is a deprecated no-op shell.
- Root `vitest.config.ts` globs `packages/*/src/**/*.test.ts` - new workspace packages are auto-discovered, no per-package vitest config needed
- Mock browser globals with `vi.stubGlobal` / `vi.unstubAllGlobals()` in `afterEach`
- React tests use `@testing-library/react` with `renderHook`
- Cloud-mode tests (in core's `index.test.ts`, importing `createCloudConsentify` from `./cloud`) mock `fetch` and `localStorage` via `vi.stubGlobal`
- Bundle size enforced via `size-limit` (`pnpm run size`) - core ESM must stay under 5kb gzipped (core IIFE 4.4kb, cloud ESM 4.75kb, cloud IIFE 5.75kb)
- Lint enforced via `pnpm lint` (biome, lint-only; `noNonNullAssertion`/`useTemplate`/`noDocumentCookie`/`noConfusingVoidType` deliberately off)
- Framework guides: `docs/guides/nextjs.md`, `vue.md`, `svelte.md`, `solid.md` — state-wiring recipes, no bundled UI
- Privacy/compliance: `docs/guides/cloud-privacy.md` — data collection, storage, and transmission in cloud mode
- Design docs: `docs/plans/YYYY-MM-DD-<topic>-design.md`
